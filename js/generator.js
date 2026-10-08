import { COLS, ROWS, CELLS, neighbors, rowOf, colOf, isValidPath, touchesOppositeEdges } from './grid.js';
import { mulberry32, hashString, shuffle, randInt } from './rng.js';

const STEP_BUDGET = 20000;
const ATTEMPTS_PER_THEME = 10;

// Pick non-spangram words whose lengths exactly fill the rest of the board.
export function chooseWords(theme, rand) {
  const target = CELLS - theme.spangram.length;
  const pool = shuffle(theme.words, rand);
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

function emptyRegionSizes(used) {
  const seen = new Array(CELLS).fill(false);
  const sizes = [];
  for (let i = 0; i < CELLS; i++) {
    if (used[i] || seen[i]) continue;
    let size = 0;
    const stack = [i];
    seen[i] = true;
    while (stack.length) {
      const cur = stack.pop();
      size++;
      for (const n of neighbors(cur)) {
        if (!used[n] && !seen[n]) {
          seen[n] = true;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  return sizes;
}

// Every isolated empty region must be fillable by some of the remaining words.
function regionsFit(used, remainingLengths) {
  const sums = subsetSums(remainingLengths);
  return emptyRegionSizes(used).every((size) => sums.has(size));
}

export function layoutWords(spangram, words, rand, budget = STEP_BUDGET) {
  const used = new Array(CELLS).fill(false);
  const placed = [];
  let steps = 0;

  function extend(path, length, prune, accept) {
    if (++steps > budget) return false;
    if (path.length === length) return accept(path);
    if (prune && prune(path)) return false;
    for (const n of shuffle(neighbors(path[path.length - 1]), rand)) {
      if (used[n]) continue;
      used[n] = true;
      path.push(n);
      if (extend(path, length, prune, accept)) return true;
      path.pop();
      used[n] = false;
    }
    return false;
  }

  function placeRest(remaining) {
    if (remaining.length === 0) return used.every(Boolean);
    const first = used.indexOf(false);
    const triedLengths = new Set();
    for (const word of shuffle(remaining, rand)) {
      if (triedLengths.has(word.length)) continue;
      triedLengths.add(word.length);
      const rest = remaining.filter((w) => w !== word);
      const restLengths = rest.map((w) => w.length);
      used[first] = true;
      const ok = extend([first], word.length, null, (path) => {
        if (!regionsFit(used, restLengths)) return false;
        placed.push({ word, path: [...path] });
        if (placeRest(rest)) return true;
        placed.pop();
        return false;
      });
      if (ok) return true;
      used[first] = false;
      if (steps > budget) return false;
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
        if (!reachedFar(path) || !regionsFit(used, wordLengths)) return false;
        placed.push({ word: spangram, path: [...path] });
        if (placeRest(words)) return true;
        placed.pop();
        return false;
      });
      if (ok) return assignLetters(placed, rand);
      used[start] = false;
      if (steps > budget) return null;
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
