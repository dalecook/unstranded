// Offensive-word blocklist: no board may spell one of these words across answers.
import { readFile } from 'node:fs/promises';
import { walkTraces } from './checks.js';

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

// Every legal trace spelling `word` (self-avoiding, no crossing diagonals), as cell-index arrays.
function traces(grid, word) {
  const out = [];
  walkTraces(grid, word, (path) => { out.push([...path]); });
  return out;
}

// True when `trace` is a contiguous run of `path`, in forward or reverse order.
function isRunOf(trace, path) {
  const start = path.indexOf(trace[0]);
  if (start < 0) return false;
  const fwd = trace.every((c, i) => path[start + i] === c);
  const rev = trace.every((c, i) => path[start - i] === c);
  return fwd || rev;
}

// Blocked words spelled on the board (sorted). A trace is exempt only when its cells are a
// contiguous run of one answer's path, forward or reversed (the blocked word is literally a
// substring of the answer as laid out, e.g. RAPE inside PARAPET); any other trace, scrambled
// within one answer or spanning answers, counts. Letter counts prefilter before tracing.
export function offensiveWordsOn(grid, blockset, answers = []) {
  const counts = {};
  for (const ch of grid) counts[ch] = (counts[ch] ?? 0) + 1;
  const nested = (trace) => answers.some((a) => isRunOf(trace, a.path));
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
