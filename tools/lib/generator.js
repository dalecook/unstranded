// Check-as-you-go board generator: letters are written as each answer is placed, and the
// letter-dependent rules are checked straight away instead of after the board is full.
//
// Every rule below is monotone while a board is being filled (cells only go from empty to a
// letter, and an empty cell matches nothing), so a branch that breaks one can never recover:
//   - a placed answer with 2+ legal traces keeps them;
//   - an unplaced chosen answer that is already traceable will have a second trace once it is
//     placed in other (still empty) cells;
//   - a traceable long on-theme decoy stays traceable;
//   - a blocked word with a non-exempt trace keeps it (its cells already belong to placed
//     answers, so no later answer can make it a contiguous run);
//   - the set of traceable stepping stones only grows.
// Only "at least two stepping stones" has to wait for the full board.
//
// A new trace must pass through a newly written cell, so after a placement only words that
// share a letter with the new cells are re-checked, after a letter-count prefilter.
import { CELLS, neighbors, diagonalKey } from '../../js/grid.js';
import { searchLayout } from './layout.js';
import { isRunOf } from './blocklist.js';

export const GEN_BUDGET = 12000;
// Budget steps charged per placement check (one reading of one path), on top of walk steps.
export const CHECK_COST = 4;
export const MIN_STONES = 2;
export const MAX_STONES = 5;

const A = 'A'.charCodeAt(0);
const letterIndex = (ch) => ch.charCodeAt(0) - A;

const NEIGHBORS = Array.from({ length: CELLS }, (_, i) => neighbors(i));
// DIAGONAL[a * CELLS + b]: 0 for an orthogonal step, else 4 * square + dir (1 or 2): a square's
// two diagonals get different dirs, and a trace may use at most one of them.
const DIAGONAL = new Int16Array(CELLS * CELLS);
for (let a = 0; a < CELLS; a++) {
  for (const b of NEIGHBORS[a]) {
    const key = diagonalKey(a, b);
    if (key) DIAGONAL[a * CELLS + b] = 4 * key.square + (key.dir === '/' ? 2 : 1);
  }
}

function entry(word) {
  const need = new Array(26).fill(0);
  let mask = 0;
  for (const ch of word) {
    const i = letterIndex(ch);
    need[i]++;
    mask |= 1 << i;
  }
  const needs = [];
  need.forEach((n, i) => { if (n) needs.push(i, n); });
  return { word, rev: [...word].reverse().join(''), mask, needs };
}

// Trace counter over a live grid ('' = empty) and its per-letter counts. traces(e, cap, accept)
// counts the legal traces of e.word (self-avoiding, no crossing diagonals: the same rule as
// checks.walkTraces) up to `cap`; `accept(path)` may veto a trace. The walk starts from
// whichever end letter is rarer on the grid; a reversed trace covers the same cells, so counts
// and run-of-an-answer tests are unchanged.
function createTracer(grid, counts) {
  const visited = new Uint8Array(CELLS);
  const squares = new Uint8Array(CELLS);
  const trail = [];
  function traces(e, cap, accept = null) {
    const fwd = counts[letterIndex(e.word[0])] <= counts[letterIndex(e.rev[0])];
    const w = fwd ? e.word : e.rev;
    const last = w.length - 1;
    let n = 0;
    const walk = (cell, k) => {
      if (k === last) {
        if (!accept || accept(trail)) n++;
        return n >= cap;
      }
      const ch = w[k + 1];
      for (const next of NEIGHBORS[cell]) {
        if (visited[next] || grid[next] !== ch) continue;
        const d = DIAGONAL[cell * CELLS + next];
        const sq = d >> 2;
        if (d) {
          if (squares[sq] && squares[sq] !== (d & 3)) continue;
          squares[sq] = d & 3;
        }
        visited[next] = 1;
        trail.push(next);
        const stop = walk(next, k + 1);
        trail.pop();
        visited[next] = 0;
        if (d) squares[sq] = 0;
        if (stop) return true;
      }
      return false;
    };
    const first = w[0];
    for (let c = 0; c < CELLS; c++) {
      if (grid[c] !== first) continue;
      visited[c] = 1;
      trail.push(c);
      const stop = walk(c, 0);
      trail.pop();
      visited[c] = 0;
      if (stop) break;
    }
    return n;
  }
  return traces;
}

// Legal traces of `word` on `grid`, up to `cap` (for tests: matches checks.countTraces).
export function traceCount(grid, word, cap = Infinity) {
  const counts = new Array(26).fill(0);
  for (const ch of grid) if (ch) counts[letterIndex(ch)]++;
  return createTracer(grid, counts)(entry(word), cap);
}

// Blocklist entries are shared by every board built against the same blockset.
const blockedCache = new WeakMap();
function blockedEntries(blockset) {
  if (!blockedCache.has(blockset)) blockedCache.set(blockset, [...blockset].map(entry));
  return blockedCache.get(blockset);
}

// Incremental checker for one board. place() writes a word's letters along `path` and returns
// null when every rule still holds, or the reason ('ambiguous', 'long-decoy', 'offensive',
// 'stones') after rolling the placement back. undo() removes the last accepted placement.
export function createBoardChecker({ chosen, answers = [], recognized = [], blockset = new Set(), maxStones = MAX_STONES }) {
  const chosenSet = new Set(chosen);
  const unplaced = new Map(chosen.map((w) => [w, entry(w)]));
  const decoys = [...new Set([...answers, ...recognized])]
    .filter((w) => w.length >= 6 && !chosenSet.has(w)).map(entry);
  const stoneWords = [...new Set(recognized)]
    .filter((w) => w.length >= 4 && w.length <= 5 && !chosenSet.has(w)).map(entry);
  const blocked = blockedEntries(blockset);

  const grid = new Array(CELLS).fill('');
  const counts = new Array(26).fill(0);
  const placed = [];
  const found = new Set();
  const frames = [];

  const traces = createTracer(grid, counts);
  const traceable = (e) => traces(e, 1) > 0;
  const unexempt = (e) => traces(e, 1, (path) => !placed.some((a) => isRunOf(path, a.path))) > 0;

  // Letter mask of the filled cells; kept in step with counts.
  let gridMask = 0;
  // Could `e` have gained a trace? It must use a new cell's letter, and the grid must hold
  // all of its letters in sufficient numbers.
  function reachable(e, newMask) {
    if ((e.mask & newMask) === 0 || (e.mask & ~gridMask) !== 0) return false;
    const nd = e.needs;
    for (let j = 0; j < nd.length; j += 2) if (counts[nd[j]] < nd[j + 1]) return false;
    return true;
  }

  function write(word, path) {
    path.forEach((cell, i) => {
      const l = letterIndex(word[i]);
      grid[cell] = word[i];
      counts[l]++;
      gridMask |= 1 << l;
    });
  }
  function erase(word, path) {
    path.forEach((cell, i) => {
      const l = letterIndex(word[i]);
      grid[cell] = '';
      if (--counts[l] === 0) gridMask &= ~(1 << l);
    });
  }

  function check(newMask) {
    for (const a of placed) {
      if ((a.e.mask & newMask) && traces(a.e, 2) >= 2) return { why: 'ambiguous' };
    }
    for (const e of unplaced.values()) {
      if (reachable(e, newMask) && traceable(e)) return { why: 'ambiguous' };
    }
    for (const e of decoys) {
      if (reachable(e, newMask) && traceable(e)) return { why: 'long-decoy' };
    }
    for (const e of blocked) {
      if (reachable(e, newMask) && unexempt(e)) return { why: 'offensive' };
    }
    const newStones = [];
    for (const e of stoneWords) {
      if (found.has(e.word) || !reachable(e, newMask) || !traceable(e)) continue;
      newStones.push(e.word);
      if (found.size + newStones.length > maxStones) return { why: 'stones' };
    }
    return { why: null, newStones };
  }

  return {
    grid,
    stones: () => [...found].sort(),
    place(word, path) {
      const e = unplaced.get(word) ?? entry(word);
      write(word, path);
      unplaced.delete(word);
      placed.push({ word, path, e });
      const { why, newStones } = check(e.mask);
      if (why) {
        placed.pop();
        if (chosenSet.has(word)) unplaced.set(word, e);
        erase(word, path);
        return why;
      }
      newStones.forEach((w) => found.add(w));
      frames.push({ word, path, e, newStones });
      return null;
    },
    undo() {
      const { word, path, e, newStones } = frames.pop();
      newStones.forEach((w) => found.delete(w));
      placed.pop();
      if (chosenSet.has(word)) unplaced.set(word, e);
      erase(word, path);
    },
  };
}

// A finished board for `words` (plus the theme's spangram), or null within the step budget.
// Each path is tried in both reading directions (random order), the spangram included: it only
// has to touch opposite edges, not read away from a particular one. The result satisfies every
// checkPuzzle rule and has no blocked word; callers still verify it with checkPuzzle.
// `stats` (optional) counts pruned placements by reason; 'few-stones' counts full boards
// rejected for having fewer than MIN_STONES stepping stones.
export function generateBoard(theme, words, rand, { blockset = new Set(), budget = GEN_BUDGET, stats = {} } = {}) {
  const checker = createBoardChecker({
    chosen: [theme.spangram, ...words], answers: theme.answers, recognized: theme.recognized, blockset,
  });
  const counter = { steps: 0 };
  const place = (word, path, isSpangram, next) => {
    const reversed = [...path].reverse();
    const readings = rand() < 0.5 ? [path, reversed] : [reversed, path];
    for (const reading of readings) {
      counter.steps += CHECK_COST;
      const why = checker.place(word, reading);
      if (why) { stats[why] = (stats[why] ?? 0) + 1; continue; }
      if (next(reading)) return true;
      checker.undo();
      if (counter.steps > budget) return false;
    }
    return false;
  };
  const done = () => {
    if (checker.stones().length >= MIN_STONES) return true;
    stats['few-stones'] = (stats['few-stones'] ?? 0) + 1;
    return false;
  };
  const placed = searchLayout(theme.spangram, words, rand, budget, place, { counter, done });
  if (!placed) return null;
  return {
    grid: [...checker.grid],
    answers: placed.map(({ word, path }, k) => ({ word, path, isSpangram: k === 0 })),
    steppingStones: checker.stones(),
  };
}
