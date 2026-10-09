import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/rng.js';
import { CELLS, pathsCross } from '../js/grid.js';
import { chooseWords, layoutWords, verifyPuzzle, generateForTheme, buildPuzzle } from '../tools/lib/layout.js';

const UTENSILS = {
  id: 'utensils',
  clue: 'Drawer full of tools',
  spangram: 'UTENSILS',
  words: ['WHISK', 'LADLE', 'TONGS', 'SPATULA', 'GRATER', 'PEELER', 'SCOOP', 'MASHER', 'SKEWER', 'STRAINER', 'ZESTER', 'SPOON'],
};
const PLANETS = {
  id: 'solarsystem',
  clue: 'Space neighbours',
  spangram: 'SOLARSYSTEM',
  words: ['MERCURY', 'VENUS', 'EARTH', 'MARS', 'JUPITER', 'SATURN', 'URANUS', 'NEPTUNE', 'PLUTO', 'MOON', 'COMET'],
};

test('chooseWords fills the board exactly with 5-7 other words', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const words = chooseWords(UTENSILS, mulberry32(seed));
    assert.ok(words, `seed ${seed} found no subset`);
    const total = words.reduce((sum, w) => sum + w.length, 0);
    assert.equal(total + UTENSILS.spangram.length, CELLS);
    assert.ok(words.length >= 5 && words.length <= 7);
    assert.equal(new Set(words).size, words.length);
  }
});

test('chooseWords is deterministic for a seed', () => {
  assert.deepEqual(chooseWords(UTENSILS, mulberry32(9)), chooseWords(UTENSILS, mulberry32(9)));
});

test('chooseWords returns null when no subset can fill the board', () => {
  const tiny = { id: 't', clue: 't', spangram: 'ABCDEF', words: ['ABCD', 'EFGH'] };
  assert.equal(chooseWords(tiny, mulberry32(1)), null);
});

test('layoutWords produces a verified, fully covered grid', () => {
  const rand = mulberry32(123);
  const words = chooseWords(UTENSILS, rand);
  const layout = layoutWords(UTENSILS.spangram, words, rand);
  assert.ok(layout);
  assert.equal(layout.grid.length, CELLS);
  assert.ok(layout.grid.every((ch) => /^[A-Z]$/.test(ch)));
  assert.equal(layout.answers[0].word, 'UTENSILS');
  assert.equal(layout.answers[0].isSpangram, true);
  assert.equal(layout.answers.filter((a) => a.isSpangram).length, 1);
  assert.ok(verifyPuzzle(layout));
});

test('verifyPuzzle rejects a tampered grid', () => {
  const rand = mulberry32(6);
  const layout = layoutWords(UTENSILS.spangram, chooseWords(UTENSILS, rand), rand);
  const cell = layout.answers[1].path[0];
  const grid = [...layout.grid];
  grid[cell] = grid[cell] === 'Q' ? 'Z' : 'Q';
  assert.equal(verifyPuzzle({ ...layout, grid }), false);
});

test('generateForTheme carries theme metadata', () => {
  const puzzle = generateForTheme(PLANETS, mulberry32(3));
  assert.ok(puzzle);
  assert.equal(puzzle.themeId, 'solarsystem');
  assert.equal(puzzle.clue, 'Space neighbours');
  assert.ok(verifyPuzzle(puzzle));
});

test('buildPuzzle is deterministic per seed', () => {
  const themes = [UTENSILS, PLANETS];
  assert.deepEqual(buildPuzzle(themes, 2026), buildPuzzle(themes, 2026));
  assert.equal(buildPuzzle(themes, 2026).seed, 2026);
});

test('buildPuzzle gives different boards for different seeds', () => {
  const themes = [UTENSILS, PLANETS];
  const grids = new Set();
  for (let seed = 1; seed <= 20; seed++) grids.add(buildPuzzle(themes, seed).grid.join(''));
  assert.ok(grids.size >= 18);
});

test('buildPuzzle throws when no theme can be generated', () => {
  const broken = { id: 'b', clue: 'b', spangram: 'ABCDEF', words: ['ABCD'] };
  assert.throws(() => buildPuzzle([broken], 1), /Could not generate/);
});

test('chooseWords honours explicit counts and shuffle: false', () => {
  const theme = { id: 't', clue: 't', spangram: 'ABCDEFGH', words: ['AAAAAAAAAA', 'BBBBBBBBBB', 'CCCCCCCCCC', 'DDDDDDDDDD', 'EEEEEEEEEE'] };
  const four = ['AAAAAAAAAA', 'BBBBBBBBBB', 'CCCCCCCCCC', 'DDDDDDDDDD'];
  assert.deepEqual(chooseWords(theme, mulberry32(1), { shuffle: false }), four);
  assert.deepEqual(chooseWords(theme, mulberry32(1), { minCount: 4, maxCount: 4, shuffle: false }), four);
  assert.equal(chooseWords(theme, mulberry32(1), { minCount: 5, maxCount: 7, shuffle: false }), null);
});

test('verifyPuzzle rejects a layout whose answer paths cross', () => {
  const board = (pair) => {
    const paths = [[0, 6, 12, 18, 24, 30, 36, 42], ...pair, [3, 4], [5, 11], [9, 10]];
    for (let col = 1; col <= 5; col++) {
      for (let row = 2; row <= 6; row += 2) paths.push([row * 6 + col, (row + 1) * 6 + col]);
    }
    const answers = paths.map((path, k) => ({ word: 'A'.repeat(path.length), path, isSpangram: k === 0 }));
    return { grid: new Array(CELLS).fill('A'), answers };
  };
  assert.equal(verifyPuzzle(board([[1, 2], [7, 8]])), true);
  assert.equal(verifyPuzzle(board([[1, 8], [2, 7]])), false);
});

test('layoutWords never crosses diagonal links', () => {
  let built = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const theme = seed % 2 ? UTENSILS : PLANETS;
    const rand = mulberry32(seed);
    const layout = layoutWords(theme.spangram, chooseWords(theme, rand), rand);
    if (!layout) continue;
    built++;
    assert.equal(pathsCross(layout.answers.map((a) => a.path)), false, `seed ${seed} crosses`);
  }
  assert.ok(built >= 20);
});
