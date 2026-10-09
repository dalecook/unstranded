import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const URL = 'https://norvig.com/ngrams/count_1w.txt';
export const FAMILIAR_RANK = 120000;
export const OBSCURE_RANK = 300000;
// The real list has ~333k entries; one at or below the obscure cutoff is truncated or corrupt.
export const MIN_ENTRIES = OBSCURE_RANK + 1;

async function download(fetchImpl) {
  let res;
  try {
    res = await fetchImpl(URL);
  } catch (err) {
    throw new Error(`Could not download the word frequency list (${err.message}) and no cache exists`);
  }
  if (!res.ok) {
    throw new Error(`Could not download the word frequency list (HTTP ${res.status}) and no cache exists`);
  }
  return res.text();
}

// Map of UPPERCASE word -> 1-based rank (file is sorted by count, descending).
// A cache with too few entries (truncated or corrupt) is re-downloaded; a short download throws.
export async function loadRanks({
  cacheDir = '.cache', fetchImpl = fetch, minEntries = MIN_ENTRIES, log = console.error,
} = {}) {
  const file = join(cacheDir, 'count_1w.txt');
  let ranks = null;
  try {
    ranks = parseRanks(await readFile(file, 'utf8'));
  } catch {
    // no cache yet
  }
  if (ranks && ranks.size < minEntries) {
    log(`word frequency cache has only ${ranks.size} entries (need ${minEntries}); re-downloading`);
    ranks = null;
  }
  if (!ranks) {
    const text = await download(fetchImpl);
    ranks = parseRanks(text);
    if (ranks.size < minEntries) {
      throw new Error(`Downloaded word frequency list looks truncated or corrupt (${ranks.size} entries, need ${minEntries})`);
    }
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, text);
  }
  log(`word frequency list: ${ranks.size} entries`);
  return ranks;
}

function parseRanks(text) {
  const ranks = new Map();
  let rank = 0;
  for (const line of text.split('\n')) {
    const word = line.split('\t')[0].trim();
    if (!word) continue;
    ranks.set(word.toUpperCase(), ++rank);
  }
  return ranks;
}

export function isFamiliar(word, ranks, { obscure = false, overrides = [] } = {}) {
  if (overrides.includes(word)) return true;
  const rank = ranks.get(word);
  return rank !== undefined && rank <= (obscure ? OBSCURE_RANK : FAMILIAR_RANK);
}

// Joined multi-word answers (e.g. PINOTNOIR) are not in the corpus; list them in theme.familiar.
export function eligibleAnswers(theme, ranks) {
  const opts = { obscure: !!theme.obscure, overrides: theme.familiar ?? [] };
  const eligible = [];
  const rejected = [];
  for (const word of theme.answers) {
    (isFamiliar(word, ranks, opts) ? eligible : rejected).push(word);
  }
  return { eligible, rejected };
}
