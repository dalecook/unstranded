import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const URL = 'https://norvig.com/ngrams/count_1w.txt';
export const FAMILIAR_RANK = 60000;
export const OBSCURE_RANK = 200000;

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
export async function loadRanks({ cacheDir = '.cache', fetchImpl = fetch } = {}) {
  const file = join(cacheDir, 'count_1w.txt');
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    text = await download(fetchImpl);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, text);
  }
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
