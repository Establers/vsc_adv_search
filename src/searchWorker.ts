import { parentPort, workerData } from 'worker_threads';

import { URI } from 'vscode-uri';
import { SearchEngine, SearchMatch, SearchOptions } from './searchEngine';

async function run() {
  const { uri, query, options } = workerData as { uri: string; query: string; options: SearchOptions };
  const matches: SearchMatch[] = [];

  await SearchEngine.searchFile(URI.parse(uri), query, options, (m) => {
    matches.push({ ...m });
  });
  parentPort?.postMessage(matches.map(m => ({
    ...m,
    uri: m.uri.toString()
  })));
}

run();
