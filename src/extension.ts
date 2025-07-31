import * as vscode from "vscode";
import { SearchEngine, SearchMatch, SearchOptions } from "./searchEngine";

class AdvancedSearchProvider {
  private static instance: AdvancedSearchProvider;
  private searchResults: SearchMatch[] = [];
  private currentMatchIndex: number = -1;
  private searchPanel: vscode.WebviewPanel | undefined;
  private searchQuery: string = "";
  private searchOptions: SearchOptions = {};

  public static getInstance(): AdvancedSearchProvider {
    if (!AdvancedSearchProvider.instance) {
      AdvancedSearchProvider.instance = new AdvancedSearchProvider();
    }
    return AdvancedSearchProvider.instance;
  }

  /**
   * 주석 제외 검색 실행
   */
  public async searchIgnoreComments(): Promise<void> {
    const query = await vscode.window.showInputBox({
      prompt: "검색할 문자열 (주석 제외)",
      placeHolder: "검색어를 입력하세요..."
    });

    if (!query) return;

    // 검색 옵션 설정
    this.searchOptions = await this.getSearchOptions();

    this.searchQuery = query;
    this.searchResults = [];
    this.currentMatchIndex = -1;

    // 워크스페이스의 모든 파일 검색
    const files = await vscode.workspace.findFiles("**/*.{js,ts,jsx,tsx,c,cpp,h,hpp,java,py,cs,php,rb,go,rs,swift,kt}");
    
    // 파일 필터링
    const filteredFiles = files.filter(uri => 
      SearchEngine.shouldIncludeFile(uri, this.searchOptions)
    );
    
    if (filteredFiles.length === 0) {
      vscode.window.showWarningMessage("검색할 파일이 없습니다.");
      return;
    }

    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "주석 제외 검색 중...",
      cancellable: true
    }, async (progress, token) => {
      const limit = this.pLimit(8);
      const promises = filteredFiles.map((uri, index) =>
        limit(() => SearchEngine.searchFile(uri, query, this.searchOptions, (match) => {
          this.searchResults.push(match);
        }))
      );

      progress.report({ increment: 0 });
      await Promise.all(promises);
      progress.report({ increment: 100 });

      if (this.searchResults.length > 0) {
        this.showSearchResults();
        vscode.window.showInformationMessage(`${this.searchResults.length}개의 결과를 찾았습니다.`);
      } else {
        vscode.window.showInformationMessage("검색 결과가 없습니다.");
      }
    });
  }

  /**
   * 검색 옵션 설정
   */
  private async getSearchOptions(): Promise<SearchOptions> {
    const options: SearchOptions = {};
    
    // 대소문자 구분
    const caseSensitive = await vscode.window.showQuickPick(
      ["대소문자 무시", "대소문자 구분"],
      { placeHolder: "대소문자 구분 여부를 선택하세요" }
    );
    options.caseSensitive = caseSensitive === "대소문자 구분";

    // 전체 단어 검색
    const wholeWord = await vscode.window.showQuickPick(
      ["부분 일치", "전체 단어"],
      { placeHolder: "전체 단어 검색 여부를 선택하세요" }
    );
    options.wholeWord = wholeWord === "전체 단어";

    // 정규식 검색
    const useRegex = await vscode.window.showQuickPick(
      ["일반 검색", "정규식 검색"],
      { placeHolder: "정규식 검색 여부를 선택하세요" }
    );
    options.regex = useRegex === "정규식 검색";

    return options;
  }

  /**
   * 검색 결과 패널 표시
   */
  private showSearchResults(): void {
    if (this.searchPanel) {
      this.searchPanel.dispose();
    }

    this.searchPanel = vscode.window.createWebviewPanel(
      'advancedSearchResults',
      `검색 결과: "${this.searchQuery}"`,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.searchPanel.webview.html = this.getSearchResultsHtml();
    this.searchPanel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'goToMatch':
            this.goToMatch(message.index);
            break;
          case 'nextMatch':
            this.nextMatch();
            break;
          case 'prevMatch':
            this.prevMatch();
            break;
        }
      }
    );
  }

  /**
   * 검색 결과 HTML 생성
   */
  private getSearchResultsHtml(): string {
    const results = this.searchResults.map((match, index) => {
      const fileName = match.uri.fsPath.split(/[\\/]/).pop() || '';
      const relativePath = vscode.workspace.asRelativePath(match.uri);
      const isCurrent = index === this.currentMatchIndex;
      
      return `
        <div class="result-item ${isCurrent ? 'current-match' : ''}" data-index="${index}">
          <div class="file-info">
            <span class="file-name">${fileName}</span>
            <span class="file-path">${relativePath}</span>
            <span class="line-number">${match.line}:${match.column}</span>
          </div>
          <div class="snippet">${this.escapeHtml(match.snippet)}</div>
          <button class="go-to-btn" onclick="goToMatch(${index})">이동</button>
        </div>
      `;
    }).join('');

    const optionsText = this.getOptionsText();

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 16px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          .search-info {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
          }
          .search-options {
            font-size: 12px;
            color: var(--vscode-textPreformat-foreground);
            background: var(--vscode-textPreformat-background);
            padding: 4px 8px;
            border-radius: 3px;
            margin-top: 4px;
          }
          .controls {
            display: flex;
            gap: 8px;
          }
          .btn {
            padding: 6px 12px;
            border: 1px solid var(--vscode-button-border);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
            border-radius: 3px;
            font-size: 12px;
          }
          .btn:hover {
            background: var(--vscode-button-hoverBackground);
          }
          .result-item {
            margin-bottom: 12px;
            padding: 12px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            background: var(--vscode-editor-background);
            transition: all 0.2s ease;
          }
          .result-item:hover {
            border-color: var(--vscode-focusBorder);
          }
          .current-match {
            border-color: var(--vscode-focusBorder);
            background: var(--vscode-list-activeSelectionBackground);
          }
          .file-info {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 8px;
            font-size: 12px;
          }
          .file-name {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
          }
          .file-path {
            color: var(--vscode-descriptionForeground);
          }
          .line-number {
            color: var(--vscode-textPreformat-foreground);
            background: var(--vscode-textPreformat-background);
            padding: 2px 6px;
            border-radius: 3px;
          }
          .snippet {
            font-family: 'Consolas', 'Monaco', monospace;
            background: var(--vscode-textBlockQuote-background);
            padding: 8px;
            border-radius: 3px;
            margin: 8px 0;
            white-space: pre-wrap;
            word-break: break-all;
          }
          .go-to-btn {
            padding: 4px 8px;
            border: 1px solid var(--vscode-button-border);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
            border-radius: 3px;
            font-size: 11px;
          }
          .go-to-btn:hover {
            background: var(--vscode-button-hoverBackground);
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="search-info">
              "${this.escapeHtml(this.searchQuery)}" - ${this.searchResults.length}개 결과
            </div>
            <div class="search-options">
              ${optionsText}
            </div>
          </div>
          <div class="controls">
            <button class="btn" onclick="prevMatch()">이전 (Shift+F3)</button>
            <button class="btn" onclick="nextMatch()">다음 (F3)</button>
          </div>
        </div>
        <div id="results">
          ${results}
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          
          function goToMatch(index) {
            vscode.postMessage({
              command: 'goToMatch',
              index: index
            });
          }
          
          function nextMatch() {
            vscode.postMessage({
              command: 'nextMatch'
            });
          }
          
          function prevMatch() {
            vscode.postMessage({
              command: 'prevMatch'
            });
          }
          
          // 키보드 단축키 지원
          document.addEventListener('keydown', (e) => {
            if (e.key === 'F3') {
              e.preventDefault();
              if (e.shiftKey) {
                prevMatch();
              } else {
                nextMatch();
              }
            }
          });
        </script>
      </body>
      </html>
    `;
  }

  /**
   * 검색 옵션 텍스트 생성
   */
  private getOptionsText(): string {
    const options: string[] = [];
    
    if (this.searchOptions.caseSensitive) {
      options.push("대소문자 구분");
    }
    if (this.searchOptions.wholeWord) {
      options.push("전체 단어");
    }
    if (this.searchOptions.regex) {
      options.push("정규식");
    }
    
    return options.length > 0 ? options.join(", ") : "기본 검색";
  }

  /**
   * HTML 이스케이프
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 특정 검색 결과로 이동
   */
  private async goToMatch(index: number): Promise<void> {
    if (index < 0 || index >= this.searchResults.length) return;

    const match = this.searchResults[index];
    this.currentMatchIndex = index;

    try {
      const document = await vscode.workspace.openTextDocument(match.uri);
      const editor = await vscode.window.showTextDocument(document);
      
      const position = new vscode.Position(match.line - 1, match.column - 1);
      const range = new vscode.Range(position, position.translate(0, match.matchLength));
      
      editor.selection = new vscode.Selection(position, position.translate(0, match.matchLength));
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      
      // 검색 결과 패널 업데이트
      this.updateSearchPanel();
    } catch (error) {
      vscode.window.showErrorMessage(`파일을 열 수 없습니다: ${match.uri.fsPath}`);
    }
  }

  /**
   * 다음 검색 결과로 이동
   */
  public nextMatch(): void {
    if (this.searchResults.length === 0) return;
    
    this.currentMatchIndex = (this.currentMatchIndex + 1) % this.searchResults.length;
    this.goToMatch(this.currentMatchIndex);
  }

  /**
   * 이전 검색 결과로 이동
   */
  public prevMatch(): void {
    if (this.searchResults.length === 0) return;
    
    this.currentMatchIndex = this.currentMatchIndex <= 0 
      ? this.searchResults.length - 1 
      : this.currentMatchIndex - 1;
    this.goToMatch(this.currentMatchIndex);
  }

  /**
   * 검색 패널 업데이트
   */
  private updateSearchPanel(): void {
    if (this.searchPanel) {
      this.searchPanel.webview.html = this.getSearchResultsHtml();
    }
  }

  /**
   * 검색 패널 토글
   */
  public toggleSearchPanel(): void {
    if (this.searchPanel) {
      this.searchPanel.dispose();
      this.searchPanel = undefined;
    } else if (this.searchResults.length > 0) {
      this.showSearchResults();
    }
  }

  /**
   * p-limit: 동시 실행을 max 개로 제한하는 헬퍼
   */
  private pLimit(max: number) {
    let active = 0;
    const queue: (() => void)[] = [];
    const next = () => {
      active--;
      if (queue.length) queue.shift()!();
    };
    return <T>(fn: () => Promise<T>): Promise<T> =>
      new Promise((resolve, reject) => {
        const run = () => {
          active++;
          fn().then(resolve, reject).finally(next);
        };
        active < max ? run() : queue.push(run);
      });
  }
}

export function activate(context: vscode.ExtensionContext) {
  const searchProvider = AdvancedSearchProvider.getInstance();

  // 주석 제외 검색 명령
  const searchCommand = vscode.commands.registerCommand(
    "advSearch.searchIgnoreComments",
    () => searchProvider.searchIgnoreComments()
  );

  // 다음 검색 결과로 이동
  const nextMatchCommand = vscode.commands.registerCommand(
    "advSearch.nextMatch",
    () => searchProvider.nextMatch()
  );

  // 이전 검색 결과로 이동
  const prevMatchCommand = vscode.commands.registerCommand(
    "advSearch.prevMatch",
    () => searchProvider.prevMatch()
  );

  // 검색 패널 토글
  const togglePanelCommand = vscode.commands.registerCommand(
    "advSearch.toggleSearchPanel",
    () => searchProvider.toggleSearchPanel()
  );

  context.subscriptions.push(
    searchCommand,
    nextMatchCommand,
    prevMatchCommand,
    togglePanelCommand
  );
}

export function deactivate() {} 