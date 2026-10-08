// Builds data/words.txt from ENABLE (public domain), minus a profanity blocklist.
// Run once with `npm run build:dictionary` and commit the output.
import { writeFileSync } from 'node:fs';

const ENABLE_URL = 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt';
const BLOCKLIST_URL =
  'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en';

async function fetchLines(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.text()).split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean);
}

const [words, blocked] = await Promise.all([fetchLines(ENABLE_URL), fetchLines(BLOCKLIST_URL)]);
const blockSet = new Set(blocked.filter((w) => /^[a-z]+$/.test(w)));
const isBlocked = (w) => blockSet.has(w) || (w.endsWith('s') && blockSet.has(w.slice(0, -1)));

const kept = words.filter((w) => /^[a-z]{4,}$/.test(w) && !isBlocked(w));
writeFileSync(new URL('../data/words.txt', import.meta.url), kept.join('\n') + '\n');
console.log(`wrote ${kept.length} words (${words.length - kept.length} removed)`);
