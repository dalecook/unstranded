export const MIN_WORD_LENGTH = 4;
export const HINT_COST = 3;

export function newGameState(puzzle, puzzleId, now = Date.now()) {
  return {
    puzzleId,
    themeId: puzzle.themeId,
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
export function completedAnswer(state, puzzle, path) {
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

  // Any trace that spells an answer counts. Repeated letters can allow several traces, so the
  // answer's own cells are locked (foundCells uses answer.path), leaving other answers solvable.
  if (answer && !isFound(state, word)) {
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

  const next = {
    ...state,
    bonusWords: [...state.bonusWords, word],
    hintMeter: Math.min(HINT_COST, state.hintMeter + 1),
  };
  return { state: next, result: { type: 'bonus', word } };
}

export function canHint(state) {
  return !state.completed && state.activeHint?.level !== 2
    && (state.bankedHints > 0 || state.hintMeter >= HINT_COST);
}

export function useHint(state, puzzle) {
  if (!canHint(state)) return state;
  const spendBanked = state.bankedHints > 0;
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
    bankedHints: spendBanked ? state.bankedHints - 1 : state.bankedHints,
    hintMeter: spendBanked ? state.hintMeter : 0,
    log: [...state.log, 'H'],
  };
}

export function availableHints(state) {
  return state.bankedHints + (state.hintMeter >= HINT_COST ? 1 : 0);
}
