import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseWords } from '../js/generator.js';
import { mulberry32 } from '../js/rng.js';

const themes = JSON.parse(readFileSync(new URL('../data/themes.json', import.meta.url), 'utf8'));

test('there are at least 90 themes with unique ids and spangrams', () => {
  assert.ok(themes.length >= 90, `only ${themes.length} themes`);
  assert.equal(new Set(themes.map((t) => t.id)).size, themes.length);
  assert.equal(new Set(themes.map((t) => t.spangram)).size, themes.length);
});

for (const theme of themes) {
  test(`theme "${theme.id}" is valid`, () => {
    assert.equal(typeof theme.clue, 'string');
    assert.ok(theme.clue.trim().length > 0);
    assert.match(theme.spangram, /^[A-Z]{6,14}$/);
    assert.ok(theme.words.length >= 10, 'needs at least 10 words for variety');
    for (const w of theme.words) assert.match(w, /^[A-Z]{4,9}$/, `bad word ${w}`);
    assert.equal(new Set(theme.words).size, theme.words.length, 'duplicate words');
    assert.ok(!theme.words.includes(theme.spangram), 'spangram repeated in words');

    const subsets = new Set();
    for (let seed = 1; seed <= 20; seed++) {
      const words = chooseWords(theme, mulberry32(seed));
      assert.ok(words, `no word subset for seed ${seed}`);
      subsets.add([...words].sort().join(','));
    }
    assert.ok(subsets.size >= 3, `only ${subsets.size} distinct word sets`);
  });
}
