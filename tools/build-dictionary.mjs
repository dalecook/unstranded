// Builds data/words.txt from ENABLE (public domain), minus a profanity blocklist and the
// curated content/blocklist.txt (with the same inflections the drop builder blocks).
// Run once with `npm run build:dictionary` and commit the output.
// `--from-existing` re-filters the committed data/words.txt against content/blocklist.txt
// without downloading anything (use after editing the curated blocklist).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadBlocklist } from './lib/blocklist.js';

const ENABLE_URL = 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt';
const BLOCKLIST_URL =
  'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en';
const WORDS_FILE = new URL('../data/words.txt', import.meta.url);
const CURATED_FILE = fileURLToPath(new URL('../content/blocklist.txt', import.meta.url));

const toLines = (text) => text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean);

async function fetchLines(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return toLines(await res.text());
}

const fromExisting = process.argv.includes('--from-existing');
let words;
let blockSet = new Set();
if (fromExisting) {
  words = toLines(readFileSync(WORDS_FILE, 'utf8'));
} else {
  const [all, blocked] = await Promise.all([fetchLines(ENABLE_URL), fetchLines(BLOCKLIST_URL)]);
  words = all;
  blockSet = new Set(blocked.filter((w) => /^[a-z]+$/.test(w)));
}
for (const w of await loadBlocklist({ file: CURATED_FILE })) blockSet.add(w.toLowerCase());
const isBlocked = (w) => blockSet.has(w) || (w.endsWith('s') && blockSet.has(w.slice(0, -1)));

const kept = words.filter((w) => /^[a-z]{4,}$/.test(w) && !isBlocked(w));
writeFileSync(WORDS_FILE, kept.join('\n') + '\n');
console.log(`wrote ${kept.length} words (${words.length - kept.length} removed)`);
