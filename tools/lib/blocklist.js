// Offensive-word blocklist: no board may spell one of these words across answers.
import { readFile } from 'node:fs/promises';
import { neighbors } from '../../js/grid.js';

export const BLOCKLIST_FILE = 'content/blocklist.txt';

// Word plus simple inflections: +S, +ES, +ED, +ING (and +D / E-dropping +ING for words ending in E,
// Y-to-IES/IED for words ending in Y).
export function inflections(word) {
  const out = [word, `${word}S`, `${word}ES`, `${word}ED`, `${word}ING`];
  if (word.endsWith('E')) out.push(`${word}D`, `${word.slice(0, -1)}ING`);
  if (word.endsWith('Y')) out.push(`${word.slice(0, -1)}IES`, `${word.slice(0, -1)}IED`);
  return out;
}

// Set of UPPERCASE blocked words (committed curated list, 4+ letters) with inflections.
export async function loadBlocklist({ file = BLOCKLIST_FILE } = {}) {
  const text = await readFile(file, 'utf8');
  const blockset = new Set();
  for (const line of text.split(/\r?\n/)) {
    const word = line.trim().toUpperCase();
    if (!/^[A-Z]{4,}$/.test(word)) continue;
    for (const w of inflections(word)) blockset.add(w);
  }
  return blockset;
}

// Every self-avoiding adjacent path spelling `word` (as arrays of cell indices).
function traces(grid, word) {
  const out = [];
  const walk = (path) => {
    if (path.length === word.length) { out.push([...path]); return; }
    for (const next of neighbors(path[path.length - 1])) {
      if (!path.includes(next) && grid[next] === word[path.length]) {
        path.push(next); walk(path); path.pop();
      }
    }
  };
  for (let i = 0; i < grid.length; i++) if (grid[i] === word[0]) walk([i]);
  return out;
}

// Blocked words spelled on the board (sorted). A word is exempt when every trace of it
// lies entirely within one answer's cells (e.g. RAPE inside PARAPET); any trace that
// spans cells of different answers counts. Letter counts prefilter before tracing.
export function offensiveWordsOn(grid, blockset, answers = []) {
  const counts = {};
  for (const ch of grid) counts[ch] = (counts[ch] ?? 0) + 1;
  const cellsOf = answers.map((a) => new Set(a.path));
  const nested = (trace) => cellsOf.some((cells) => trace.every((c) => cells.has(c)));
  const found = [];
  for (const word of blockset) {
    const need = {};
    let possible = true;
    for (const ch of word) {
      need[ch] = (need[ch] ?? 0) + 1;
      if (need[ch] > (counts[ch] ?? 0)) { possible = false; break; }
    }
    if (possible && traces(grid, word).some((t) => !nested(t))) found.push(word);
  }
  return found.sort();
}
