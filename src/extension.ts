import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { Worker } from "worker_threads";
import { SearchEngine, SearchMatch } from "./searchEngine";
import { SearchViewProvider } from "./searchViewProvider";

export class AdvancedSearchProvider {
  private static instance: AdvancedSearchProvider;
  private searchResults: SearchMatch[] = [];
  private currentMatchIndex: number = -1;
  private searchQuery: string = "";
  private searchOptions: any = {};
  private viewProvider: SearchViewProvider;

  public static getInstance(): AdvancedSearchProvider {
    if (!AdvancedSearchProvider.instance) {
      AdvancedSearchProvider.instance = new AdvancedSearchProvider();
    }
    return AdvancedSearchProvider.instance;
  }

  constructor() {
    this.viewProvider = new SearchViewProvider(vscode.extensions.getExtension('vsc-adv-search')?.extensionUri || vscode.Uri.file(''));
  }

  async searchIgnoreComments(query?: string, options?: any) {
    if (!query) {
      query = await vscode.window.showInputBox({
        prompt: "검색할 문자열 (주석 제외)",
        placeHolder: "검색어를 입력하세요..."
      });
    }

    if (!query) return;

    this.searchOptions = options || await this.getSearchOptions();
    this.searchQuery = query;
    this.searchResults = [];
    this.currentMatchIndex = -1;

    const files = await vscode.workspace.findFiles("**/*.{c,h,py}");
    const filteredFiles = files.filter(uri => SearchEngine.shouldIncludeFile(uri, this.searchOptions));

    if (filteredFiles.length === 0) {
      vscode.window.showWarningMessage("검색할 파일이 없습니다.");
      return;
    }

    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: this.searchOptions.commentsOnly
        ? "주석만 검색 중..."
        : (this.searchOptions.includeComments ? "주석 포함 검색 중..." : "주석 제외 검색 중..."),
      cancellable: true
    }, async (progress, token) => {
      const concurrency = os.cpus().length || 4;
      const limit = this.pLimit(concurrency);
      const workerPath = path.join(__dirname, 'searchWorker.js');

      const promises = filteredFiles.map(uri =>
        limit(() => this.runWorker(workerPath, uri, query!, this.searchOptions).then(matches => {
          this.searchResults.push(...matches);
        }))
      );

      progress.report({ increment: 0 });
      await Promise.all(promises);
      progress.report({ increment: 100 });

      if (this.searchResults.length > 0) {
        // 사이드바 뷰 업데이트
        this.viewProvider.updateSearchResults(this.searchResults, this.searchQuery, this.searchOptions);
        
        // 사이드바 뷰 표시
        await vscode.commands.executeCommand('advSearch.searchResults.focus');
        
        vscode.window.showInformationMessage(`${this.searchResults.length}개의 결과를 찾았습니다.`);
      } else {
        vscode.window.showInformationMessage("검색 결과가 없습니다.");
      }
    });
  }

  async getSearchOptions() {
    const options: any = {};

    const caseSensitive = await vscode.window.showQuickPick([
      "대소문자 무시",
      "대소문자 구분"
    ], { placeHolder: "대소문자 구분 여부를 선택하세요" });
    options.caseSensitive = caseSensitive === "대소문자 구분";

    const wholeWord = await vscode.window.showQuickPick([
      "부분 일치",
      "전체 단어"
    ], { placeHolder: "전체 단어 검색 여부를 선택하세요" });
    options.wholeWord = wholeWord === "전체 단어";

    const useRegex = await vscode.window.showQuickPick([
      "일반 검색",
      "정규식 검색"
    ], { placeHolder: "정규식 검색 여부를 선택하세요" });
    options.regex = useRegex === "정규식 검색";

    const commentOption = await vscode.window.showQuickPick([
      "주석 제외",
      "주석 포함",
      "주석만"
    ], { placeHolder: "주석 처리 옵션을 선택하세요" });
    options.includeComments = commentOption === "주석 포함";
    options.commentsOnly = commentOption === "주석만";

    return options;
  }

  nextMatch() {
    if (this.searchResults.length === 0) return;
    
    this.currentMatchIndex = (this.currentMatchIndex + 1) % this.searchResults.length;
    this.goToMatch(this.currentMatchIndex);
  }

  prevMatch() {
    if (this.searchResults.length === 0) return;

    this.currentMatchIndex = this.currentMatchIndex <= 0
      ? this.searchResults.length - 1
      : this.currentMatchIndex - 1;
    this.goToMatch(this.currentMatchIndex);
  }

  setCurrentMatchIndex(index: number) {
    if (index < 0 || index >= this.searchResults.length) return;
    this.currentMatchIndex = index;
  }

  async goToMatch(index: number) {
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

      // 현재 매치 하이라이트
      this.viewProvider.highlightMatch(index);
    } catch (error) {
      vscode.window.showErrorMessage(`파일을 열 수 없습니다: ${match.uri.fsPath}`);
    }
  }

  clearResults() {
    this.searchResults = [];
    this.searchQuery = "";
    this.currentMatchIndex = -1;
    this.viewProvider.clearResults();
  }

  pLimit(max: number) {
    let active = 0;
    const queue: (() => void)[] = [];

    const next = () => {
      active--;
      if (queue.length) queue.shift()!();
    };

    return (fn: () => Promise<any>) => new Promise((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(next);
      };

      active < max ? run() : queue.push(run);
    });
  }

  private runWorker(workerPath: string, uri: vscode.Uri, query: string, options: any): Promise<SearchMatch[]> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { workerData: { uri: uri.toString(), query, options } });
      worker.on('message', (matches: any[]) => {
        const parsed = matches.map(m => ({
          ...m,
          uri: vscode.Uri.parse(m.uri)
        }));
        resolve(parsed);
      });
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }
}

export function activate(context: vscode.ExtensionContext) {
  const searchProvider = AdvancedSearchProvider.getInstance();

  // 사이드바 뷰 프로바이더 등록
  const viewProvider = vscode.window.registerWebviewViewProvider(
    SearchViewProvider.viewType,
    searchProvider['viewProvider']
  );

  const searchCommand = vscode.commands.registerCommand("advSearch.searchIgnoreComments", (query, options) =>
    searchProvider.searchIgnoreComments(query, options)
  );
  
  const nextMatchCommand = vscode.commands.registerCommand("advSearch.nextMatch", () => 
    searchProvider.nextMatch()
  );
  
  const prevMatchCommand = vscode.commands.registerCommand("advSearch.prevMatch", () => 
    searchProvider.prevMatch()
  );

  const clearResultsCommand = vscode.commands.registerCommand("advSearch.clearResults", () => 
    searchProvider.clearResults()
  );

  context.subscriptions.push(
    viewProvider,
    searchCommand,
    nextMatchCommand,
    prevMatchCommand,
    clearResultsCommand
  );
}

export function deactivate() {} 