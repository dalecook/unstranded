import { COLS, ROWS, CELLS, neighbors, rowOf, colOf, isValidPath, touchesOppositeEdges, diagonalKey, crossesLinks, pathsCross } from '../../js/grid.js';
import { mulberry32, hashString, shuffle, randInt } from '../../js/rng.js';

export const STEP_BUDGET = 50000;
// Neighbour lists are read on every walk step; build them once.
const NEIGHBORS = Array.from({ length: CELLS }, (_, i) => neighbors(i));
const IS_DIAGONAL = new Uint8Array(CELLS * CELLS);
for (let a = 0; a < CELLS; a++) for (const b of NEIGHBORS[a]) IS_DIAGONAL[a * CELLS + b] = diagonalKey(a, b) ? 1 : 0;
const ATTEMPTS_PER_THEME = 10;

// Pick non-spangram words whose lengths exactly fill the rest of the board.
export function chooseWords(theme, rand, opts = {}) {
  const { minCount, maxCount, shuffle: doShuffle = true } = opts;
  const target = CELLS - theme.spangram.length;
  const pool = doShuffle ? shuffle(theme.words, rand) : [...theme.words];
  if (minCount !== undefined || maxCount !== undefined) {
    return findSubset(pool, target, minCount ?? 1, maxCount ?? pool.length);
  }
  return findSubset(pool, target, 5, 7) ?? findSubset(pool, target, 4, 9);
}

function findSubset(pool, target, minCount, maxCount) {
  const chosen = [];
  function dfs(start, remaining) {
    if (remaining === 0) return chosen.length >= minCount;
    if (chosen.length === maxCount) return false;
    for (let i = start; i < pool.length; i++) {
      if (pool[i].length > remaining) continue;
      chosen.push(pool[i]);
      if (dfs(i + 1, remaining - pool[i].length)) return true;
      chosen.pop();
    }
    return false;
  }
  return dfs(0, target) ? [...chosen] : null;
}

function subsetSums(lengths) {
  let sums = new Set([0]);
  for (const len of lengths) {
    const next = new Set(sums);
    for (const s of sums) next.add(s + len);
    sums = next;
  }
  return sums;
}

const seen = new Uint8Array(CELLS);
const stack = new Int8Array(CELLS);

// Sizes of the empty regions, stopping early (with what it has) once `stop(size)` is true.
function emptyRegionSizes(used, links, stop = () => false) {
  seen.fill(0);
  const sizes = [];
  for (let i = 0; i < CELLS; i++) {
    if (used[i] || seen[i]) continue;
    let size = 0;
    let top = 0;
    stack[top++] = i;
    seen[i] = 1;
    while (top) {
      const cur = stack[--top];
      size++;
      for (const n of NEIGHBORS[cur]) {
        if (!used[n] && !seen[n] && !(IS_DIAGONAL[cur * CELLS + n] && crossesLinks(cur, n, links))) {
          seen[n] = 1;
          stack[top++] = n;
        }
      }
    }
    sizes.push(size);
    if (stop(size)) break;
  }
  return sizes;
}

// Empty cells joined only by a blocked (crossing) diagonal are separate regions; each must be fillable by some of the remaining words.
const sumsCache = new Map();
function regionsFit(used, links, remainingLengths) {
  const key = remainingLengths.join(',');
  let sums = sumsCache.get(key);
  if (!sums) {
    if (sumsCache.size > 5000) sumsCache.clear();
    sums = subsetSums(remainingLengths);
    sumsCache.set(key, sums);
  }
  let fit = true;
  emptyRegionSizes(used, links, (size) => !(fit = sums.has(size)));
  return fit;
}

// Geometry-only layout: paths for every word, letters assigned at the end with a random
// reading direction. See searchLayout for the shared walk.
export function layoutWords(spangram, words, rand, budget = STEP_BUDGET) {
  const placed = searchLayout(spangram, words, rand, budget, (word, path, isSpangram, next) => next(path));
  return placed ? assignLetters(placed, rand) : null;
}

// Depth-first walk that lays the spangram (touching opposite edges) and then each word from the
// first empty cell, never crossing a diagonal link and keeping every empty region fillable.
// `place(word, path, isSpangram, next)` decides how a geometric path becomes an answer: it calls
// next(finalPath) for each acceptable reading (and may undo its own state after each) and returns
// true as soon as one next() does. `done()` accepts or rejects a full board (rejecting backtracks);
// `counter.steps` is shared so callers can charge their own work to the budget.
// Returns the placed { word, path } list (spangram first) or null.
export function searchLayout(spangram, words, rand, budget, place, { counter = { steps: 0 }, done = () => true } = {}) {
  const used = new Array(CELLS).fill(false);
  const placed = [];
  const links = new Map();

  function extend(path, length, prune, accept) {
    if (++counter.steps > budget) return false;
    if (path.length === length) return accept(path);
    if (prune && prune(path)) return false;
    for (const n of shuffle(NEIGHBORS[path[path.length - 1]], rand)) {
      if (used[n] || crossesLinks(path[path.length - 1], n, links)) continue;
      const key = diagonalKey(path[path.length - 1], n);
      if (key) links.set(key.square, key.dir);
      used[n] = true;
      path.push(n);
      if (extend(path, length, prune, accept)) return true;
      path.pop();
      used[n] = false;
      if (key) links.delete(key.square);
    }
    return false;
  }

  const commit = (word, path, isSpangram, then) => place(word, [...path], isSpangram, (finalPath) => {
    placed.push({ word, path: finalPath });
    if (then()) return true;
    placed.pop();
    return false;
  });

  function placeRest(remaining) {
    if (remaining.length === 0) return used.every(Boolean) && done();
    const first = used.indexOf(false);
    const triedLengths = new Set();
    for (const word of shuffle(remaining, rand)) {
      if (triedLengths.has(word.length)) continue;
      triedLengths.add(word.length);
      const rest = remaining.filter((w) => w !== word);
      const restLengths = rest.map((w) => w.length);
      used[first] = true;
      const ok = extend([first], word.length, null, (path) => {
        if (!regionsFit(used, links, restLengths)) return false;
        return commit(word, path, false, () => placeRest(rest));
      });
      if (ok) return true;
      used[first] = false;
      if (counter.steps > budget) return false;
    }
    return false;
  }

  const length = spangram.length;
  const orientations = [];
  if (length >= COLS) orientations.push('across');
  if (length >= ROWS) orientations.push('down');
  const wordLengths = words.map((w) => w.length);

  for (const orientation of shuffle(orientations, rand)) {
    const axis = orientation === 'across' ? colOf : rowOf;
    const far = orientation === 'across' ? COLS - 1 : ROWS - 1;
    const reachedFar = (path) => path.some((i) => axis(i) === far);
    // Prune walks that can no longer reach the far edge with the letters left.
    const prune = (path) =>
      !reachedFar(path) && far - axis(path[path.length - 1]) > length - path.length;
    const starts = [];
    for (let i = 0; i < CELLS; i++) if (axis(i) === 0) starts.push(i);

    for (const start of shuffle(starts, rand)) {
      used[start] = true;
      const ok = extend([start], length, prune, (path) => {
        if (!reachedFar(path) || !regionsFit(used, links, wordLengths)) return false;
        return commit(spangram, path, true, () => placeRest(words));
      });
      if (ok) return placed;
      used[start] = false;
      if (counter.steps > budget) return null;
    }
  }
  return null;
}

// Paths are geometric; each word may read along its path in either direction.
function assignLetters(placed, rand) {
  const grid = new Array(CELLS).fill('');
  const answers = placed.map(({ word, path }, k) => {
    const finalPath = rand() < 0.5 ? path : [...path].reverse();
    finalPath.forEach((cell, i) => { grid[cell] = word[i]; });
    return { word, path: finalPath, isSpangram: k === 0 };
  });
  return { grid, answers };
}

export function verifyPuzzle({ grid, answers }) {
  if (grid.length !== CELLS) return false;
  const seen = new Set();
  for (const { word, path } of answers) {
    if (!isValidPath(path) || path.length !== word.length) return false;
    for (let i = 0; i < path.length; i++) {
      if (seen.has(path[i]) || grid[path[i]] !== word[i]) return false;
      seen.add(path[i]);
    }
  }
  const spangrams = answers.filter((a) => a.isSpangram);
  if (pathsCross(answers.map((a) => a.path))) return false;
  return seen.size === CELLS && spangrams.length === 1 && touchesOppositeEdges(spangrams[0].path);
}

export function generateForTheme(theme, rand) {
  const words = chooseWords(theme, rand);
  if (!words) return null;
  const layout = layoutWords(theme.spangram, words, rand);
  if (!layout || !verifyPuzzle(layout)) return null;
  return { themeId: theme.id, clue: theme.clue, ...layout };
}

export function buildPuzzle(themes, seed) {
  const first = randInt(mulberry32(seed), themes.length);
  for (let t = 0; t < themes.length; t++) {
    const theme = themes[(first + t) % themes.length];
    for (let attempt = 0; attempt < ATTEMPTS_PER_THEME; attempt++) {
      const rand = mulberry32(hashString(`${seed}:${t}:${attempt}`));
      const puzzle = generateForTheme(theme, rand);
      if (puzzle) return { seed, ...puzzle };
    }
  }
  throw new Error(`Could not generate a puzzle for seed ${seed}`);
}
