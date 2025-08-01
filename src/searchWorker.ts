import { parentPort, workerData } from 'worker_threads';
import * as vscode from 'vscode';
import { SearchEngine, SearchMatch, SearchOptions } from './searchEngine';

async function run() {
  const { uri, query, options } = workerData as { uri: string; query: string; options: SearchOptions };
  const matches: SearchMatch[] = [];
  await SearchEngine.searchFile(vscode.Uri.parse(uri), query, options, (m) => {
    matches.push({ ...m });
  });
  parentPort?.postMessage(matches.map(m => ({
    ...m,
    uri: m.uri.toString()
  })));
}

run();
