import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromExistingInput, mergeDictionary } from '../tools/lib/dictionary.js';

test('unions sources, sorts and dedupes', () => {
  const { words } = mergeDictionary({ sources: { a: ['water', 'house'], b: ['House', 'bread'] } });
  assert.deepEqual(words, ['bread', 'house', 'water']);
});

test('adds extras and theme words', () => {
  const { words, counts } = mergeDictionary({
    sources: { a: ['house'] }, extras: ['MATCHA'], themeWords: ['KAKAPO', 'NEWZEALAND'],
  });
  assert.deepEqual(words, ['house', 'kakapo', 'matcha', 'newzealand']);
  assert.equal(counts.extras, 1);
  assert.equal(counts.themes, 2);
});

test('filters length and charset', () => {
  const { words } = mergeDictionary({ sources: { a: ['cat', "don't", 'abc1', 'café', 'ice cream', 'goose'] } });
  assert.deepEqual(words, ['goose']);
});

test('blocklist is applied last, even to extras and theme words, incl. simple plurals', () => {
  const { words, removed } = mergeDictionary({
    sources: { a: ['house', 'badword'] },
    extras: ['EXTRABAD'],
    themeWords: ['THEMEBAD', 'badwords', 'goose'],
    blockSet: new Set(['badword', 'extrabad', 'themebad']),
  });
  assert.deepEqual(words, ['goose', 'house']);
  assert.equal(removed, 4);
});

test('soft (LDNOOBW) blocklist spares theme words but applies to sources and extras', () => {
  const { words } = mergeDictionary({
    sources: { a: ['hardcore', 'house'] },
    extras: ['softextra'],
    themeWords: ['hardcore', 'softtheme'],
    softBlockSet: new Set(['hardcore', 'softextra', 'softtheme']),
  });
  assert.deepEqual(words, ['hardcore', 'house', 'softtheme']);
  const { words: w2 } = mergeDictionary({
    sources: { a: ['hardcore', 'house'] },
    softBlockSet: new Set(['hardcore']),
  });
  assert.deepEqual(w2, ['house']);
});

test('curated blocklist still removes theme words', () => {
  const { words } = mergeDictionary({ themeWords: ['themebad', 'goose'], blockSet: new Set(['themebad']) });
  assert.deepEqual(words, ['goose']);
});

test('wordnik-only junk is dropped: vowelless, roman numerals, triple letters', () => {
  const { words, junk } = mergeDictionary({
    sources: { wordnik: ['brrrr', 'xxxvi', 'mmmm', 'aaaah', 'cwtch', 'tsktsk', 'house', 'ivxl', 'rhythm'], enable: ['tsktsk', 'cwtch'] },
    extras: ['mmmm'],
  });
  assert.deepEqual(words, ['cwtch', 'house', 'mmmm', 'rhythm', 'tsktsk']);
  assert.equal(junk, 4);
});

test('--from-existing applies the same rules as a full build (theme words spared by the soft list)', () => {
  const opts = {
    blockSet: new Set(['badword', 'themebad']),
    softBlockSet: new Set(['hardcore', 'softword']),
  };
  const existing = ['hardcore', 'house', 'softword', 'badword', 'themebad'];
  const themeWords = ['HARDCORE', 'THEMEBAD'];
  const full = mergeDictionary({ sources: { a: existing }, themeWords, ...opts }).words;
  const refiltered = mergeDictionary({ ...fromExistingInput({ existing, themeWords }), ...opts }).words;
  assert.deepEqual(full, ['hardcore', 'house']);
  assert.deepEqual(refiltered, full);
});
