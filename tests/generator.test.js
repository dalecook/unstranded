import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mulberry32 } from '../js/rng.js';
import { CELLS, pathsCross } from '../js/grid.js';
import { chooseWords, verifyPuzzle } from '../tools/lib/layout.js';
import { checkPuzzle, countTraces } from '../tools/lib/checks.js';
import { loadBoardBlocklist, offensiveWordsOn } from '../tools/lib/blocklist.js';
import { createBoardChecker, generateBoard, traceCount } from '../tools/lib/generator.js';

test('the fast tracer counts exactly the traces checks.countTraces does', () => {
  const rand = mulberry32(42);
  const pick = (s) => s[Math.floor(rand() * s.length)];
  for (let round = 0; round < 300; round++) {
    // Small alphabet plus empty cells: many overlapping and crossing candidate traces.
    const grid = Array.from({ length: CELLS }, () => pick(['A', 'B', 'C', '', '']));
    const word = Array.from({ length: 3 + Math.floor(rand() * 4) }, () => pick('ABC')).join('');
    assert.equal(traceCount(grid, word, 500), countTraces(grid, word, 500), `round ${round} ${word}`);
  }
});

function checker(opts) {
  return createBoardChecker({ answers: [], recognized: [], blockset: new Set(), ...opts });
}

test('ambiguity is caught when the word that creates the second trace is placed', () => {
  const c = checker({ chosen: ['CAT', 'TIN'] });
  assert.equal(c.place('CAT', [0, 1, 2]), null);
  // T at cell 8 is adjacent to A at cell 1: CAT now also reads 0-1-8.
  assert.equal(c.place('TIN', [8, 9, 10]), 'ambiguous');
  assert.equal(c.grid[8], '', 'a rejected placement is rolled back');
  assert.equal(c.place('TIN', [3, 4, 5]), null, 'away from the A it is fine');
});

test('a placed word with two traces of its own is ambiguous', () => {
  const c = checker({ chosen: ['ANNA'] });
  // A palindrome always reads from either end: two traces.
  assert.equal(c.place('ANNA', [0, 1, 7, 6]), 'ambiguous');
});

test('an unplaced chosen answer already traceable is ambiguous', () => {
  const c = checker({ chosen: ['CAT', 'ACT'] });
  assert.equal(c.place('CAT', [6, 0, 1]), 'ambiguous');
  assert.equal(checker({ chosen: ['CAT', 'DOG'] }).place('CAT', [6, 0, 1]), null);
});

test('a traceable long on-theme decoy is pruned', () => {
  const c = checker({ chosen: ['CAT', 'NIP'], answers: ['CAT', 'NIP', 'CATNIP'] });
  assert.equal(c.place('CAT', [0, 1, 2]), null);
  assert.equal(c.place('NIP', [3, 4, 5]), 'long-decoy');
  const viaRecognized = checker({ chosen: ['CAT', 'NIP'], recognized: ['CATNIP'] });
  viaRecognized.place('CAT', [0, 1, 2]);
  assert.equal(viaRecognized.place('NIP', [3, 4, 5]), 'long-decoy');
});

test('a blocked word spanning answers is pruned; one inside a single answer is exempt', () => {
  const c = checker({ chosen: ['CAT', 'NIP'], blockset: new Set(['ATNI']) });
  assert.equal(c.place('CAT', [0, 1, 2]), null);
  assert.equal(c.place('NIP', [3, 4, 5]), 'offensive');
  const nested = checker({ chosen: ['CATS'], blockset: new Set(['CAT']) });
  assert.equal(nested.place('CATS', [0, 1, 2, 3]), null);
});

test('a blocked word scrambled within one answer is pruned; a reversed run of it is exempt', () => {
  // ABCDE along 0-1-7-8-2: BEC reads 1-2-7, which is no contiguous run of that path.
  const path = [0, 1, 7, 8, 2];
  const scrambled = checker({ chosen: ['ABCDE'], blockset: new Set(['BEC']) });
  assert.equal(scrambled.place('ABCDE', path), 'offensive');
  // DCB reads 8-7-1: the answer's own cells backwards, a contiguous reversed run.
  const reversed = checker({ chosen: ['ABCDE'], blockset: new Set(['DCB']) });
  assert.equal(reversed.place('ABCDE', path), null);
});

test('more than five stepping stones is pruned as soon as they appear', () => {
  const stones = ['ABCD', 'BCDE', 'CDEF', 'DEFG', 'EFGH'];
  const five = checker({ chosen: ['ABCDEFGH'], recognized: stones });
  assert.equal(five.place('ABCDEFGH', [0, 1, 2, 3, 4, 5, 11, 10]), null);
  assert.deepEqual(five.stones(), stones);
  const six = checker({ chosen: ['ABCDEFGH'], recognized: [...stones, 'ABCDE'] });
  assert.equal(six.place('ABCDEFGH', [0, 1, 2, 3, 4, 5, 11, 10]), 'stones');
});

test('undo restores letters and stepping stones', () => {
  const c = checker({ chosen: ['CAT', 'TIN'], recognized: ['ATTI', 'ACTS'] });
  c.place('CAT', [0, 1, 2]);
  const before = { grid: [...c.grid], stones: c.stones() };
  assert.equal(c.place('TIN', [3, 4, 5]), null);
  assert.deepEqual(c.stones(), ['ATTI']);
  c.undo();
  assert.deepEqual(c.grid, before.grid);
  assert.deepEqual(c.stones(), before.stones);
});

test('undo restores the unplaced answers', () => {
  const c = checker({ chosen: ['CAT', 'ACT'] });
  assert.equal(c.place('ACT', [12, 13, 14]), null);
  c.undo();
  // ACT is unplaced again, so CAT at 6-0-1 (which also reads ACT) is ambiguous.
  assert.equal(c.place('CAT', [6, 0, 1]), 'ambiguous');
  assert.equal(c.place('CAT', [12, 13, 14]), null, 'CAT can still be placed after the rejection');
});

test('a rejected placement restores the unplaced answers', () => {
  const c = checker({ chosen: ['CAT', 'ACT', 'DOG'] });
  assert.equal(c.place('CAT', [6, 0, 1]), 'ambiguous');
  assert.equal(c.place('DOG', [30, 31, 32]), null);
  // CAT is unplaced again, so ACT over the same cells makes CAT traceable.
  assert.equal(c.place('ACT', [0, 6, 1]), 'ambiguous');
  assert.equal(c.place('CAT', [12, 13, 14]), null, 'CAT can still be placed');
});

const breads = JSON.parse(await readFile(new URL('../content/themes/breads.json', import.meta.url), 'utf8'));
const blockset = await loadBoardBlocklist();

test('committed drop boards replay through the checker in any order without pruning', async () => {
  const drop = JSON.parse(await readFile(new URL('../drops/2026-10.json', import.meta.url), 'utf8'));
  const rand = mulberry32(7);
  for (const puzzle of drop.puzzles.slice(0, 5)) {
    const theme = JSON.parse(await readFile(new URL(`../content/themes/${puzzle.themeId}.json`, import.meta.url), 'utf8'));
    const expected = checkPuzzle(puzzle, theme).steppingStones;
    for (let round = 0; round < 4; round++) {
      const order = [...puzzle.answers];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const c = createBoardChecker({
        chosen: puzzle.answers.map((a) => a.word), answers: theme.answers, recognized: theme.recognized, blockset,
      });
      for (const a of order) assert.equal(c.place(a.word, a.path), null, `${puzzle.id} round ${round}: ${a.word}`);
      assert.deepEqual(c.stones(), expected, `${puzzle.id} round ${round} stones`);
    }
  }
});

function boardsFor(theme, seeds) {
  const out = [];
  for (const seed of seeds) {
    const rand = mulberry32(seed);
    const subject = { spangram: theme.spangram, words: theme.answers };
    const words = chooseWords(subject, rand, { minCount: 4, maxCount: 7 });
    if (!words) continue;
    out.push({ seed, board: generateBoard(theme, words, rand, { blockset }) });
  }
  return out;
}

let cachedBoards = null;
const generated = () => (cachedBoards ??= boardsFor(breads, Array.from({ length: 30 }, (_, i) => i + 1)));

test('every generated board passes checkPuzzle, has no crossings and no blocked words', () => {
  const boards = generated().filter((b) => b.board);
  assert.ok(boards.length >= 3, `only ${boards.length} boards from 30 seeds`);
  for (const { seed, board } of boards) {
    assert.equal(board.grid.length, CELLS);
    assert.ok(verifyPuzzle(board), `seed ${seed} verifyPuzzle`);
    assert.equal(pathsCross(board.answers.map((a) => a.path)), false);
    assert.equal(board.answers[0].word, breads.spangram);
    assert.equal(board.answers[0].isSpangram, true);
    const result = checkPuzzle(board, breads);
    assert.equal(result.ok, true, `seed ${seed}: ${result.reason}`);
    assert.deepEqual(result.steppingStones, board.steppingStones);
    for (const a of board.answers) assert.equal(countTraces(board.grid, a.word), 1);
    assert.deepEqual(offensiveWordsOn(board.grid, blockset, board.answers), []);
  }
});

test('generateBoard is deterministic for a seed', () => {
  const first = generated().find((b) => b.board);
  const [again] = boardsFor(breads, [first.seed]);
  assert.deepEqual(again.board, first.board);
});

test('generateBoard records why branches were pruned', () => {
  const rand = mulberry32(5);
  const words = chooseWords({ spangram: breads.spangram, words: breads.answers }, rand, { minCount: 4, maxCount: 7 });
  const stats = {};
  generateBoard(breads, words, rand, { blockset, stats });
  assert.ok(stats.ambiguous > 0);
  assert.ok(Object.keys(stats).every((k) => ['ambiguous', 'long-decoy', 'offensive', 'stones', 'few-stones'].includes(k)));
});
