// Pure merge/filter step of the dictionary build.
const VALID = /^[a-z]{4,}$/;
const JUNK = [/^[^aeiouy]+$/, /^[ivxlcdm]+$/, /(.)\1\1/]; // no vowel, Roman numeral, aaa-style run

// sources: { name: iterable of words } (unioned); extras and themeWords: iterables.
// blockSet: Set of lowercase curated blocked words, applied LAST to everything.
// softBlockSet: broader list (e.g. LDNOOBW) applied to sources and extras but not theme words.
// Words found only in the `wordnik` source are dropped when they look like junk.
// Returns { words (sorted, deduped), counts: { [source]: valid words contributed }, removed, junk }.
export function mergeDictionary({ sources = {}, extras = [], themeWords = [], blockSet = new Set(), softBlockSet = new Set() }) {
  const origins = new Map(); // word -> Set of source names
  const counts = {};
  const add = (name, list) => {
    let n = 0;
    for (const raw of list) {
      const w = String(raw).trim().toLowerCase();
      if (!VALID.test(w)) continue;
      if (!origins.has(w)) origins.set(w, new Set());
      origins.get(w).add(name);
      n++;
    }
    counts[name] = n;
  };
  for (const [name, list] of Object.entries(sources)) add(name, list);
  add('extras', extras);
  add('themes', themeWords);
  const inSet = (set, w) => set.has(w) || (w.endsWith('s') && set.has(w.slice(0, -1)));
  const words = [];
  let junk = 0;
  for (const [w, from] of origins) {
    if (inSet(blockSet, w)) continue;
    if (!from.has('themes') && inSet(softBlockSet, w)) continue;
    if (from.size === 1 && from.has('wordnik') && JUNK.some((re) => re.test(w))) { junk++; continue; }
    words.push(w);
  }
  words.sort();
  return { words, counts, removed: origins.size - words.length, junk };
}

// Input for `--from-existing`: re-filter the committed word list offline under exactly the same
// rules as a full build. Extras and theme words ride along so theme words stay exempt from the
// soft list (curated hard lists still apply to everything inside mergeDictionary).
export function fromExistingInput({ existing = [], extras = [], themeWords = [] } = {}) {
  return { sources: { existing }, extras, themeWords };
}
