import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/rng.js';
import { CELLS, neighbors, pathsCross } from '../js/grid.js';
import { chooseWords, layoutWords, verifyPuzzle } from '../tools/lib/layout.js';
import { countTraces, isTraceable, directionVariants, checkPuzzle, difficulty } from '../tools/lib/checks.js';

function gridWith(letters) {
  const grid = new Array(CELLS).fill('X');
  for (const [cell, ch] of Object.entries(letters)) grid[cell] = ch;
  return grid;
}

test('countTraces returns 1 for a unique word', () => {
  const grid = gridWith({ 0: 'C', 1: 'A', 2: 'T' });
  assert.equal(countTraces(grid, 'CAT'), 1);
  assert.equal(isTraceable(grid, 'CAT'), true);
});

test('countTraces counts a second route from a duplicate letter', () => {
  const grid = gridWith({ 0: 'C', 1: 'A', 2: 'T', 8: 'T' });
  assert.equal(countTraces(grid, 'CAT'), 2);
});

test('countTraces stops at the cap', () => {
  const grid = gridWith({ 0: 'C', 1: 'A', 2: 'T', 8: 'T' });
  assert.equal(countTraces(grid, 'CAT', 1), 1);
});

test('countTraces returns 0 when the word is absent', () => {
  const grid = gridWith({ 0: 'C', 1: 'A', 2: 'T' });
  assert.equal(countTraces(grid, 'DOG'), 0);
  assert.equal(isTraceable(grid, 'DOG'), false);
});

test('countTraces never reuses a cell', () => {
  const grid = gridWith({ 0: 'A', 1: 'B' });
  assert.equal(countTraces(grid, 'ABA'), 0);
});

test('countTraces ignores a route that crosses itself', () => {
  // A(0) B(7) C(6) D(1) steps 0-7 and 6-1 cross; D(12) is the legal ending.
  const grid = gridWith({ 0: 'A', 7: 'B', 6: 'C', 1: 'D', 12: 'D' });
  assert.equal(countTraces(grid, 'ABCD'), 1);
  assert.equal(countTraces(gridWith({ 0: 'A', 7: 'B', 6: 'C', 1: 'D' }), 'ABCD'), 0);
  assert.equal(isTraceable(gridWith({ 0: 'A', 7: 'B', 6: 'C', 1: 'D' }), 'ABCD'), false);
});

test('with selfCrossing, traces may cross themselves but still never reuse a cell', () => {
  const any = { selfCrossing: true };
  const grid = gridWith({ 0: 'A', 7: 'B', 6: 'C', 1: 'D', 12: 'D' });
  assert.equal(countTraces(grid, 'ABCD', Infinity, any), 2);
  assert.equal(countTraces(grid, 'ABCD', 1, any), 1);
  const crossedOnly = gridWith({ 0: 'A', 7: 'B', 6: 'C', 1: 'D' });
  assert.equal(countTraces(crossedOnly, 'ABCD', Infinity, any), 1);
  assert.equal(isTraceable(crossedOnly, 'ABCD', any), true);
  assert.equal(isTraceable(crossedOnly, 'ABCD', { selfCrossing: false }), false);
  assert.equal(countTraces(gridWith({ 0: 'A', 1: 'B' }), 'ABA', Infinity, any), 0);
});

const THEME = {
  id: 'utensils',
  clue: 'Drawer full of tools',
  spangram: 'UTENSILS',
  words: ['WHISK', 'LADLE', 'TONGS', 'SPATULA', 'GRATER', 'PEELER', 'SCOOP', 'MASHER', 'SKEWER', 'STRAINER', 'ZESTER', 'SPOON'],
};

function layoutFor(seed) {
  const rand = mulberry32(seed);
  const words = chooseWords(THEME, rand, { minCount: 5, maxCount: 7 });
  return words && layoutWords(THEME.spangram, words, rand);
}

function tracedWords(grid, length, visit) {
  const walk = (path) => {
    if (path.length === length) {
      visit(path.map((c) => grid[c]).join(''));
      return;
    }
    for (const n of neighbors(path[path.length - 1])) {
      if (!path.includes(n) && !pathsCross([[...path, n]])) walk([...path, n]);
    }
  };
  for (let i = 0; i < CELLS; i++) walk([i]);
}

// Distinct 4-letter strings that are traceable but not inside any answer.
function stoneWords(grid, answers, count) {
  const found = new Set();
  tracedWords(grid, 4, (w) => {
    const inside = answers.some(({ word }) => word.includes(w) || [...word].reverse().join('').includes(w));
    if (!inside) found.add(w);
  });
  return [...found].sort().slice(0, count);
}

function themeFor(variant, recognized) {
  return { answers: variant.answers.map((a) => a.word), recognized };
}

// Deterministic search for a passing fixture.
let cached = null;
function findPassing() {
  if (!cached) cached = searchPassing();
  return cached;
}

function searchPassing() {
  for (let seed = 1; seed < 200; seed++) {
    const layout = layoutFor(seed);
    if (!layout) continue;
    for (const variant of directionVariants(layout)) {
      // Cheap pre-filter: only unambiguous, decoy-free variants reach the stone search.
      if (checkPuzzle(variant, themeFor(variant, [])).reason !== 'stones') continue;
      const recognized = stoneWords(variant.grid, variant.answers, 3);
      const theme = themeFor(variant, recognized);
      if (recognized.length === 3 && checkPuzzle(variant, theme).ok) return { variant, theme };
    }
  }
  throw new Error('no passing fixture found');
}

test('directionVariants yields 2^k valid variants, first is all-forward', () => {
  const layout = layoutFor(3);
  const variants = [...directionVariants(layout)];
  assert.equal(variants.length, 2 ** layout.answers.length);
  for (const v of variants) assert.ok(verifyPuzzle(v));
  assert.deepEqual(variants[0], layout);
  assert.deepEqual(variants[1].answers.map((a) => a.word), layout.answers.map((a) => a.word));
  assert.equal(variants[1].answers[0].isSpangram, true);
});

test('checkPuzzle accepts a passing fixture and lists exact stepping stones', () => {
  const { variant, theme } = findPassing();
  const result = checkPuzzle(variant, theme);
  assert.equal(result.ok, true);
  assert.deepEqual(result.steppingStones, [...theme.recognized].sort());
});

test('checkPuzzle reports invalid', () => {
  const { variant, theme } = findPassing();
  const grid = [...variant.grid];
  grid[0] = grid[0] === 'Q' ? 'Z' : 'Q';
  assert.equal(checkPuzzle({ grid, answers: variant.answers }, theme).reason, 'invalid');
});

test('checkPuzzle reports invalid, not crossing, for malformed paths', () => {
  const grid = new Array(CELLS).fill('X');
  const crossing = (first) => [
    { word: 'XX', path: first, isSpangram: true },
    { word: 'XX', path: [1, 6], isSpangram: false },
  ];
  const theme = { answers: [], recognized: [] };
  // Wrong length, non-adjacent step, out-of-range cell: each would otherwise read as a crossing.
  assert.equal(checkPuzzle({ grid, answers: [{ word: 'XXX', path: [0, 7], isSpangram: true }, crossing([0, 7])[1]] }, theme).reason, 'invalid');
  assert.equal(checkPuzzle({ grid, answers: crossing([0, 7, 30]) }, theme).reason, 'invalid');
  assert.equal(checkPuzzle({ grid, answers: crossing([0, 99]) }, theme).reason, 'invalid');
});

test('checkPuzzle reports crossing before the remaining checks', () => {
  const grid = new Array(CELLS).fill('X');
  const answers = [
    { word: 'XX', path: [0, 7], isSpangram: true },
    { word: 'XX', path: [1, 6], isSpangram: false },
  ];
  assert.equal(checkPuzzle({ grid, answers }, { answers: [], recognized: [] }).reason, 'crossing');
});

test('checkPuzzle reports ambiguous', () => {
  for (let seed = 1; seed < 100; seed++) {
    const layout = layoutFor(seed);
    if (!layout) continue;
    for (const variant of directionVariants(layout)) {
      if (checkPuzzle(variant, themeFor(variant, [])).reason === 'ambiguous') return;
    }
  }
  assert.fail('no ambiguous variant found');
});

test('checkPuzzle reports long-decoy', () => {
  const { variant, theme } = findPassing();
  let decoy = null;
  tracedWords(variant.grid, 6, (w) => {
    if (!decoy && !variant.answers.some((a) => a.word === w)) decoy = w;
  });
  assert.ok(decoy);
  const withDecoy = { ...theme, answers: [...theme.answers, decoy] };
  assert.equal(checkPuzzle(variant, withDecoy).reason, 'long-decoy');
  const asRecognized = { ...theme, recognized: [...theme.recognized, decoy] };
  assert.equal(checkPuzzle(variant, asRecognized).reason, 'long-decoy');
});

test('checkPuzzle reports stones outside 2-5', () => {
  const { variant, theme } = findPassing();
  const none = checkPuzzle(variant, { ...theme, recognized: [] });
  assert.equal(none.reason, 'stones');
  assert.deepEqual(none.steppingStones, []);
  const one = checkPuzzle(variant, { ...theme, recognized: theme.recognized.slice(0, 1) });
  assert.equal(one.reason, 'stones');
  const many = stoneWords(variant.grid, variant.answers, 6);
  assert.equal(many.length, 6);
  assert.equal(checkPuzzle(variant, { ...theme, recognized: many }).reason, 'stones');
});

test('checkPuzzle ignores recognized words that are not 4-5 letters or are chosen answers', () => {
  const { variant, theme } = findPassing();
  const extra = [variant.answers[1].word, 'XX'];
  const result = checkPuzzle(variant, { ...theme, recognized: [...theme.recognized, ...extra] });
  assert.deepEqual(result.steppingStones, [...theme.recognized].sort());
});

// Hand-built board. BOOK runs 0-6-7-1 and also reads 0-7-6-1, which crosses itself; QVRU
// (2-9-3-8) and BKQVRU (0-1-2-9-3-8) can only be traced by crossing over.
function bowtieBoard() {
  const grid = ['BKQRST', 'OOUVWY', 'CDEFGH', 'IJLMNP', 'DCFEHG', 'JILNPM', 'ECGDHF', 'LINJPM'].join('').split('');
  const row = (r) => Array.from({ length: 6 }, (_, c) => r * 6 + c);
  const paths = [row(2), [0, 6, 7, 1], [2, 3, 4, 5], [8, 9, 10, 11], row(3), row(4), row(5), row(6), row(7)];
  const answers = paths.map((path, k) => ({ word: path.map((c) => grid[c]).join(''), path, isSpangram: k === 0 }));
  return { grid, answers };
}
const BOWTIE_STONES = ['CDEF', 'IJLM'];

test('checkPuzzle: a self-crossing second trace does not make an answer ambiguous', () => {
  const board = bowtieBoard();
  assert.equal(countTraces(board.grid, 'BOOK'), 1);
  assert.equal(countTraces(board.grid, 'BOOK', Infinity, { selfCrossing: true }), 2);
  const result = checkPuzzle(board, { answers: [], recognized: BOWTIE_STONES });
  assert.deepEqual(result, { ok: true, steppingStones: BOWTIE_STONES });
});

test('checkPuzzle counts a stepping stone that can only be traced by crossing over', () => {
  const board = bowtieBoard();
  assert.equal(isTraceable(board.grid, 'QVRU'), false);
  const result = checkPuzzle(board, { answers: [], recognized: ['CDEF', 'QVRU'] });
  assert.deepEqual(result, { ok: true, steppingStones: ['CDEF', 'QVRU'] });
  const six = ['CDEF', 'DEFG', 'IJLM', 'JLMN', 'LMNP', 'QVRU'];
  assert.equal(checkPuzzle(board, { answers: [], recognized: six }).reason, 'stones');
});

test('checkPuzzle rejects a long decoy that can only be traced by crossing over', () => {
  const board = bowtieBoard();
  assert.equal(isTraceable(board.grid, 'BKQVRU'), false);
  assert.equal(checkPuzzle(board, { answers: ['BKQVRU'], recognized: BOWTIE_STONES }).reason, 'long-decoy');
  assert.equal(checkPuzzle(board, { answers: [], recognized: [...BOWTIE_STONES, 'BKQVRU'] }).reason, 'long-decoy');
});

// Count sets of cell-disjoint traces, one per answer, covering all 48 cells.
function countSolutions(grid, words) {
  let solutions = 0;
  const used = new Array(CELLS).fill(false);
  function place(index) {
    if (index === words.length) {
      if (used.every(Boolean)) solutions++;
      return;
    }
    const word = words[index];
    const walk = (last, length) => {
      if (length === word.length) {
        place(index + 1);
        return;
      }
      for (const n of neighbors(last)) {
        if (!used[n] && grid[n] === word[length]) {
          used[n] = true;
          walk(n, length + 1);
          used[n] = false;
        }
      }
    };
    for (let i = 0; i < CELLS; i++) {
      if (!used[i] && grid[i] === word[0]) {
        used[i] = true;
        walk(i, 1);
        used[i] = false;
      }
    }
  }
  place(0);
  return solutions;
}

test('a passing layout has exactly one complete solution', () => {
  const { variant } = findPassing();
  assert.equal(countSolutions(variant.grid, variant.answers.map((a) => a.word)), 1);
});

function fixtureLayout(words, paths) {
  const grid = new Array(CELLS).fill('X');
  const answers = words.map((word, k) => {
    paths[k].forEach((cell, i) => { grid[cell] = word[i]; });
    return { word, path: paths[k], isSpangram: k === 0 };
  });
  return { grid, answers };
}

test('difficulty stays in [0,1], rewards bends and length, and adds 0.15 for obscure', () => {
  const straight = fixtureLayout(['SPANGR', 'AAAAAA'], [[0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11]]);
  const bendy = fixtureLayout(
    ['SPANGRAMMING', 'BBBBBBBBBB'],
    [[0, 1, 2, 3, 4, 5, 11, 10, 9, 8, 7, 6], [12, 19, 14, 21, 16, 23, 18, 25, 20, 27]],
  );
  const s = difficulty(straight, { obscure: false });
  const b = difficulty(bendy, { obscure: false });
  assert.ok(s >= 0 && s <= 1 && b >= 0 && b <= 1);
  assert.ok(b > s);
  assert.equal(s, 0);
  assert.ok(Math.abs(difficulty(straight, { obscure: true }) - s - 0.15) < 1e-9);
});
