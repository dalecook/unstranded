// Minimal hunspell expander: .aff PFX/SFX rules + .dic entries -> flat word list.
// Only single-character flags (the default) are supported; other directives are ignored.

export function parseAff(text) {
  const rules = { PFX: new Map(), SFX: new Map() };
  const meta = { noSuggest: null, onlyInCompound: null };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const t = line.split(/\s+/);
    const kind = t[0];
    if (kind === 'FLAG' && t[1] !== 'UTF-8') throw new Error(`Unsupported hunspell FLAG type: ${t[1]}`);
    if (kind === 'NOSUGGEST') meta.noSuggest = t[1];
    else if (kind === 'ONLYINCOMPOUND') meta.onlyInCompound = t[1];
    else if (kind === 'PFX' || kind === 'SFX') {
      if (t.length === 4 && /^[YN]$/.test(t[2])) { // header: kind flag cross count
        rules[kind].set(t[1], { cross: t[2] === 'Y', entries: [] });
      } else if (t.length >= 5) { // kind flag strip add[/flags] condition
        const group = rules[kind].get(t[1]);
        if (!group) continue;
        const slash = t[3].indexOf('/');
        const add = (slash < 0 ? t[3] : t[3].slice(0, slash));
        const strip = t[2] === '0' ? '' : t[2];
        const cond = t[4] === '.' ? null
          : new RegExp(kind === 'SFX' ? `(?:${t[4]})$` : `^(?:${t[4]})`);
        group.entries.push({ strip, add: add === '0' ? '' : add, cond });
      }
    }
  }
  return { ...rules, ...meta };
}

function applySfx(word, entry) {
  if (entry.cond && !entry.cond.test(word)) return null;
  if (entry.strip && !word.endsWith(entry.strip)) return null;
  return word.slice(0, word.length - entry.strip.length) + entry.add;
}
function applyPfx(word, entry) {
  if (entry.cond && !entry.cond.test(word)) return null;
  if (entry.strip && !word.startsWith(entry.strip)) return null;
  return entry.add + word.slice(entry.strip.length);
}

// Returns a Set of words. Capitalised entries (proper nouns) are skipped, as are entries
// flagged NOSUGGEST (offensive) or ONLYINCOMPOUND.
export function expandHunspell(affText, dicText) {
  const aff = parseAff(affText);
  const out = new Set();
  const lines = dicText.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) { // line 0 is the entry count
    const line = lines[i].trim();
    if (!line) continue;
    const slash = line.indexOf('/');
    const word = slash < 0 ? line : line.slice(0, slash);
    const flags = slash < 0 ? [] : [...line.slice(slash + 1).split(/\s+/)[0]];
    if (word !== word.toLowerCase()) continue;
    if (aff.noSuggest && flags.includes(aff.noSuggest)) continue;
    if (aff.onlyInCompound && flags.includes(aff.onlyInCompound)) continue;
    out.add(word);
    const sfxGroups = flags.map((f) => aff.SFX.get(f)).filter(Boolean);
    const pfxGroups = flags.map((f) => aff.PFX.get(f)).filter(Boolean);
    const sfxResults = []; // [{ word, cross }]
    for (const g of sfxGroups) {
      for (const e of g.entries) {
        const w = applySfx(word, e);
        if (w) { out.add(w); if (g.cross) sfxResults.push(w); }
      }
    }
    for (const g of pfxGroups) {
      for (const e of g.entries) {
        const w = applyPfx(word, e);
        if (!w) continue;
        out.add(w);
        if (!g.cross) continue;
        for (const s of sfxResults) {
          const w2 = applyPfx(s, e);
          if (w2) out.add(w2);
        }
      }
    }
  }
  return out;
}
