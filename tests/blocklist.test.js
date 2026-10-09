import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBlocklist, offensiveWordsOn, inflections } from '../tools/lib/blocklist.js';

test('loadBlocklist reads the list, keeps 4+ letter words and adds inflections', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'block-'));
  const file = join(dir, 'list.txt');
  await writeFile(file, 'FELLATE\r\nsmut\n\nABC\nX-RATED\n');
  const set = await loadBlocklist({ file });
  for (const w of ['FELLATE', 'FELLATES', 'FELLATED', 'FELLATING', 'SMUT', 'SMUTS', 'SMUTING']) assert.ok(set.has(w), w);
  for (const w of ['ABC', 'XRATED', 'X-RATED']) assert.ok(!set.has(w), w);
});

test('the committed list loads and includes FELLATE', async () => {
  const set = await loadBlocklist();
  assert.ok(set.has('FELLATE'));
  assert.ok(set.has('FELLATIO'));
});

test('inflections', () => {
  assert.deepEqual(inflections('SMUT'), ['SMUT', 'SMUTS', 'SMUTES', 'SMUTED', 'SMUTING']);
  assert.ok(inflections('FELLATE').includes('FELLATED'));
  assert.ok(inflections('FELLATE').includes('FELLATING'));
  assert.ok(inflections('ORGY').includes('ORGIES'));
});

// 6 columns x 8 rows; row strings joined into a 48-cell grid.
const gridOf = (rows) => rows.join('').split('');
const blockset = new Set(['FELLATE', 'FELLATES', 'SMUT']);

test('offensiveWordsOn flags a board that traces a blocked word', () => {
  const grid = gridOf(['FELXXX', 'XXLAXX', 'XXXTEX', 'XXXXXX', 'XXXXXX', 'XXXXXX', 'XXXXXX', 'XXXXXX']);
  assert.deepEqual(offensiveWordsOn(grid, blockset), ['FELLATE']);
});

test('offensiveWordsOn passes a clean board', () => {
  const grid = gridOf(['FELXXX', 'XXXXXX', 'XXLATE', 'XXXXXX', 'SMXUTX', 'XXXXXX', 'XXXXXX', 'XXXXXX']);
  assert.deepEqual(offensiveWordsOn(grid, blockset), []);
});

// Row 0 holds "XSMUTX": SMUT is cells 1-4.
const smutGrid = gridOf(['XSMUTX', 'XXXXXX', 'XXXXXX', 'XXXXXX', 'XXXXXX', 'XXXXXX', 'XXXXXX', 'XXXXXX']);

test('a word nested inside a single answer is allowed', () => {
  const answers = [{ word: 'XSMUTX', path: [0, 1, 2, 3, 4, 5] }];
  assert.deepEqual(offensiveWordsOn(smutGrid, blockset, answers), []);
});

test('a trace spanning two answers is flagged', () => {
  const answers = [{ word: 'XSM', path: [0, 1, 2] }, { word: 'UTX', path: [3, 4, 5] }];
  assert.deepEqual(offensiveWordsOn(smutGrid, blockset, answers), ['SMUT']);
});

test('one nested trace does not excuse another that spans answers', () => {
  // SMUT on row 0 (inside one answer) and again across rows 2-3 (two answers).
  const grid = gridOf(['XSMUTX', 'XXXXXX', 'SMXXXX', 'XXUTXX', 'XXXXXX', 'XXXXXX', 'XXXXXX', 'XXXXXX']);
  const answers = [
    { word: 'XSMUTX', path: [0, 1, 2, 3, 4, 5] },
    { word: 'SM', path: [12, 13] },
    { word: 'UT', path: [20, 21] },
  ];
  assert.deepEqual(offensiveWordsOn(grid, blockset, answers), ['SMUT']);
});
