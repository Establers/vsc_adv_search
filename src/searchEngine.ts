import * as vscode from "vscode";
import * as iconv from "iconv-lite";
import * as jschardet from "jschardet";
import AhoCorasick from "aho-corasick";

export interface SearchMatch {
  uri: vscode.Uri;
  line: number;
  column: number;
  snippet: string;
  lineText: string;
  matchLength: number;
  isComment: boolean;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  includeComments?: boolean;
  commentsOnly?: boolean;
  includePattern?: string;
  excludePattern?: string;
}

export class SearchEngine {
  /**
   * 파일에서 문자열 검색 (옵션에 따라 주석 포함 여부 처리)
   */
  public static async searchFile(
    uri: vscode.Uri,
    needle: string | string[],
    options: SearchOptions = {},
    emit: (match: SearchMatch) => void
  ): Promise<void> {
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const buffer = Buffer.from(raw);

      // 인코딩 자동 감지
      let encoding = 'utf-8';
      try {
        const detected = jschardet.detect(buffer);
        if (detected && detected.encoding) {
          encoding = detected.encoding.toLowerCase();
        }
      } catch {}

      let text = encoding === 'utf-8' || encoding === 'ascii'
        ? buffer.toString('utf8')
        : iconv.decode(buffer, encoding);

      // 한글 등 유니코드 문자열 처리를 위해 NFC 정규화
      text = text.normalize('NFC');

      if (Array.isArray(needle)) {
        const needles = needle.map(n => n.normalize('NFC'));
        this.searchWithMultiple(text, uri, needles, options, emit);
      } else {
        const normalized = needle.normalize('NFC');
        if (options.regex) {
          this.searchWithRegex(text, uri, normalized, options, emit);
        } else {
          this.searchWithString(text, uri, normalized, options, emit);
        }
      }
    } catch (error) {
      console.error(`파일 읽기 실패: ${uri.fsPath}`, error);
    }
  }

  /**
   * 문자열 검색 (기본)
   */
  private static searchWithString(
    text: string,
    uri: vscode.Uri,
    needle: string,
    options: SearchOptions,
    emit: (match: SearchMatch) => void
  ): void {
    const searchText = options.caseSensitive ? needle : needle.toLowerCase();
    const n = needle.length;

    let i = 0;
    let line = 1;
    let column = 1;
    const len = text.length;

    let mode: "code" | "line" | "block" | "str" | "char" = "code";
    let esc = false;

    while (i < len) {
      const ch = text[i];
      const next = i + 1 < len ? text[i + 1] : "";

      // 줄 번호 관리
      if (ch === "\n") {
        if (mode === "line") mode = "code";
        line++;
        column = 1;
        i++;
        continue;
      }

      switch (mode) {
        case "line":
          if ((options.includeComments || options.commentsOnly) &&
              this.isMatch(text, i, searchText, options)) {
            const eol = text.indexOf("\n", i);
            const lineStart = text.lastIndexOf("\n", i) + 1;
            const lineEnd = eol === -1 ? text.length : eol;
            const lineText = text.slice(lineStart, lineEnd);
            const snippet = lineText.length > 200 ? lineText.slice(0, 200) : lineText;

            emit({
              uri,
              line,
              column,
              snippet: snippet.trim(),
              lineText,
              matchLength: needle.length,
              isComment: true
            });
          }
          i++;
          column++;
          continue;
        case "block":
          if (ch === "*" && next === "/") {
            mode = "code";
            i += 2;
            column += 2;
            continue;
          }
          if ((options.includeComments || options.commentsOnly) &&
              this.isMatch(text, i, searchText, options)) {
            const eol = text.indexOf("\n", i);
            const lineStart = text.lastIndexOf("\n", i) + 1;
            const lineEnd = eol === -1 ? text.length : eol;
            const lineText = text.slice(lineStart, lineEnd);
            const snippet = lineText.length > 200 ? lineText.slice(0, 200) : lineText;

            emit({
              uri,
              line,
              column,
              snippet: snippet.trim(),
              lineText,
              matchLength: needle.length,
              isComment: true
            });
          }
          i++;
          column++;
          continue;
        case "str":
          if (!esc && ch === '"') mode = "code";
          esc = ch === "\\" ? !esc : false;
          i++;
          column++;
          continue;
        case "char":
          if (!esc && ch === "'") mode = "code";
          esc = ch === "\\" ? !esc : false;
          i++;
          column++;
          continue;
        default: // code
          if (ch === "/" && next === "/") {
            mode = "line";
            i += 2;
            column += 2;
            continue;
          }
          if (ch === "/" && next === "*") {
            mode = "block";
            i += 2;
            column += 2;
            continue;
          }
          if (ch === '"') {
            mode = "str";
            i++;
            column++;
            continue;
          }
          if (ch === "'") {
            mode = "char";
            i++;
            column++;
            continue;
          }
          
          // 매치 검사
          if (!options.commentsOnly && this.isMatch(text, i, searchText, options)) {
            const eol = text.indexOf("\n", i);
            const lineStart = text.lastIndexOf("\n", i) + 1;
            const lineEnd = eol === -1 ? text.length : eol;
            const lineText = text.slice(lineStart, lineEnd);
            const snippet = lineText.length > 200 ? lineText.slice(0, 200) : lineText;

            emit({
              uri,
              line,
              column,
              snippet: snippet.trim(),
              lineText,
              matchLength: needle.length,
              isComment: ["line", "block"].includes(mode)
            });
          }
          i++;
          column++;
      }
    }
  }

  /**
   * 여러 문자열 동시 검색 (Aho-Corasick)
   */
  private static searchWithMultiple(
    text: string,
    uri: vscode.Uri,
    needles: string[],
    options: SearchOptions,
    emit: (match: SearchMatch) => void
  ): void {
    const ac = new AhoCorasick();
    for (const w of needles) {
      const key = options.caseSensitive ? w : w.toLowerCase();
      ac.add(key, w);
    }
    ac.build_fail();

    let node: any = ac.trie;
    let i = 0;
    let line = 1;
    let column = 1;
    const len = text.length;

    let mode: "code" | "line" | "block" | "str" | "char" = "code";
    let esc = false;

    const feed = (ch: string) => {
      const searchCh = options.caseSensitive ? ch : ch.toLowerCase();
      while (node && !node.next[searchCh]) node = node.fail;
      if (!node) node = ac.trie;
      if (node.next[searchCh]) {
        node = node.next[searchCh];
        ac.foreach_match(node, i + 1, (found: string, _data: any, start: number) => {
          const matchLen = found.length;
          const startIdx = start;

          if (options.wholeWord) {
            const before = startIdx > 0 ? text[startIdx - 1] : '';
            const after = startIdx + matchLen < text.length ? text[startIdx + matchLen] : '';
            const wordChar = /[a-zA-Z0-9_]/;
            if (wordChar.test(before) || wordChar.test(after)) return;
          }

          const eol = text.indexOf('\n', startIdx);
          const lineStart = text.lastIndexOf('\n', startIdx) + 1;
          const lineEnd = eol === -1 ? text.length : eol;
          const lineText = text.slice(lineStart, lineEnd);
          const snippet = lineText.length > 200 ? lineText.slice(0, 200) : lineText;
          const isComment = mode === 'line' || mode === 'block';

          if (options.commentsOnly && !isComment) return;
          if (!options.includeComments && isComment) return;

          emit({
            uri,
            line,
            column: column - matchLen + 1,
            snippet: snippet.trim(),
            lineText,
            matchLength: matchLen,
            isComment
          });
        });
      }
    };

    while (i < len) {
      const ch = text[i];
      const next = i + 1 < len ? text[i + 1] : '';

      if (ch === '\n') {
        if (mode === 'line') mode = 'code';
        feed(ch);
        line++;
        column = 1;
        i++;
        continue;
      }

      switch (mode) {
        case 'line':
          feed(ch);
          i++;
          column++;
          continue;
        case 'block':
          if (ch === '*' && next === '/') {
            feed(ch);
            feed(next);
            mode = 'code';
            i += 2;
            column += 2;
            continue;
          }
          feed(ch);
          i++;
          column++;
          continue;
        case 'str':
          feed(ch);
          if (!esc && ch === '"') mode = 'code';
          esc = ch === '\\' ? !esc : false;
          i++;
          column++;
          continue;
        case 'char':
          feed(ch);
          if (!esc && ch === "'") mode = 'code';
          esc = ch === '\\' ? !esc : false;
          i++;
          column++;
          continue;
        default:
          if (ch === '/' && next === '/') {
            mode = 'line';
            feed(ch);
            feed(next);
            i += 2;
            column += 2;
            continue;
          }
          if (ch === '/' && next === '*') {
            mode = 'block';
            i += 2;
            column += 2;
            continue;
          }
          if (ch === '"') {
            mode = 'str';
            feed(ch);
            i++;
            column++;
            continue;
          }
          if (ch === "'") {
            mode = 'char';
            feed(ch);
            i++;
            column++;
            continue;
          }
          feed(ch);
          i++;
          column++;
      }
    }
  }

  /**
   * 정규식 검색
   */
  private static searchWithRegex(
    text: string,
    uri: vscode.Uri,
    needle: string,
    options: SearchOptions,
    emit: (match: SearchMatch) => void
  ): void {
    try {
      const flags = options.caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(needle, flags);
      
      let i = 0;
      let line = 1;
      let column = 1;
      const len = text.length;

      let mode: "code" | "line" | "block" | "str" | "char" = "code";
      let esc = false;

      while (i < len) {
        const ch = text[i];
        const next = i + 1 < len ? text[i + 1] : "";

        // 줄 번호 관리
        if (ch === "\n") {
          if (mode === "line") mode = "code";
          line++;
          column = 1;
          i++;
          continue;
        }

        switch (mode) {
          case "line":
            if (options.includeComments || options.commentsOnly) {
              const match = regex.exec(text.slice(i));
              if (match && match.index === 0) {
                const eol = text.indexOf("\n", i);
                const lineStart = text.lastIndexOf("\n", i) + 1;
                const lineEnd = eol === -1 ? text.length : eol;
                const lineText = text.slice(lineStart, lineEnd);
                const snippet = lineText.length > 200 ? lineText.slice(0, 200) : lineText;

                emit({
                  uri,
                  line,
                  column,
                  snippet: snippet.trim(),
                  lineText,
                  matchLength: match[0].length,
                  isComment: true
                });
              }
            }
            i++;
            column++;
            continue;
          case "block":
            if (ch === "*" && next === "/") {
              mode = "code";
              i += 2;
              column += 2;
              continue;
            }
            if (options.includeComments || options.commentsOnly) {
              const match = regex.exec(text.slice(i));
              if (match && match.index === 0) {
                const eol = text.indexOf("\n", i);
                const lineStart = text.lastIndexOf("\n", i) + 1;
                const lineEnd = eol === -1 ? text.length : eol;
                const lineText = text.slice(lineStart, lineEnd);
                const snippet = lineText.length > 200 ? lineText.slice(0, 200) : lineText;

                emit({
                  uri,
                  line,
                  column,
                  snippet: snippet.trim(),
                  lineText,
                  matchLength: match[0].length,
                  isComment: true
                });
              }
            }
            i++;
            column++;
            continue;
          case "str":
            if (!esc && ch === '"') mode = "code";
            esc = ch === "\\" ? !esc : false;
            i++;
            column++;
            continue;
          case "char":
            if (!esc && ch === "'") mode = "code";
            esc = ch === "\\" ? !esc : false;
            i++;
            column++;
            continue;
          default: // code
            if (ch === "/" && next === "/") {
              mode = "line";
              i += 2;
              column += 2;
              continue;
            }
            if (ch === "/" && next === "*") {
              mode = "block";
              i += 2;
              column += 2;
              continue;
            }
            if (ch === '"') {
              mode = "str";
              i++;
              column++;
              continue;
            }
            if (ch === "'") {
              mode = "char";
              i++;
              column++;
              continue;
            }
            
            // 정규식 매치 검사
            const remainingText = text.slice(i);
            const match = regex.exec(remainingText);
            if (!options.commentsOnly && match && match.index === 0) {
              const eol = text.indexOf("\n", i);
              const lineStart = text.lastIndexOf("\n", i) + 1;
              const lineEnd = eol === -1 ? text.length : eol;
              const lineText = text.slice(lineStart, lineEnd);
              const snippet = lineText.length > 200 ? lineText.slice(0, 200) : lineText;

              emit({
                uri,
                line,
                column,
                snippet: snippet.trim(),
                lineText,
                matchLength: match[0].length,
                isComment: ["line", "block"].includes(mode)
              });
            }
            i++;
            column++;
        }
      }
    } catch (error) {
      console.error("정규식 검색 오류:", error);
    }
  }

  /**
   * 매치 여부 확인
   */
  private static isMatch(
    text: string, 
    index: number, 
    searchText: string, 
    options: SearchOptions
  ): boolean {
    const textSlice = text.slice(index, index + searchText.length);
    const compareText = options.caseSensitive ? textSlice : textSlice.toLowerCase();
    
    if (compareText !== searchText) {
      return false;
    }

    // 전체 단어 검색 옵션 확인
    if (options.wholeWord) {
      const before = index > 0 ? text[index - 1] : '';
      const after = index + searchText.length < text.length ? text[index + searchText.length] : '';
      const wordChar = /[a-zA-Z0-9_]/;
      
      if (wordChar.test(before) || wordChar.test(after)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 파일 필터링
   */
  public static shouldIncludeFile(uri: vscode.Uri, options: SearchOptions): boolean {
    const relativePath = vscode.workspace.asRelativePath(uri);
    
    if (options.includePattern) {
      const includeRegex = new RegExp(options.includePattern);
      if (!includeRegex.test(relativePath)) {
        return false;
      }
    }
    
    if (options.excludePattern) {
      const excludeRegex = new RegExp(options.excludePattern);
      if (excludeRegex.test(relativePath)) {
        return false;
      }
    }
    
    return true;
  }
} 