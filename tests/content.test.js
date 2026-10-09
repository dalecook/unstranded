import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../content/themes/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

const themes = files.map((file) => {
  const text = readFileSync(new URL(file, dir), 'utf8');
  let theme;
  try {
    theme = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} does not parse: ${err.message}`);
  }
  return { file, theme };
});

const KEYS = new Set(['id', 'clue', 'spangram', 'obscure', 'answers', 'recognized', 'familiar']);
const reverse = (w) => [...w].reverse().join('');

test('there are at least 55 themes, 9 to 14 of them obscure', () => {
  assert.ok(themes.length >= 55, `only ${themes.length} themes`);
  const obscure = themes.filter(({ theme }) => theme.obscure === true).length;
  assert.ok(obscure >= 9 && obscure <= 14, `${obscure} obscure themes`);
});

test('theme ids and spangrams are unique across themes', () => {
  const ids = themes.map(({ theme }) => theme.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate id');
  const spangrams = themes.map(({ theme }) => theme.spangram);
  assert.equal(new Set(spangrams).size, spangrams.length, 'duplicate spangram');
});

test('no word is an answer in two themes', () => {
  const owner = new Map();
  for (const { theme } of themes) {
    for (const w of theme.answers) {
      assert.ok(!owner.has(w), `${w} is an answer in both ${owner.get(w)} and ${theme.id}`);
      owner.set(w, theme.id);
    }
  }
});

for (const { file, theme } of themes) {
  test(`theme ${file}`, () => {
    for (const key of Object.keys(theme)) assert.ok(KEYS.has(key), `unknown key ${key}`);

    // id
    assert.match(theme.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.equal(`${theme.id}.json`, file, 'id must match the filename');

    // clue
    assert.equal(typeof theme.clue, 'string');
    assert.ok(theme.clue.trim().length > 0, 'empty clue');
    assert.equal(theme.clue, theme.clue.trim(), 'clue has stray whitespace');
    assert.ok(theme.clue.length <= 60, 'clue is too long');

    // spangram and flags
    assert.match(theme.spangram, /^[A-Z]{6,14}$/, 'spangram must be A-Z, 6-14 letters');
    assert.equal(typeof theme.obscure, 'boolean', 'obscure must be a boolean');

    // answers
    assert.ok(Array.isArray(theme.answers), 'answers must be an array');
    assert.ok(theme.answers.length >= 10, `only ${theme.answers.length} answers`);
    for (const w of theme.answers) assert.match(w, /^[A-Z]{6,10}$/, `bad answer ${w}`);

    // recognized
    assert.ok(Array.isArray(theme.recognized), 'recognized must be an array');
    assert.ok(theme.recognized.length >= 25, `only ${theme.recognized.length} recognized words`);
    for (const w of theme.recognized) assert.match(w, /^[A-Z]{4,}$/, `bad recognized word ${w}`);
    const shortWords = theme.recognized.filter((w) => w.length <= 5);
    assert.ok(shortWords.length >= 10, `only ${shortWords.length} recognized words of 4-5 letters`);

    // familiar overrides
    if ('familiar' in theme) {
      assert.ok(Array.isArray(theme.familiar), 'familiar must be an array');
      assert.equal(new Set(theme.familiar).size, theme.familiar.length, 'duplicate familiar word');
      for (const w of theme.familiar) {
        assert.ok(theme.answers.includes(w), `familiar word ${w} is not an answer`);
      }
    }

    // no duplicates within or between lists
    assert.equal(new Set(theme.answers).size, theme.answers.length, 'duplicate answer');
    assert.equal(new Set(theme.recognized).size, theme.recognized.length, 'duplicate recognized word');
    for (const w of theme.recognized) {
      assert.ok(!theme.answers.includes(w), `${w} is in both answers and recognized`);
    }
    assert.ok(!theme.answers.includes(theme.spangram), 'spangram repeated in answers');
    assert.ok(!theme.recognized.includes(theme.spangram), 'spangram repeated in recognized');

    // nesting rule: no theme word inside (forwards or reversed) another answer or the spangram
    const themeWords = [...theme.answers, ...theme.recognized];
    const containers = [...theme.answers, theme.spangram];
    for (const w of themeWords) {
      const r = reverse(w);
      for (const c of containers) {
        if (c === w) continue;
        assert.ok(!c.includes(w), `nesting: ${w} is inside ${c}`);
        assert.ok(!c.includes(r), `nesting: ${w} reversed is inside ${c}`);
      }
    }
  });
}
