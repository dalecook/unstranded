import { neighbors, rowOf, colOf, isValidPath, diagonalKey, crossesLinks, pathsCross } from '../../js/grid.js';
import { verifyPuzzle } from './layout.js';

// A player's selection may cross its own path, but such a trace only ever makes a bonus word or a
// stepping stone: an answer counts along a non-self-crossing trace only. So checks about answers
// use the default traces (no crossing), and checks about every other word pass ANY_TRACE.
export const ANY_TRACE = Object.freeze({ selfCrossing: true });

// Visit every trace of `word`: a self-avoiding adjacent path whose diagonal steps never cross
// each other, unless `selfCrossing` allows that. `visit` receives the live path; return true to
// stop the walk.
export function walkTraces(grid, word, visit, { selfCrossing = false } = {}) {
  const links = new Map();
  const walk = (path) => {
    if (path.length === word.length) return visit(path);
    const last = path[path.length - 1];
    for (const next of neighbors(last)) {
      if (path.includes(next) || grid[next] !== word[path.length]) continue;
      if (!selfCrossing && crossesLinks(last, next, links)) continue;
      const key = selfCrossing ? null : diagonalKey(last, next);
      if (key) links.set(key.square, key.dir);
      path.push(next);
      const stop = walk(path);
      path.pop();
      if (key) links.delete(key.square);
      if (stop) return true;
    }
    return false;
  };
  for (let i = 0; i < grid.length; i++) if (grid[i] === word[0] && walk([i])) return;
}

// Number of traces spelling `word`, stopping early at `cap`. `options` as for walkTraces.
export function countTraces(grid, word, cap = Infinity, options = {}) {
  let n = 0;
  walkTraces(grid, word, () => ++n >= cap, options);
  return n;
}

export function isTraceable(grid, word, options = {}) {
  return countTraces(grid, word, 1, options) > 0;
}

// Every forward/reverse assignment of the answer paths; answers[0] stays the spangram.
export function* directionVariants({ answers }) {
  for (let mask = 0; mask < (1 << answers.length); mask++) {
    const grid = new Array(48);
    const out = answers.map((a, j) => {
      const path = (mask >> j) & 1 ? [...a.path].reverse() : a.path;
      path.forEach((cell, i) => { grid[cell] = a.word[i]; });
      return { ...a, path };
    });
    yield { grid, answers: out };
  }
}

// Exactly one non-self-crossing trace per chosen answer implies exactly one complete solution:
// any full cover uses one such trace per answer, and each answer has only its own. Stepping
// stones and long decoys are not answers, so any trace of them counts, self-crossing included.
// Stepping stones are the on-theme words of 4-5 letters that are not answers on this board:
// recognized words, and answer candidates (5 letters) that were not chosen for it.
export function checkPuzzle(layout, theme) {
  const { grid, answers } = layout;
  const chosen = new Set(answers.map((a) => a.word));
  const onTheme = new Set([...theme.answers, ...theme.recognized]);
  const steppingStones = [...onTheme]
    .filter((w) => w.length >= 4 && w.length <= 5 && !chosen.has(w) && isTraceable(grid, w, ANY_TRACE))
    .sort();
  // Malformed paths are 'invalid', not 'crossing': validate shape before the crossing check.
  if (answers.some((a) => !isValidPath(a.path) || a.path.length !== a.word.length)) {
    return { ok: false, reason: 'invalid', steppingStones };
  }
  if (pathsCross(answers.map((a) => a.path))) return { ok: false, reason: 'crossing', steppingStones };
  if (!verifyPuzzle(layout)) return { ok: false, reason: 'invalid', steppingStones };
  if (answers.some((a) => countTraces(grid, a.word, 2) !== 1)) {
    return { ok: false, reason: 'ambiguous', steppingStones };
  }
  for (const w of onTheme) {
    if (w.length >= 6 && !chosen.has(w) && isTraceable(grid, w, ANY_TRACE)) {
      return { ok: false, reason: 'long-decoy', steppingStones };
    }
  }
  if (steppingStones.length < 2 || steppingStones.length > 5) {
    return { ok: false, reason: 'stones', steppingStones };
  }
  return { ok: true, steppingStones };
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const norm = (x, a, b) => clamp01((x - a) / (b - a));
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function bendiness(path) {
  if (path.length < 3) return 0;
  let changes = 0;
  let prev = null;
  for (let i = 1; i < path.length; i++) {
    const step = [rowOf(path[i]) - rowOf(path[i - 1]), colOf(path[i]) - colOf(path[i - 1])];
    if (prev && (step[0] !== prev[0] || step[1] !== prev[1])) changes++;
    prev = step;
  }
  return changes / (path.length - 2);
}

// Difficulty in [0,1], a weighted sum of five terms that are each in [0,1]:
//   0.25  mean theme-word length, from 5 letters (0) to 10 (1)
//   0.35  mean bendiness of the theme-word paths (share of steps that change direction)
//   0.10  number of theme words, from 4 (0) to 8 (1)
//   0.15  spangram length, from 6 letters (0) to 14 (1)
//   0.15  obscure theme
// The words always fill the same cells, so more words means shorter words; the word-count term
// offsets part of that, so a board with many words to find is not simply rated easier.
export function difficulty({ answers }, { obscure }) {
  const rest = answers.filter((a) => !a.isSpangram);
  const spangram = answers.find((a) => a.isSpangram);
  return (
    0.25 * norm(mean(rest.map((a) => a.word.length)), 5, 10) +
    0.35 * mean(rest.map((a) => bendiness(a.path))) +
    0.10 * norm(rest.length, 4, 8) +
    0.15 * norm(spangram.word.length, 6, 14) +
    0.15 * (obscure ? 1 : 0)
  );
}
