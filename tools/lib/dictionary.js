// Pure merge/filter step of the dictionary build.
const VALID = /^[a-z]{4,}$/;

// sources: { name: iterable of words } (unioned); extras and themeWords: iterables;
// blockSet: Set of lowercase blocked words. The blocklist is applied LAST, to everything.
// Returns { words (sorted, deduped), counts: { [source]: valid words contributed }, removed }.
export function mergeDictionary({ sources = {}, extras = [], themeWords = [], blockSet = new Set() }) {
  const all = new Set();
  const counts = {};
  const add = (name, list) => {
    let n = 0;
    for (const raw of list) {
      const w = String(raw).trim().toLowerCase();
      if (VALID.test(w)) { all.add(w); n++; }
    }
    counts[name] = n;
  };
  for (const [name, list] of Object.entries(sources)) add(name, list);
  add('extras', extras);
  add('themes', themeWords);
  const blocked = (w) => blockSet.has(w) || (w.endsWith('s') && blockSet.has(w.slice(0, -1)));
  const words = [];
  for (const w of all) if (!blocked(w)) words.push(w);
  words.sort();
  return { words, counts, removed: all.size - words.length };
}
