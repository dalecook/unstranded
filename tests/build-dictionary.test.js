import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDictionary } from '../tools/lib/dictionary.js';

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
