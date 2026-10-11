import { pathsCross } from './grid.js';

export const MIN_WORD_LENGTH = 4;
export const HINT_COST = 3;

// Identifies a puzzle's board, so saved progress is discarded if a drop is rebuilt.
export function layoutKey(puzzle) {
  return puzzle.grid.join('');
}

export function newGameState(puzzle, puzzleId, now = Date.now()) {
  return {
    puzzleId,
    themeId: puzzle.themeId,
    layoutKey: layoutKey(puzzle),
    found: [],
    log: [],
    bonusWords: [],
    stonesFound: [],
    bankedHints: 0,
    hintsUsed: 0,
    hintMeter: 0,
    activeHint: null,
    startedAt: now,
    completed: false,
  };
}

export function wordFromPath(puzzle, path) {
  return path.map((i) => puzzle.grid[i]).join('');
}

export function isFound(state, word) {
  return state.found.some((f) => f.word === word);
}

// The unfound answer the selection spells, or null while it could still grow into a longer
// unfound answer (e.g. BASS on the way to BASSOON). Safe to submit without waiting for release.
// A trace that crosses itself never counts as an answer.
export function completedAnswer(state, puzzle, path) {
  if (pathsCross([path])) return null;
  const word = wordFromPath(puzzle, path);
  const unfound = puzzle.answers.filter((a) => !isFound(state, a.word));
  const answer = unfound.find((a) => a.word === word);
  if (!answer || unfound.some((a) => a.word.length > word.length && a.word.startsWith(word))) return null;
  return answer;
}

export function foundCells(state, puzzle) {
  const cells = new Set();
  for (const answer of puzzle.answers) {
    if (isFound(state, answer.word)) answer.path.forEach((c) => cells.add(c));
  }
  return cells;
}

export function submitWord(state, puzzle, path, dictionary) {
  const word = wordFromPath(puzzle, path);
  const answer = puzzle.answers.find((a) => a.word === word);

  // A trace that spells an answer counts unless it crosses itself: a self-crossing trace is never
  // an answer, and is not scored as a bonus word either. The build guarantees exactly one
  // non-crossing trace per answer, so an accepted trace is the answer's own path (answer.path),
  // which is what gets highlighted. Solved letters stay usable for bonus words and stepping stones.
  if (answer && !isFound(state, word)) {
    if (pathsCross([path])) return { state, result: { type: 'crossed-answer', word } };
    const found = [...state.found, { word, order: state.found.length + 1 }];
    const next = {
      ...state,
      found,
      log: [...state.log, answer.isSpangram ? 'S' : 'T'],
      activeHint: state.activeHint?.word === word ? null : state.activeHint,
      completed: found.length === puzzle.answers.length,
    };
    return { state: next, result: { type: answer.isSpangram ? 'spangram' : 'theme', word } };
  }

  if (answer) return { state, result: { type: 'already-found', word } };

  if (word.length < MIN_WORD_LENGTH) return { state, result: { type: 'too-short', word } };
  if (puzzle.steppingStones?.includes(word)) {
    if (state.stonesFound.includes(word)) return { state, result: { type: 'already-found', word } };
    const next = {
      ...state,
      stonesFound: [...state.stonesFound, word],
      bankedHints: state.bankedHints + 1,
      log: [...state.log, 'P'],
    };
    return { state: next, result: { type: 'stepping-stone', word } };
  }
  if (state.bonusWords.includes(word)) return { state, result: { type: 'already-found', word } };
  if (!dictionary || !dictionary.has(word)) return { state, result: { type: 'not-a-word', word } };

  // Every HINT_COST-th bonus word banks a hint and the meter starts again.
  const meter = state.hintMeter + 1;
  const hintEarned = meter >= HINT_COST;
  const next = {
    ...state,
    bonusWords: [...state.bonusWords, word],
    bankedHints: state.bankedHints + (hintEarned ? 1 : 0),
    hintMeter: hintEarned ? 0 : meter,
  };
  return { state: next, result: hintEarned ? { type: 'bonus', word, hintEarned } : { type: 'bonus', word } };
}

export function canHint(state) {
  return !state.completed && state.activeHint?.level !== 2 && state.bankedHints > 0;
}

export function useHint(state, puzzle) {
  if (!canHint(state)) return state;
  let activeHint;
  if (state.activeHint && !isFound(state, state.activeHint.word)) {
    activeHint = { word: state.activeHint.word, level: 2 };
  } else {
    const unfound = puzzle.answers.filter((a) => !isFound(state, a.word));
    const target = unfound.find((a) => !a.isSpangram) ?? unfound[0];
    activeHint = { word: target.word, level: 1 };
  }
  return {
    ...state,
    activeHint,
    hintsUsed: state.hintsUsed + 1,
    bankedHints: state.bankedHints - 1,
    log: [...state.log, 'H'],
  };
}

export function availableHints(state) {
  return state.bankedHints;
}

// Old saves could hold a full meter (a spendable hint) and may lack newer fields.
export function migrateState(state) {
  const bankedHints = state.bankedHints ?? 0;
  const stonesFound = state.stonesFound ?? [];
  const full = Math.floor(state.hintMeter / HINT_COST);
  if (!full && state.bankedHints !== undefined && state.stonesFound !== undefined) return state;
  return { ...state, stonesFound, bankedHints: bankedHints + full, hintMeter: state.hintMeter % HINT_COST };
}
