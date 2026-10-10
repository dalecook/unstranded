// Builds data/words.txt: ENABLE (public domain) + Wordnik word list (MIT) + SCOWL en_US-large
// (hunspell, expanded) + content/dictionary-extra.txt + every theme word, then removes the
// offensive-word blocklist LAST: the board check list (curated content/blocklist.txt + LDNOOBW
// minus content/blocklist-allow.txt, with inflections) and content/blocklist-dictionary.txt are
// hard (everything); the full LDNOOBW list is soft (theme words exempt).
// Sources are cached in .cache/. Run with `npm run build:dictionary` and commit the output.
// `--from-existing` re-filters the committed data/words.txt offline with the same rules as a full
// build (theme words exempt from the soft LDNOOBW list; curated hard lists applied to everything).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadBlocklist, loadBoardBlocklist, loadLdnoobw } from './lib/blocklist.js';
import { fromExistingInput, mergeDictionary } from './lib/dictionary.js';
import { expandHunspell } from './lib/hunspell.js';
import { readZip } from './lib/zip.js';

const CACHE = fileURLToPath(new URL('../.cache/', import.meta.url));
const SOURCES = {
  enable: { file: 'enable1.txt', url: 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt' },
  wordnik: { file: 'wordnik.txt', url: 'https://raw.githubusercontent.com/wordnik/wordlist/main/wordlist-20210729.txt' },
  scowl: { file: 'scowl.zip', url: 'https://github.com/en-wl/wordlist/releases/download/rel-2026.02.25/hunspell-en_US-large-2026.02.25.zip' },
  ldnoobw: { file: 'ldnoobw-en.txt', url: 'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en' },
};
const WORDS_FILE = new URL('../data/words.txt', import.meta.url);
const EXTRA_FILE = new URL('../content/dictionary-extra.txt', import.meta.url);
const THEMES_DIR = new URL('../content/themes/', import.meta.url);
const DICT_BLOCK_FILE = fileURLToPath(new URL('../content/blocklist-dictionary.txt', import.meta.url));

const toLines = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// Raw bytes of a source: cache first, else download (and cache).
async function load({ file, url }) {
  const path = CACHE + file;
  if (existsSync(path)) return readFile(path);
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Could not download ${url} (${err.message}) and no cache exists at .cache/${file}`);
  }
  if (!res.ok) throw new Error(`Could not download ${url} (HTTP ${res.status}) and no cache exists at .cache/${file}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(CACHE, { recursive: true });
  await writeFile(path, buf);
  return buf;
}


function themeWords() {
  const out = [];
  for (const f of readdirSync(THEMES_DIR).filter((n) => n.endsWith('.json'))) {
    const t = JSON.parse(readFileSync(new URL(f, THEMES_DIR), 'utf8'));
    out.push(...(t.answers ?? []), ...(t.recognized ?? []));
    if (t.spangram) out.push(t.spangram);
  }
  return out;
}

const fromExisting = process.argv.includes('--from-existing');
const blockSet = new Set();
const softBlockSet = new Set();
let input;
if (fromExisting) {
  input = fromExistingInput({
    existing: toLines(readFileSync(WORDS_FILE, 'utf8')),
    extras: toLines(readFileSync(EXTRA_FILE, 'utf8')),
    themeWords: themeWords(),
  });
} else {
  const [enable, wordnik, scowlZip] = await Promise.all(Object.values(SOURCES).map(load)); // caches LDNOOBW too
  const files = readZip(scowlZip);
  const dic = files.get('en_US-large.dic');
  const aff = files.get('en_US-large.aff');
  if (!dic || !aff) throw new Error('SCOWL zip is missing en_US-large.dic/.aff');
  input = {
    sources: {
      enable: toLines(enable.toString('utf8')),
      wordnik: toLines(wordnik.toString('utf8')).map((l) => l.replace(/^"|"$/g, '')),
      scowl: expandHunspell(aff.toString('utf8'), dic.toString('utf8')),
    },
    extras: toLines(readFileSync(EXTRA_FILE, 'utf8')),
    themeWords: themeWords(),
  };
}
// LDNOOBW from .cache when present, else the committed snapshot (same source as the board check).
const ldnoobw = await loadLdnoobw();
for (const w of ldnoobw) softBlockSet.add(w.toLowerCase());
for (const w of await loadBoardBlocklist({ ldnoobw })) blockSet.add(w.toLowerCase());
for (const w of await loadBlocklist({ file: DICT_BLOCK_FILE })) blockSet.add(w.toLowerCase());

const { words, counts, removed, junk } = mergeDictionary({ ...input, blockSet, softBlockSet });
writeFileSync(WORDS_FILE, words.join('\n') + '\n');
for (const [name, n] of Object.entries(counts)) console.log(`  ${name}: ${n} valid words`);
console.log(`wrote ${words.length} words (${removed} removed by blocklist, ${junk} wordnik-only junk)`);
