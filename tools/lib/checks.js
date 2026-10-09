import { neighbors, rowOf, colOf } from '../../js/grid.js';
import { verifyPuzzle } from './layout.js';

// Number of self-avoiding adjacent paths spelling `word`, stopping early at `cap`.
export function countTraces(grid, word, cap = Infinity) {
  let n = 0;
  const walk = (path) => {
    if (n >= cap) return;
    if (path.length === word.length) { n++; return; }
    for (const next of neighbors(path[path.length - 1])) {
      if (!path.includes(next) && grid[next] === word[path.length]) {
        path.push(next); walk(path); path.pop();
      }
    }
  };
  for (let i = 0; i < grid.length && n < cap; i++) if (grid[i] === word[0]) walk([i]);
  return n;
}

export function isTraceable(grid, word) {
  return countTraces(grid, word, 1) > 0;
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

// Exactly one trace per chosen answer implies exactly one complete solution: any
// full cover uses one trace per answer, and each answer has only its own.
export function checkPuzzle(layout, theme) {
  const { grid, answers } = layout;
  const chosen = new Set(answers.map((a) => a.word));
  const steppingStones = [...new Set(theme.recognized)]
    .filter((w) => w.length >= 4 && w.length <= 5 && !chosen.has(w) && isTraceable(grid, w))
    .sort();
  if (!verifyPuzzle(layout)) return { ok: false, reason: 'invalid', steppingStones };
  if (answers.some((a) => countTraces(grid, a.word, 2) !== 1)) {
    return { ok: false, reason: 'ambiguous', steppingStones };
  }
  const onTheme = new Set([...theme.answers, ...theme.recognized]);
  for (const w of onTheme) {
    if (w.length >= 6 && !chosen.has(w) && isTraceable(grid, w)) {
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

export function difficulty({ answers }, { obscure }) {
  const rest = answers.filter((a) => !a.isSpangram);
  const spangram = answers.find((a) => a.isSpangram);
  return (
    0.35 * norm(mean(rest.map((a) => a.word.length)), 6, 10) +
    0.35 * mean(rest.map((a) => bendiness(a.path))) +
    0.15 * norm(spangram.word.length, 6, 14) +
    0.15 * (obscure ? 1 : 0)
  );
}
