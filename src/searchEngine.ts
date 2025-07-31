import * as vscode from "vscode";

export interface SearchMatch {
  uri: vscode.Uri;
  line: number;
  column: number;
  snippet: string;
  fullText: string;
  matchLength: number;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  includePattern?: string;
  excludePattern?: string;
}

export class SearchEngine {
  /**
   * 파일에서 주석을 제외하고 검색
   */
  public static async searchFile(
    uri: vscode.Uri,
    needle: string,
    options: SearchOptions = {},
    emit: (match: SearchMatch) => void
  ): Promise<void> {
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder("utf8").decode(raw);
      
      if (options.regex) {
        this.searchWithRegex(text, uri, needle, options, emit);
      } else {
        this.searchWithString(text, uri, needle, options, emit);
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
          i++;
          continue;
        case "block":
          if (ch === "*" && next === "/") {
            mode = "code";
            i += 2;
            column += 2;
          } else {
            i++;
            column++;
          }
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
          if (this.isMatch(text, i, searchText, options)) {
            const eol = text.indexOf("\n", i);
            const snippet = eol === -1 
              ? text.slice(i, i + 50) 
              : text.slice(i, Math.min(eol, i + 50));
            
            emit({
              uri,
              line,
              column,
              snippet: snippet.trim(),
              fullText: text,
              matchLength: needle.length
            });
          }
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
            i++;
            continue;
          case "block":
            if (ch === "*" && next === "/") {
              mode = "code";
              i += 2;
              column += 2;
            } else {
              i++;
              column++;
            }
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
            if (match && match.index === 0) {
              const eol = text.indexOf("\n", i);
              const snippet = eol === -1 
                ? text.slice(i, i + 50) 
                : text.slice(i, Math.min(eol, i + 50));
              
              emit({
                uri,
                line,
                column,
                snippet: snippet.trim(),
                fullText: text,
                matchLength: match[0].length
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