import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGameState, wordFromPath, foundCells, submitWord, canHint, useHint, HINT_COST, completedAnswer, availableHints,
} from '../js/game.js';

// Hand-built puzzle: game logic does not require full coverage.
function makePuzzle() {
  const grid = new Array(48).fill('X');
  const put = (word, path) => path.forEach((cell, i) => { grid[cell] = word[i]; });
  put('CATS', [0, 1, 2, 3]);
  put('DOGS', [6, 7, 8, 9]);
  put('ANIMAL', [12, 13, 14, 15, 16, 17]);
  put('CATS', [24, 25, 26, 27]); // decoy: same word, wrong path
  put('BIRD', [30, 31, 32, 33]);
  return {
    themeId: 'pets', clue: 'Pets', grid, steppingStones: ['PETS'],
    answers: [
      { word: 'ANIMAL', path: [12, 13, 14, 15, 16, 17], isSpangram: true },
      { word: 'CATS', path: [0, 1, 2, 3], isSpangram: false },
      { word: 'DOGS', path: [6, 7, 8, 9], isSpangram: false },
    ],
  };
}
const DICT = new Set(['STAC', 'BIRD', 'SGOD']);

test('newGameState starts empty', () => {
  const s = newGameState(makePuzzle(), 'seed-1', 1000);
  assert.deepEqual(s, {
    puzzleId: 'seed-1', themeId: 'pets', layoutKey: makePuzzle().grid.join(''), found: [], log: [], bonusWords: [],
    stonesFound: [], bankedHints: 0, hintsUsed: 0, hintMeter: 0, activeHint: null, startedAt: 1000, completed: false,
  });
});

test('wordFromPath reads letters in order', () => {
  assert.equal(wordFromPath(makePuzzle(), [3, 2, 1, 0]), 'STAC');
});

test('theme word on its path is found', () => {
  const p = makePuzzle();
  const { state, result } = submitWord(newGameState(p, 'x'), p, [0, 1, 2, 3], DICT);
  assert.deepEqual(result, { type: 'theme', word: 'CATS' });
  assert.deepEqual(state.found, [{ word: 'CATS', order: 1 }]);
  assert.deepEqual(state.log, ['T']);
  assert.deepEqual([...foundCells(state, p)].sort((a, b) => a - b), [0, 1, 2, 3]);
});

test('spangram is reported as spangram', () => {
  const p = makePuzzle();
  const { state, result } = submitWord(newGameState(p, 'x'), p, [12, 13, 14, 15, 16, 17], DICT);
  assert.equal(result.type, 'spangram');
  assert.deepEqual(state.log, ['S']);
});

test('theme word traced along other cells still counts and locks in its own cells', () => {
  const p = makePuzzle();
  const { state, result } = submitWord(newGameState(p, 'x'), p, [24, 25, 26, 27], DICT);
  assert.deepEqual(result, { type: 'theme', word: 'CATS' });
  assert.deepEqual(state.found, [{ word: 'CATS', order: 1 }]);
  assert.deepEqual([...foundCells(state, p)].sort((a, b) => a - b), [0, 1, 2, 3]);
});

test('already-found theme word on decoy path returns already-found with unchanged state', () => {
  const p = makePuzzle();
  let s = newGameState(p, 'x');
  // Find CATS on the correct path [0, 1, 2, 3]
  ({ state: s } = submitWord(s, p, [0, 1, 2, 3], DICT));
  assert.equal(s.found.length, 1);
  const before = s;

  // Try to submit CATS on decoy path [24, 25, 26, 27] with dict containing 'CATS'
  const dictWithCats = new Set(['CATS']);
  const { state: after, result } = submitWord(s, p, [24, 25, 26, 27], dictWithCats);

  assert.equal(result.type, 'already-found');
  assert.equal(result.word, 'CATS');
  assert.equal(after, before, 'state object reference should be unchanged');
  assert.deepEqual(after.bonusWords, []);
  assert.equal(after.hintMeter, 0);
});

test('short words and non-words are rejected', () => {
  const p = makePuzzle();
  const s = newGameState(p, 'x');
  assert.equal(submitWord(s, p, [0, 1, 2], DICT).result.type, 'too-short');
  assert.equal(submitWord(s, p, [33, 32, 31, 30], DICT).result.type, 'not-a-word');
});

test('bonus words fill the hint meter once each', () => {
  const p = makePuzzle();
  let s = newGameState(p, 'x');
  ({ state: s } = submitWord(s, p, [30, 31, 32, 33], DICT));
  assert.deepEqual(s.bonusWords, ['BIRD']);
  assert.equal(s.hintMeter, 1);
  const again = submitWord(s, p, [30, 31, 32, 33], DICT);
  assert.equal(again.result.type, 'already-found');
  assert.equal(again.state.hintMeter, 1);
});

test('without a dictionary, non-theme words are not-a-word', () => {
  const p = makePuzzle();
  assert.equal(submitWord(newGameState(p, 'x'), p, [30, 31, 32, 33], null).result.type, 'not-a-word');
});

test('hint meter caps at HINT_COST and hints follow levels', () => {
  const p = makePuzzle();
  let s = newGameState(p, 'x');
  for (const path of [[30, 31, 32, 33], [3, 2, 1, 0], [9, 8, 7, 6]]) {
    ({ state: s } = submitWord(s, p, path, DICT));
  }
  assert.equal(s.hintMeter, HINT_COST);
  assert.equal(canHint(s), true);

  s = useHint(s, p);
  assert.deepEqual(s.activeHint, { word: 'CATS', level: 1 }); // first unfound non-spangram
  assert.equal(s.hintMeter, 0);
  assert.equal(s.hintsUsed, 1);
  assert.deepEqual(s.log, ['H']);
  assert.equal(canHint(s), false);

  s = { ...s, hintMeter: HINT_COST };
  s = useHint(s, p);
  assert.deepEqual(s.activeHint, { word: 'CATS', level: 2 });
  s = { ...s, hintMeter: HINT_COST };
  assert.equal(canHint(s), false, 'no further hint while a level-2 hint is active');

  ({ state: s } = submitWord(s, p, [0, 1, 2, 3], DICT));
  assert.equal(s.activeHint, null, 'finding the hinted word clears the hint');
});

test('spangram is only hinted when it is the last word left', () => {
  const p = makePuzzle();
  let s = newGameState(p, 'x');
  ({ state: s } = submitWord(s, p, [0, 1, 2, 3], DICT));
  ({ state: s } = submitWord(s, p, [6, 7, 8, 9], DICT));
  s = useHint({ ...s, hintMeter: HINT_COST }, p);
  assert.equal(s.activeHint.word, 'ANIMAL');
});

test('finding every answer completes the puzzle', () => {
  const p = makePuzzle();
  let s = newGameState(p, 'x');
  for (const a of p.answers) ({ state: s } = submitWord(s, p, a.path, DICT));
  assert.equal(s.completed, true);
  assert.equal(canHint({ ...s, hintMeter: HINT_COST }), false);
});

test('completedAnswer matches an unfound answer spelled along any path', () => {
  const p = makePuzzle();
  let s = newGameState(p, 'x');
  assert.equal(completedAnswer(s, p, [0, 1, 2, 3]).word, 'CATS');
  assert.equal(completedAnswer(s, p, [24, 25, 26, 27]).word, 'CATS', 'same word, other cells');
  assert.equal(completedAnswer(s, p, [12, 13, 14, 15, 16, 17]).word, 'ANIMAL');
  assert.equal(completedAnswer(s, p, [0, 1, 2]), null, 'prefix of an answer');
  assert.equal(completedAnswer(s, p, [3, 2, 1, 0]), null, 'reversed path');
  ({ state: s } = submitWord(s, p, [0, 1, 2, 3], DICT));
  assert.equal(completedAnswer(s, p, [24, 25, 26, 27]), null, 'already found');
});

test('completedAnswer waits while the word could still grow into a longer unfound answer', () => {
  const grid = new Array(48).fill('X');
  'BASSOON'.split('').forEach((ch, i) => { grid[i] = ch; });
  'BASS'.split('').forEach((ch, i) => { grid[6 + i] = ch; });
  const p = {
    seed: 1, themeId: 't', clue: 't', grid,
    answers: [
      { word: 'BASSOON', path: [0, 1, 2, 3, 4, 5, 11], isSpangram: true },
      { word: 'BASS', path: [6, 7, 8, 9], isSpangram: false },
    ],
  };
  p.grid[11] = 'N';
  let s = newGameState(p, 'x');
  assert.equal(completedAnswer(s, p, [0, 1, 2, 3]), null, 'BASS might become BASSOON');
  assert.equal(completedAnswer(s, p, [0, 1, 2, 3, 4, 5, 11]).word, 'BASSOON');
  ({ state: s } = submitWord(s, p, [0, 1, 2, 3, 4, 5, 11], DICT));
  assert.equal(completedAnswer(s, p, [6, 7, 8, 9]).word, 'BASS', 'no longer ambiguous once BASSOON is found');
});

// Stone PETS traced on cells 36-39.
function stonePuzzle() {
  const p = makePuzzle();
  [36, 37, 38, 39].forEach((c, i) => { p.grid[c] = 'PETS'[i]; });
  return p;
}

test('stepping stone banks a hint once', () => {
  const p = stonePuzzle();
  let s = newGameState(p, 'x');
  let r;
  ({ state: s, result: r } = submitWord(s, p, [36, 37, 38, 39], DICT));
  assert.deepEqual(r, { type: 'stepping-stone', word: 'PETS' });
  assert.deepEqual(s.stonesFound, ['PETS']);
  assert.equal(s.bankedHints, 1);
  assert.deepEqual(s.log, ['P']);
  assert.equal(s.hintMeter, 0);
  const before = s;
  ({ state: s, result: r } = submitWord(s, p, [36, 37, 38, 39], DICT));
  assert.equal(r.type, 'already-found');
  assert.equal(s, before);
});

test('stepping stone check wins over a dictionary word', () => {
  const p = stonePuzzle();
  const { result, state } = submitWord(newGameState(p, 'x'), p, [36, 37, 38, 39], new Set(['PETS']));
  assert.equal(result.type, 'stepping-stone');
  assert.deepEqual(state.bonusWords, []);
});

test('canHint with a banked hint and an empty meter', () => {
  const s = { ...newGameState(stonePuzzle(), 'x'), bankedHints: 1 };
  assert.equal(canHint(s), true);
  assert.equal(canHint({ ...s, bankedHints: 0 }), false);
  assert.equal(canHint({ ...s, activeHint: { word: 'CATS', level: 2 } }), false);
});

test('useHint spends a banked hint before the meter', () => {
  const p = stonePuzzle();
  const s = { ...newGameState(p, 'x'), bankedHints: 1, hintMeter: HINT_COST };
  const after = useHint(s, p);
  assert.equal(after.bankedHints, 0);
  assert.equal(after.hintMeter, HINT_COST);
  assert.equal(after.hintsUsed, 1);
  const again = useHint(after, p);
  assert.equal(again.hintMeter, 0);
});

test('availableHints counts banked plus a full meter', () => {
  const s = newGameState(stonePuzzle(), 'x');
  assert.equal(availableHints(s), 0);
  assert.equal(availableHints({ ...s, bankedHints: 2 }), 2);
  assert.equal(availableHints({ ...s, bankedHints: 2, hintMeter: HINT_COST }), 3);
  assert.equal(availableHints({ ...s, hintMeter: HINT_COST - 1 }), 0);
});

// Self-crossing copies on rows 6-7: each path takes both diagonals of one 2x2 square.
const CROSSED = { CATS: [36, 43, 42, 37], BIRD: [38, 45, 44, 39], PETS: [40, 47, 46, 41] };
function crossPuzzle() {
  const p = makePuzzle();
  for (const [word, path] of Object.entries(CROSSED)) path.forEach((c, i) => { p.grid[c] = word[i]; });
  return p;
}

test('a self-crossing trace never counts as a theme answer', () => {
  const p = crossPuzzle();
  const s = newGameState(p, 'x');
  const { state, result } = submitWord(s, p, CROSSED.CATS, new Set(['CATS']));
  assert.deepEqual(result, { type: 'crossed-answer', word: 'CATS' });
  assert.equal(state, s, 'state is unchanged: not found, not a bonus word');
  assert.equal(submitWord(s, p, [0, 1, 2, 3], DICT).result.type, 'theme', 'the straight trace still counts');
});

test('a self-crossing trace never counts as the spangram', () => {
  const p = crossPuzzle();
  p.answers = [{ word: 'CATS', path: [0, 1, 2, 3], isSpangram: true }, p.answers[2]];
  const s = newGameState(p, 'x');
  const { state, result } = submitWord(s, p, CROSSED.CATS, DICT);
  assert.deepEqual(result, { type: 'crossed-answer', word: 'CATS' });
  assert.equal(state, s);
});

test('an already-found answer along a self-crossing trace is already-found', () => {
  const p = crossPuzzle();
  let s = newGameState(p, 'x');
  ({ state: s } = submitWord(s, p, [0, 1, 2, 3], DICT));
  const { state, result } = submitWord(s, p, CROSSED.CATS, new Set(['CATS']));
  assert.equal(result.type, 'already-found');
  assert.equal(state, s);
});

test('completedAnswer ignores a self-crossing trace', () => {
  const p = crossPuzzle();
  const s = newGameState(p, 'x');
  assert.equal(completedAnswer(s, p, CROSSED.CATS), null);
  assert.equal(completedAnswer(s, p, [0, 1, 2, 3]).word, 'CATS');
});

test('stepping stones and bonus words count along a self-crossing trace', () => {
  const p = crossPuzzle();
  let s = newGameState(p, 'x');
  let r;
  ({ state: s, result: r } = submitWord(s, p, CROSSED.PETS, DICT));
  assert.deepEqual(r, { type: 'stepping-stone', word: 'PETS' });
  assert.equal(s.bankedHints, 1);
  ({ state: s, result: r } = submitWord(s, p, CROSSED.BIRD, DICT));
  assert.deepEqual(r, { type: 'bonus', word: 'BIRD' });
  assert.deepEqual(s.bonusWords, ['BIRD']);
  assert.equal(s.hintMeter, 1);
});
