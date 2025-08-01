import * as vscode from "vscode";
import * as path from "path";
import { SearchMatch, SearchOptions } from "./searchEngine";
import { AdvancedSearchProvider } from "./extension";

export class SearchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "advSearch.searchResults";
  private _view?: vscode.WebviewView;
  private _searchResults: SearchMatch[] = [];
  private _currentMatchIndex: number = -1;
  private _searchQuery: string = "";
  private _searchOptions: SearchOptions = {};
  private _hasMoreResults: boolean = false;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(data => {
      switch (data.type) {
        case 'goToMatch':
          this._goToMatch(data.index);
          break;
        case 'search':
          this._performSearch(data.query, data.options);
          break;
        case 'loadMore':
          vscode.commands.executeCommand('advSearch.loadMoreResults');
          break;
      }
    });
  }

  public updateSearchResults(results: SearchMatch[], query: string, options: SearchOptions, hasMore: boolean) {
    this._searchResults = results;
    this._searchQuery = query;
    this._searchOptions = options;
    this._hasMoreResults = hasMore;
    this._currentMatchIndex = -1;
    
    if (this._view) {
      this._view.webview.html = this._getHtmlForWebview(this._view.webview);
    }
  }

  public clearResults() {
    this._searchResults = [];
    this._searchQuery = "";
    this._searchOptions = {};
    this._currentMatchIndex = -1;
    this._hasMoreResults = false;
    
    if (this._view) {
      this._view.webview.html = this._getHtmlForWebview(this._view.webview);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const results = this._searchResults.map((match, index) => {
      const fileName = path.basename(match.uri.fsPath);
      const relativePath = vscode.workspace.asRelativePath(match.uri);
      const dirPath = path.dirname(relativePath);
      const isCurrent = index === this._currentMatchIndex;
      const commentClass = match.isComment ? 'comment' : '';

      // 미리보기용 전체 라인 추출
      const lineText = match.lineText;

      return `
        <div class="result-item ${isCurrent ? 'current-match' : ''} ${commentClass}" data-index="${index}" title="${this._escapeHtml(lineText)}" ondblclick="goToMatch(${index})">
          <span class="file-info">
            <span class="file-name">${fileName}</span>
            <span class="file-path">${dirPath}</span>
            <span class="line-number">${match.line}:${match.column}</span>
          </span>
          <span class="snippet">${this._escapeHtml(match.snippet)}</span>
        </div>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html lang="ko">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Advanced Search Results</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 10px;
          }
          
          .search-header {
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          
          .search-input-container {
            display: flex;
            gap: 8px;
            margin-bottom: 10px;
          }

          .options {
            display: flex;
            gap: 8px;
            margin-bottom: 10px;
            font-size: 11px;
            flex-wrap: wrap;
          }


          .options label {
            display: flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
          }
          
          .search-input {
            flex: 1;
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-size: 12px;
          }
          
          .search-btn {
            padding: 6px 12px;
            border: 1px solid var(--vscode-button-border);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
            border-radius: 3px;
            font-size: 12px;
          }
          
          .search-btn:hover {
            background: var(--vscode-button-hoverBackground);
          }
          
          .search-info {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 10px;
          }
          
          
          .result-item {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 4px;
            padding: 4px 8px;
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
            gap: 4px;
            font-size: 11px;
          }
          
          .file-name {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
          }
          
          .file-path {
            color: var(--vscode-descriptionForeground);
            font-size: 10px;
          }
          
          .line-number {
            color: var(--vscode-textPreformat-foreground);
            background: var(--vscode-textPreformat-background);
            padding: 1px 4px;
            border-radius: 2px;
            font-size: 10px;
          }
          
          .snippet {
            font-family: 'Consolas', 'Monaco', monospace;
            white-space: pre;
            overflow: hidden;
            text-overflow: ellipsis;
            flex: 1;
            font-size: 11px;
            line-height: 1.3;
          }

          .result-item.comment .snippet {
            opacity: 0.7;
            font-style: italic;
          }
          
          
          .no-results {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 20px;
          }

          .welcome-message {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            padding: 20px;
          }
        </style>
      </head>
      <body>
        <div class="search-header">
        <div class="search-input-container">
          <input type="text" class="search-input" id="searchInput" placeholder="검색어를 입력하세요..." value="${this._escapeHtml(this._searchQuery)}">
          <button class="search-btn" onclick="performSearch()">검색</button>
        </div>
        <div class="options">
          <label><input type="checkbox" id="caseSensitive" ${this._searchOptions.caseSensitive ? 'checked' : ''}>대소문자 구분</label>
          <label><input type="checkbox" id="wholeWord" ${this._searchOptions.wholeWord ? 'checked' : ''}>전체 단어</label>
          <label><input type="checkbox" id="regex" ${this._searchOptions.regex ? 'checked' : ''}>정규식</label>
          <label><input type="checkbox" id="includeComments" ${this._searchOptions.includeComments ? 'checked' : ''}>주석 포함</label>
          <label><input type="checkbox" id="commentsOnly" ${this._searchOptions.commentsOnly ? 'checked' : ''}>주석만</label>
        </div>
        <div class="search-info">
            ${this._searchQuery ? `"${this._escapeHtml(this._searchQuery)}" - ${this._searchResults.length}개 결과` : '검색어를 입력하고 검색 버튼을 클릭하세요'}
          </div>
        </div>
        
        <div id="results">
          ${this._searchResults.length > 0 ? results : (this._searchQuery ? '<div class="no-results">검색 결과가 없습니다</div>' : '<div class="welcome-message">Advanced Search 패널입니다.<br>검색어를 입력하고 검색 버튼을 클릭하세요.</div>')}
        </div>
        ${this._hasMoreResults ? '<button class="search-btn" id="loadMoreBtn" onclick="loadMore()">더 보기</button>' : ''}

        <script>
          const vscode = acquireVsCodeApi();
          
          function performSearch() {
            const query = document.getElementById('searchInput').value;
            const options = {
              caseSensitive: document.getElementById('caseSensitive').checked,
              wholeWord: document.getElementById('wholeWord').checked,
              regex: document.getElementById('regex').checked,
              includeComments: document.getElementById('includeComments').checked,
              commentsOnly: document.getElementById('commentsOnly').checked
            };
            vscode.postMessage({
              type: 'search',
              query: query,
              options: options
            });
          }
          
          function goToMatch(index) {
            vscode.postMessage({
              type: 'goToMatch',
              index: index
            });
          }

          function loadMore() {
            vscode.postMessage({ type: 'loadMore' });
          }
          
          
          // Enter 키로 검색 실행
          document.getElementById('searchInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              performSearch();
            }
          });

          document.getElementById('includeComments').addEventListener('change', (e) => {
            if (e.target.checked) {
              document.getElementById('commentsOnly').checked = false;
            }
          });

          document.getElementById('commentsOnly').addEventListener('change', (e) => {
            if (e.target.checked) {
              document.getElementById('includeComments').checked = false;
            }
          });
        </script>
      </body>
      </html>
    `;
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private async _goToMatch(index: number): Promise<void> {
    if (index < 0 || index >= this._searchResults.length) return;

    const match = this._searchResults[index];
    this._currentMatchIndex = index;
    AdvancedSearchProvider.getInstance().setCurrentMatchIndex(index);

    try {
      const document = await vscode.workspace.openTextDocument(match.uri);
      const editor = await vscode.window.showTextDocument(document);
      
      const position = new vscode.Position(match.line - 1, match.column - 1);
      const range = new vscode.Range(position, position.translate(0, match.matchLength));
      
      editor.selection = new vscode.Selection(position, position.translate(0, match.matchLength));
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      
      this._updateView();
    } catch (error) {
      vscode.window.showErrorMessage(`파일을 열 수 없습니다: ${match.uri.fsPath}`);
    }
  }


  private async _performSearch(query: string, options: SearchOptions): Promise<void> {
    if (!query.trim()) return;

    // 메인 익스텐션의 검색 기능 호출
    await vscode.commands.executeCommand('advSearch.searchIgnoreComments', query, options);
  }

  private _updateView(): void {
    if (this._view) {
      this._view.webview.html = this._getHtmlForWebview(this._view.webview);
    }
  }

  public highlightMatch(index: number): void {
    if (index < 0 || index >= this._searchResults.length) return;
    this._currentMatchIndex = index;
    this._updateView();
  }
}