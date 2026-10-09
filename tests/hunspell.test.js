import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandHunspell } from '../tools/lib/hunspell.js';

const AFF = `SET UTF-8
NOSUGGEST !
PFX A Y 1
PFX A   0     re         .

SFX D Y 3
SFX D   0     d          e
SFX D   y     ied        [^aeiou]y
SFX D   0     ed         [^ey]

SFX N N 1
SFX N   0     ness       .

SFX S Y 1
SFX S   0     s          .
`;
const DIC = `6
bake/ADN
carry/ADN
walk/ADS
Paris/S
rude/!N
plain/S
`;

test('expands suffixes with strip/add/condition', () => {
  const w = expandHunspell(AFF, DIC);
  assert.ok(w.has('baked') && w.has('carried') && w.has('walked'));
  assert.ok(!w.has('bakeed') && !w.has('carryed') && !w.has('carryd'));
});

test('prefix and cross product only when both allow it', () => {
  const w = expandHunspell(AFF, DIC);
  assert.ok(w.has('rebake') && w.has('rebaked') && w.has('rewalks'));
  assert.ok(w.has('bakeness'));
  assert.ok(!w.has('rebakeness'), 'non-cross suffix is not combined with prefix');
});

test('skips proper nouns and NOSUGGEST entries, keeps base words', () => {
  const w = expandHunspell(AFF, DIC);
  assert.ok(!w.has('Paris') && !w.has('paris') && !w.has('pariss'));
  assert.ok(!w.has('rude') && !w.has('rudeness'));
  assert.ok(w.has('plain') && w.has('plains'));
});

test('rejects unsupported FLAG types', () => {
  assert.throws(() => expandHunspell('FLAG long\n', '0\n'), /FLAG/);
});
