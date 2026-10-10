// Offensive-word blocklist: no board may spell one of these words across answers.
// Board list = curated content/blocklist.txt + LDNOOBW single words (4+ letters, a-z), with
// inflections, minus the innocent words in content/blocklist-allow.txt (and their inflections).
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { walkTraces } from './checks.js';

const repo = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
export const BLOCKLIST_FILE = repo('content/blocklist.txt');
export const ALLOWLIST_FILE = repo('content/blocklist-allow.txt');
export const LDNOOBW_CACHE_FILE = repo('.cache/ldnoobw-en.txt');
export const LDNOOBW_SNAPSHOT_FILE = repo('content/ldnoobw-en.txt');

// Word plus simple inflections: +S, +ES, +ED, +ING (and +D / E-dropping +ING for words ending in E,
// Y-to-IES/IED for words ending in Y).
export function inflections(word) {
  const out = [word, `${word}S`, `${word}ES`, `${word}ED`, `${word}ING`];
  if (word.endsWith('E')) out.push(`${word}D`, `${word.slice(0, -1)}ING`);
  if (word.endsWith('Y')) out.push(`${word.slice(0, -1)}IES`, `${word.slice(0, -1)}IED`);
  return out;
}

// UPPERCASE 4+ letter a-z words of a list file ('#' comment lines and anything else skipped).
async function readWords(file) {
  const text = await readFile(file, 'utf8');
  return text.split(/\r?\n/).map((l) => l.trim().toUpperCase()).filter((w) => /^[A-Z]{4,}$/.test(w));
}

// Set of UPPERCASE blocked words from one list file (4+ letters) with inflections.
export async function loadBlocklist({ file = BLOCKLIST_FILE } = {}) {
  const blockset = new Set();
  for (const word of await readWords(file)) for (const w of inflections(word)) blockset.add(w);
  return blockset;
}

// LDNOOBW single words (UPPERCASE, 4+ letters a-z): the downloaded .cache copy when present,
// else the committed filtered snapshot content/ldnoobw-en.txt.
export async function loadLdnoobw({ cacheFile = LDNOOBW_CACHE_FILE, snapshotFile = LDNOOBW_SNAPSHOT_FILE } = {}) {
  return [...new Set(await readWords(existsSync(cacheFile) ? cacheFile : snapshotFile))];
}

// The board check list: curated + LDNOOBW words with inflections, minus allowlisted words and
// their inflections (an LDNOOBW entry that is itself an allowed inflection is skipped whole).
export async function loadBoardBlocklist({ file = BLOCKLIST_FILE, allowFile = ALLOWLIST_FILE, ldnoobw } = {}) {
  const allowed = new Set((await readWords(allowFile)).flatMap(inflections));
  const words = [...await readWords(file), ...(ldnoobw ?? await loadLdnoobw())];
  const blockset = new Set();
  for (const word of words) {
    if (allowed.has(word)) continue;
    for (const w of inflections(word)) if (!allowed.has(w)) blockset.add(w);
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
