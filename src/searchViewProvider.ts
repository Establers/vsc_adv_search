import * as vscode from "vscode";
import { SearchMatch } from "./searchEngine";

export class SearchViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "advSearch.searchResults";
  private _view?: vscode.WebviewView;
  private _searchResults: SearchMatch[] = [];
  private _currentMatchIndex: number = -1;
  private _searchQuery: string = "";

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
        case 'nextMatch':
          this._nextMatch();
          break;
        case 'prevMatch':
          this._prevMatch();
          break;
        case 'search':
          this._performSearch(data.query);
          break;
      }
    });
  }

  public updateSearchResults(results: SearchMatch[], query: string) {
    this._searchResults = results;
    this._searchQuery = query;
    this._currentMatchIndex = -1;
    
    if (this._view) {
      this._view.webview.html = this._getHtmlForWebview(this._view.webview);
    }
  }

  public clearResults() {
    this._searchResults = [];
    this._searchQuery = "";
    this._currentMatchIndex = -1;
    
    if (this._view) {
      this._view.webview.html = this._getHtmlForWebview(this._view.webview);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const results = this._searchResults.map((match, index) => {
      const fileName = match.uri.fsPath.split(/[\\/]/).pop() || '';
      const relativePath = vscode.workspace.asRelativePath(match.uri);
      const isCurrent = index === this._currentMatchIndex;
      
      return `
        <div class="result-item ${isCurrent ? 'current-match' : ''}" data-index="${index}">
          <div class="file-info">
            <span class="file-name">${fileName}</span>
            <span class="file-path">${relativePath}</span>
            <span class="line-number">${match.line}:${match.column}</span>
          </div>
          <div class="snippet">${this._escapeHtml(match.snippet)}</div>
          <button class="go-to-btn" onclick="goToMatch(${index})">이동</button>
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
          
          .controls {
            display: flex;
            gap: 5px;
            margin-bottom: 10px;
          }
          
          .control-btn {
            padding: 4px 8px;
            border: 1px solid var(--vscode-button-border);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
            border-radius: 3px;
            font-size: 11px;
          }
          
          .control-btn:hover {
            background: var(--vscode-button-hoverBackground);
          }
          
          .result-item {
            margin-bottom: 10px;
            padding: 8px;
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
            gap: 8px;
            margin-bottom: 5px;
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
            background: var(--vscode-textBlockQuote-background);
            padding: 6px;
            border-radius: 3px;
            margin: 5px 0;
            white-space: pre-wrap;
            word-break: break-all;
            font-size: 11px;
            line-height: 1.3;
          }
          
          .go-to-btn {
            padding: 3px 6px;
            border: 1px solid var(--vscode-button-border);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
            border-radius: 2px;
            font-size: 10px;
          }
          
          .go-to-btn:hover {
            background: var(--vscode-button-hoverBackground);
          }
          
          .no-results {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
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
          <div class="search-info">
            ${this._searchQuery ? `"${this._escapeHtml(this._searchQuery)}" - ${this._searchResults.length}개 결과` : '검색어를 입력하고 검색 버튼을 클릭하세요'}
          </div>
          ${this._searchResults.length > 0 ? `
            <div class="controls">
              <button class="control-btn" onclick="prevMatch()">이전</button>
              <button class="control-btn" onclick="nextMatch()">다음</button>
            </div>
          ` : ''}
        </div>
        
        <div id="results">
          ${this._searchResults.length > 0 ? results : '<div class="no-results">검색 결과가 없습니다</div>'}
        </div>
        
        <script>
          const vscode = acquireVsCodeApi();
          
          function performSearch() {
            const query = document.getElementById('searchInput').value;
            vscode.postMessage({
              type: 'search',
              query: query
            });
          }
          
          function goToMatch(index) {
            vscode.postMessage({
              type: 'goToMatch',
              index: index
            });
          }
          
          function nextMatch() {
            vscode.postMessage({
              type: 'nextMatch'
            });
          }
          
          function prevMatch() {
            vscode.postMessage({
              type: 'prevMatch'
            });
          }
          
          // Enter 키로 검색 실행
          document.getElementById('searchInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              performSearch();
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

  private _nextMatch(): void {
    if (this._searchResults.length === 0) return;
    
    this._currentMatchIndex = (this._currentMatchIndex + 1) % this._searchResults.length;
    this._goToMatch(this._currentMatchIndex);
  }

  private _prevMatch(): void {
    if (this._searchResults.length === 0) return;
    
    this._currentMatchIndex = this._currentMatchIndex <= 0 
      ? this._searchResults.length - 1 
      : this._currentMatchIndex - 1;
    this._goToMatch(this._currentMatchIndex);
  }

  private async _performSearch(query: string): Promise<void> {
    if (!query.trim()) return;
    
    // 메인 익스텐션의 검색 기능 호출
    await vscode.commands.executeCommand('advSearch.searchIgnoreComments', query);
  }

  private _updateView(): void {
    if (this._view) {
      this._view.webview.html = this._getHtmlForWebview(this._view.webview);
    }
  }
} 