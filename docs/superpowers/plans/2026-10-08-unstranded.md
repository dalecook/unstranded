# UnStranded Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, mobile-friendly, single-page Strands-style word game with a shared daily puzzle and unlimited seeded random puzzles.

**Architecture:** Plain ES modules with no build step. Pure logic modules (`grid`, `rng`, `generator`, `game`, `storage`, `share`, the pure half of `input`) are unit-tested with Node's built-in test runner; DOM modules (`render`, `main`, the controller half of `input`) are verified manually in a browser. A puzzle is fully determined by a 32-bit seed: the seed picks a theme, a word subset, and a backtracking layout that fills all 48 cells.

**Tech Stack:** HTML, CSS, JavaScript ES modules; Node 22 (`node --test`) for tests and a tiny static dev server; no npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-unstranded-design.md`

## Global Constraints

- Grid is 6 columns × 8 rows = 48 cells; cell index `i = row * 6 + col`.
- Every letter belongs to exactly one answer; adjacency is 8-directional; no cell reused within a word.
- Spangram touches two opposite edges (cols 0 and 5, or rows 0 and 7).
- Theme words: uppercase `A–Z` only, length 4–9. Spangram: uppercase `A–Z`, length 6–14, multi-word spangrams written joined.
- Preferred answer count is 6–8 including the spangram (5–7 other words); fallback 5–10 (4–9 other words).
- Bonus words: 4+ letters, in dictionary, not a theme word. 3 bonus words fill the hint meter; using a hint empties it.
- A theme word only counts on its intended path; otherwise show "Right word, wrong spot!".
- Daily seed derived from local date `YYYY-MM-DD`; random puzzles use `?p=<seed>` (decimal, 0–4294967295).
- All asset paths relative (works under GitHub Pages / itch.io subpaths). No external requests (fonts, CDNs).
- Grid width `min(92vw, 420px)` (further limited by viewport height so the page fits without scrolling); grid has `touch-action: none`; tap targets ≥ 44px for buttons.
- All `localStorage` access wrapped in try/catch; the game must work without it.
- No runtime dependencies. Tests use only `node:test` and `node:assert/strict`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

```
package.json                 "type": "module", test + serve scripts
.gitattributes               normalise line endings to LF
.nojekyll                    stop GitHub Pages running Jekyll
README.md                    how to play/run/deploy, credits
index.html                   page shell + dialogs
css/style.css                responsive layout, light/dark tokens
js/grid.js                   grid constants + adjacency/path helpers
js/rng.js                    seeded PRNG, hashing, date keys, shuffle
js/generator.js              theme + seed → verified puzzle
js/game.js                   pure game-state transitions
js/storage.js                localStorage wrapper, progress, stats
js/share.js                  emoji summary + share/clipboard
js/input.js                  pure selection steps + pointer controller
js/render.js                 DOM board drawing
js/main.js                   app bootstrap and wiring
data/themes.json             ~100 themes
data/words.txt               bonus-word dictionary (generated)
tools/build-dictionary.mjs   downloads + filters ENABLE into data/words.txt
tools/serve.mjs              zero-dependency static dev server
.claude/launch.json          dev-server config for previews
tests/grid.test.js
tests/rng.test.js
tests/generator.test.js
tests/themes.test.js
tests/generator.bulk.test.js
tests/game.test.js
tests/storage.test.js
tests/share.test.js
tests/input.test.js
```

---

### Task 1: Project scaffold and grid helpers

**Files:**
- Create: `package.json`, `.gitattributes`, `.nojekyll`, `js/grid.js`
- Test: `tests/grid.test.js`

**Interfaces:**
- Consumes: nothing
- Produces (`js/grid.js`):
  - `COLS = 6`, `ROWS = 8`, `CELLS = 48`
  - `rowOf(i: number): number`, `colOf(i: number): number`
  - `isAdjacent(a: number, b: number): boolean` (false for `a === b`)
  - `neighbors(i: number): number[]` (ascending order)
  - `isValidPath(path: number[]): boolean` (non-empty, in range, unique, consecutive cells adjacent)
  - `touchesOppositeEdges(path: number[]): boolean`
  - `samePath(a: number[], b: number[]): boolean`

- [ ] **Step 1: Create scaffold files**

`package.json`:
```json
{
  "name": "unstranded",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "An unlimited Strands-style word search.",
  "scripts": {
    "test": "node --test",
    "serve": "node tools/serve.mjs",
    "build:dictionary": "node tools/build-dictionary.mjs"
  }
}
```

`.gitattributes`:
```
* text=auto eol=lf
```

`.nojekyll`: empty file.

- [ ] **Step 2: Write the failing test** — `tests/grid.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLS, ROWS, CELLS, rowOf, colOf, isAdjacent, neighbors,
  isValidPath, touchesOppositeEdges, samePath,
} from '../js/grid.js';

test('grid dimensions', () => {
  assert.equal(COLS, 6);
  assert.equal(ROWS, 8);
  assert.equal(CELLS, 48);
});

test('rowOf / colOf', () => {
  assert.equal(rowOf(0), 0);
  assert.equal(colOf(0), 0);
  assert.equal(rowOf(7), 1);
  assert.equal(colOf(7), 1);
  assert.equal(rowOf(47), 7);
  assert.equal(colOf(47), 5);
});

test('neighbors of corner, edge and middle cells', () => {
  assert.deepEqual(neighbors(0), [1, 6, 7]);
  assert.deepEqual(neighbors(5), [4, 10, 11]);
  assert.equal(neighbors(7).length, 8);
  assert.deepEqual(neighbors(47), [40, 41, 46]);
});

test('isAdjacent does not wrap around rows', () => {
  assert.equal(isAdjacent(0, 7), true);
  assert.equal(isAdjacent(0, 2), false);
  assert.equal(isAdjacent(5, 6), false);
  assert.equal(isAdjacent(3, 3), false);
});

test('isValidPath', () => {
  assert.equal(isValidPath([0, 1, 2, 8]), true);
  assert.equal(isValidPath([]), false);
  assert.equal(isValidPath([0, 2]), false);
  assert.equal(isValidPath([0, 1, 0]), false);
  assert.equal(isValidPath([47, 48]), false);
});

test('touchesOppositeEdges', () => {
  assert.equal(touchesOppositeEdges([0, 1, 2, 3, 4, 5]), true);
  assert.equal(touchesOppositeEdges([0, 6, 12, 18, 24, 30, 36, 42]), true);
  assert.equal(touchesOppositeEdges([0, 1, 2]), false);
});

test('samePath', () => {
  assert.equal(samePath([1, 2, 3], [1, 2, 3]), true);
  assert.equal(samePath([1, 2, 3], [3, 2, 1]), false);
  assert.equal(samePath([1, 2], [1, 2, 3]), false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/grid.test.js`
Expected: FAIL — `Cannot find module '.../js/grid.js'`

- [ ] **Step 4: Implement** — `js/grid.js`

```js
// Grid geometry shared by the generator, game logic, input and rendering.
export const COLS = 6;
export const ROWS = 8;
export const CELLS = COLS * ROWS;

export const rowOf = (i) => Math.floor(i / COLS);
export const colOf = (i) => i % COLS;

export function isAdjacent(a, b) {
  if (a === b) return false;
  return Math.abs(rowOf(a) - rowOf(b)) <= 1 && Math.abs(colOf(a) - colOf(b)) <= 1;
}

export function neighbors(i) {
  const out = [];
  const r = rowOf(i);
  const c = colOf(i);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) out.push(nr * COLS + nc);
    }
  }
  return out;
}

export function isValidPath(path) {
  if (path.length === 0) return false;
  const seen = new Set();
  for (let k = 0; k < path.length; k++) {
    const i = path[k];
    if (!Number.isInteger(i) || i < 0 || i >= CELLS || seen.has(i)) return false;
    seen.add(i);
    if (k > 0 && !isAdjacent(path[k - 1], i)) return false;
  }
  return true;
}

export function touchesOppositeEdges(path) {
  const cols = path.map(colOf);
  const rows = path.map(rowOf);
  return (cols.includes(0) && cols.includes(COLS - 1)) ||
    (rows.includes(0) && rows.includes(ROWS - 1));
}

export function samePath(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/grid.test.js`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json .gitattributes .nojekyll js/grid.js tests/grid.test.js
git commit -m "feat: project scaffold and grid helpers"
```

---

### Task 2: Seeded randomness

**Files:**
- Create: `js/rng.js`
- Test: `tests/rng.test.js`

**Interfaces:**
- Consumes: nothing
- Produces (`js/rng.js`):
  - `mulberry32(seed: number): () => number` — deterministic floats in `[0, 1)`
  - `hashString(str: string): number` — FNV-1a 32-bit, unsigned
  - `dateKey(date?: Date): string` — local date `YYYY-MM-DD`
  - `dailySeed(date?: Date): number` — `hashString('daily-' + dateKey(date))`
  - `randomSeed(): number` — crypto-random uint32
  - `randInt(rand: () => number, n: number): number` — integer in `[0, n)`
  - `shuffle<T>(items: T[], rand): T[]` — new array, Fisher–Yates, input untouched

- [ ] **Step 1: Write the failing test** — `tests/rng.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, hashString, dateKey, dailySeed, randomSeed, randInt, shuffle } from '../js/rng.js';

test('mulberry32 is deterministic and in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('hashString is FNV-1a 32-bit', () => {
  assert.equal(hashString(''), 2166136261);
  assert.equal(hashString('a'), 0xe40c292c);
  assert.equal(hashString('daily-2026-10-08'), hashString('daily-2026-10-08'));
});

test('dateKey uses the local date, zero padded', () => {
  assert.equal(dateKey(new Date(2026, 9, 8, 23, 59)), '2026-10-08');
  assert.equal(dateKey(new Date(2026, 0, 2)), '2026-01-02');
});

test('dailySeed is stable per day and differs between days', () => {
  const d1 = new Date(2026, 9, 8, 1);
  const d1later = new Date(2026, 9, 8, 22);
  const d2 = new Date(2026, 9, 9, 1);
  assert.equal(dailySeed(d1), dailySeed(d1later));
  assert.notEqual(dailySeed(d1), dailySeed(d2));
  assert.equal(dailySeed(d1), hashString('daily-2026-10-08'));
});

test('randomSeed returns a uint32', () => {
  const s = randomSeed();
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
});

test('randInt stays in range', () => {
  const rand = mulberry32(7);
  for (let i = 0; i < 1000; i++) {
    const n = randInt(rand, 5);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 5);
  }
});

test('shuffle is deterministic, keeps elements, does not mutate input', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = shuffle(input, mulberry32(3));
  const b = shuffle(input, mulberry32(3));
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), [...input].sort());
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/rng.test.js`
Expected: FAIL — cannot find module `js/rng.js`

- [ ] **Step 3: Implement** — `js/rng.js`

```js
// Deterministic randomness: the same seed must give the same puzzle on every device.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dailySeed(date = new Date()) {
  return hashString(`daily-${dateKey(date)}`);
}

export function randomSeed() {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
}

export function randInt(rand, n) {
  return Math.floor(rand() * n);
}

export function shuffle(items, rand) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rand, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/rng.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add js/rng.js tests/rng.test.js
git commit -m "feat: seeded RNG, hashing and date keys"
```

---

### Task 3: Puzzle generator

**Files:**
- Create: `js/generator.js`
- Test: `tests/generator.test.js`

**Interfaces:**
- Consumes: `js/grid.js` (`COLS, ROWS, CELLS, neighbors, rowOf, colOf, isValidPath, touchesOppositeEdges`), `js/rng.js` (`mulberry32, hashString, shuffle, randInt`)
- Produces (`js/generator.js`):
  - Theme shape: `{ id: string, clue: string, spangram: string, words: string[] }`
  - Puzzle shape: `{ seed: number, themeId: string, clue: string, grid: string[48], answers: Answer[] }` where `Answer = { word: string, path: number[], isSpangram: boolean }`; `answers[0]` is the spangram; `path[k]` is the cell holding `word[k]`.
  - `chooseWords(theme, rand): string[] | null` — non-spangram words whose lengths sum to `48 - spangram.length`
  - `layoutWords(spangram: string, words: string[], rand, budget?: number): { grid, answers } | null`
  - `verifyPuzzle({ grid, answers }): boolean`
  - `generateForTheme(theme, rand): Omit<Puzzle, 'seed'> | null`
  - `buildPuzzle(themes: Theme[], seed: number): Puzzle` — throws if every theme fails

**Algorithm notes (read before implementing):** The spangram is placed first as a random self-avoiding walk that starts on one edge (col 0 or row 0) and must reach the opposite edge; walks that can no longer reach it are pruned. Each further word starts at the first empty cell in reading order, which keeps the board filling from one corner and avoids stranded pockets. After every placement, each connected empty region's size must be a subset-sum of the remaining word lengths, otherwise backtrack. Words of equal length are geometrically interchangeable, so only one per length is tried at each step. A step budget bounds the search; on failure `buildPuzzle` retries with derived seeds (10 per theme), then moves to the next theme. A scratch prototype of this exact algorithm packed 1,000/1,000 seeds for each of four sample themes (including a 14-letter spangram) at 2–11 ms average in Node.

- [ ] **Step 1: Write the failing test** — `tests/generator.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/rng.js';
import { CELLS } from '../js/grid.js';
import { chooseWords, layoutWords, verifyPuzzle, generateForTheme, buildPuzzle } from '../js/generator.js';

const UTENSILS = {
  id: 'utensils',
  clue: 'Drawer full of tools',
  spangram: 'UTENSILS',
  words: ['WHISK', 'LADLE', 'TONGS', 'SPATULA', 'GRATER', 'PEELER', 'SCOOP', 'MASHER', 'SKEWER', 'STRAINER', 'ZESTER', 'SPOON'],
};
const PLANETS = {
  id: 'solarsystem',
  clue: 'Space neighbours',
  spangram: 'SOLARSYSTEM',
  words: ['MERCURY', 'VENUS', 'EARTH', 'MARS', 'JUPITER', 'SATURN', 'URANUS', 'NEPTUNE', 'PLUTO', 'MOON', 'COMET'],
};

test('chooseWords fills the board exactly with 5-7 other words', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const words = chooseWords(UTENSILS, mulberry32(seed));
    assert.ok(words, `seed ${seed} found no subset`);
    const total = words.reduce((sum, w) => sum + w.length, 0);
    assert.equal(total + UTENSILS.spangram.length, CELLS);
    assert.ok(words.length >= 5 && words.length <= 7);
    assert.equal(new Set(words).size, words.length);
  }
});

test('chooseWords is deterministic for a seed', () => {
  assert.deepEqual(chooseWords(UTENSILS, mulberry32(9)), chooseWords(UTENSILS, mulberry32(9)));
});

test('chooseWords returns null when no subset can fill the board', () => {
  const tiny = { id: 't', clue: 't', spangram: 'ABCDEF', words: ['ABCD', 'EFGH'] };
  assert.equal(chooseWords(tiny, mulberry32(1)), null);
});

test('layoutWords produces a verified, fully covered grid', () => {
  const rand = mulberry32(123);
  const words = chooseWords(UTENSILS, rand);
  const layout = layoutWords(UTENSILS.spangram, words, rand);
  assert.ok(layout);
  assert.equal(layout.grid.length, CELLS);
  assert.ok(layout.grid.every((ch) => /^[A-Z]$/.test(ch)));
  assert.equal(layout.answers[0].word, 'UTENSILS');
  assert.equal(layout.answers[0].isSpangram, true);
  assert.equal(layout.answers.filter((a) => a.isSpangram).length, 1);
  assert.ok(verifyPuzzle(layout));
});

test('verifyPuzzle rejects a tampered grid', () => {
  const rand = mulberry32(5);
  const layout = layoutWords(UTENSILS.spangram, chooseWords(UTENSILS, rand), rand);
  const cell = layout.answers[1].path[0];
  const grid = [...layout.grid];
  grid[cell] = grid[cell] === 'Q' ? 'Z' : 'Q';
  assert.equal(verifyPuzzle({ ...layout, grid }), false);
});

test('generateForTheme carries theme metadata', () => {
  const puzzle = generateForTheme(PLANETS, mulberry32(77));
  assert.ok(puzzle);
  assert.equal(puzzle.themeId, 'solarsystem');
  assert.equal(puzzle.clue, 'Space neighbours');
  assert.ok(verifyPuzzle(puzzle));
});

test('buildPuzzle is deterministic per seed', () => {
  const themes = [UTENSILS, PLANETS];
  assert.deepEqual(buildPuzzle(themes, 2026), buildPuzzle(themes, 2026));
  assert.equal(buildPuzzle(themes, 2026).seed, 2026);
});

test('buildPuzzle gives different boards for different seeds', () => {
  const themes = [UTENSILS, PLANETS];
  const grids = new Set();
  for (let seed = 1; seed <= 20; seed++) grids.add(buildPuzzle(themes, seed).grid.join(''));
  assert.ok(grids.size >= 18);
});

test('buildPuzzle throws when no theme can be generated', () => {
  const broken = { id: 'b', clue: 'b', spangram: 'ABCDEF', words: ['ABCD'] };
  assert.throws(() => buildPuzzle([broken], 1), /Could not generate/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/generator.test.js`
Expected: FAIL — cannot find module `js/generator.js`

- [ ] **Step 3: Implement** — `js/generator.js`

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/generator.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add js/generator.js tests/generator.test.js
git commit -m "feat: seeded puzzle generator with backtracking layout"
```

---

### Task 4: Theme data and validation

**Files:**
- Create: `data/themes.json`
- Test: `tests/themes.test.js`, `tests/generator.bulk.test.js`

**Interfaces:**
- Consumes: `chooseWords`, `buildPuzzle`, `verifyPuzzle` from `js/generator.js`; `mulberry32` from `js/rng.js`
- Produces: `data/themes.json` — array of Theme objects (shape in Task 3). `id` is the lowercase spangram.

- [ ] **Step 1: Write the failing tests**

`tests/themes.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseWords } from '../js/generator.js';
import { mulberry32 } from '../js/rng.js';

const themes = JSON.parse(readFileSync(new URL('../data/themes.json', import.meta.url), 'utf8'));

test('there are at least 90 themes with unique ids and spangrams', () => {
  assert.ok(themes.length >= 90, `only ${themes.length} themes`);
  assert.equal(new Set(themes.map((t) => t.id)).size, themes.length);
  assert.equal(new Set(themes.map((t) => t.spangram)).size, themes.length);
});

for (const theme of themes) {
  test(`theme "${theme.id}" is valid`, () => {
    assert.equal(typeof theme.clue, 'string');
    assert.ok(theme.clue.trim().length > 0);
    assert.match(theme.spangram, /^[A-Z]{6,14}$/);
    assert.ok(theme.words.length >= 10, 'needs at least 10 words for variety');
    for (const w of theme.words) assert.match(w, /^[A-Z]{4,9}$/, `bad word ${w}`);
    assert.equal(new Set(theme.words).size, theme.words.length, 'duplicate words');
    assert.ok(!theme.words.includes(theme.spangram), 'spangram repeated in words');

    const subsets = new Set();
    for (let seed = 1; seed <= 20; seed++) {
      const words = chooseWords(theme, mulberry32(seed));
      assert.ok(words, `no word subset for seed ${seed}`);
      subsets.add([...words].sort().join(','));
    }
    assert.ok(subsets.size >= 3, `only ${subsets.size} distinct word sets`);
  });
}
```

`tests/generator.bulk.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPuzzle, verifyPuzzle } from '../js/generator.js';

const themes = JSON.parse(readFileSync(new URL('../data/themes.json', import.meta.url), 'utf8'));

test('5,000 seeds all produce verified puzzles quickly', () => {
  let total = 0;
  let max = 0;
  const themeCounts = new Map();
  for (let seed = 1; seed <= 5000; seed++) {
    const t0 = performance.now();
    const puzzle = buildPuzzle(themes, seed);
    const dt = performance.now() - t0;
    total += dt;
    max = Math.max(max, dt);
    assert.ok(verifyPuzzle(puzzle), `seed ${seed} failed verification`);
    themeCounts.set(puzzle.themeId, (themeCounts.get(puzzle.themeId) ?? 0) + 1);
  }
  const avg = total / 5000;
  console.log(`avg ${avg.toFixed(2)} ms, max ${max.toFixed(1)} ms, ${themeCounts.size} themes used`);
  assert.ok(avg < 25, `average generation ${avg.toFixed(2)} ms is too slow`);
  assert.ok(themeCounts.size >= themes.length * 0.9, 'some themes are never chosen');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/themes.test.js tests/generator.bulk.test.js`
Expected: FAIL — `ENOENT ... data/themes.json`

- [ ] **Step 3: Create** `data/themes.json`

Clues are hand-written; word pools draw on the CC0 dariusk/corpora categories. NYT content is not used.

```json
[
  {"id":"utensils","clue":"Drawer full of tools","spangram":"UTENSILS","words":["WHISK","LADLE","TONGS","SPATULA","GRATER","PEELER","SCOOP","MASHER","SKEWER","STRAINER","ZESTER","SPOON"]},
  {"id":"songbirds","clue":"Feathered friends","spangram":"SONGBIRDS","words":["ROBIN","FINCH","WREN","THRUSH","WARBLER","SPARROW","LARK","ORIOLE","TANAGER","BLUEBIRD","CARDINAL","CANARY"]},
  {"id":"dogbreeds","clue":"Who's a good boy?","spangram":"DOGBREEDS","words":["POODLE","BEAGLE","BOXER","CORGI","HUSKY","COLLIE","TERRIER","SPANIEL","WHIPPET","MASTIFF","BULLDOG","BASSET"]},
  {"id":"solarsystem","clue":"Space neighbours","spangram":"SOLARSYSTEM","words":["MERCURY","VENUS","EARTH","MARS","JUPITER","SATURN","URANUS","NEPTUNE","PLUTO","MOON","COMET"]},
  {"id":"toppings","clue":"Pie in the sky","spangram":"TOPPINGS","words":["PEPPERONI","SAUSAGE","ONION","OLIVE","MUSHROOM","PEPPER","BACON","ANCHOVY","SPINACH","CHEESE","BASIL","PINEAPPLE"]},
  {"id":"elements","clue":"Periodic visitors","spangram":"ELEMENTS","words":["OXYGEN","CARBON","HELIUM","NEON","IRON","GOLD","SILVER","COPPER","ZINC","SODIUM","CALCIUM","NITROGEN"]},
  {"id":"fruitbowl","clue":"Five a day","spangram":"FRUITBOWL","words":["APPLE","BANANA","ORANGE","GRAPE","MANGO","PEAR","PLUM","KIWI","LEMON","CHERRY","PEACH","MELON"]},
  {"id":"orchestra","clue":"Strike up the band","spangram":"ORCHESTRA","words":["VIOLIN","CELLO","FLUTE","OBOE","HARP","TUBA","TRUMPET","CLARINET","BASSOON","VIOLA","PICCOLO","TIMPANI"]},
  {"id":"forecast","clue":"What's it like out?","spangram":"FORECAST","words":["RAIN","SNOW","SLEET","HAIL","MIST","SUNNY","CLOUDY","STORM","WINDY","THUNDER","DRIZZLE","BREEZE"]},
  {"id":"colorwheel","clue":"Paint box","spangram":"COLORWHEEL","words":["CRIMSON","SCARLET","AMBER","VIOLET","INDIGO","TEAL","MAROON","CYAN","MAGENTA","OCHRE","BEIGE","OLIVE"]},
  {"id":"woodland","clue":"Branching out","spangram":"WOODLAND","words":["MAPLE","BIRCH","WILLOW","CEDAR","PINE","SPRUCE","ASPEN","BEECH","ALDER","HAZEL","LARCH","POPLAR"]},
  {"id":"cheeseboard","clue":"Say cheese!","spangram":"CHEESEBOARD","words":["BRIE","GOUDA","CHEDDAR","FETA","EDAM","STILTON","GRUYERE","CAMEMBERT","RICOTTA","HALLOUMI","PANEER","ASIAGO"]},
  {"id":"ballgames","clue":"Play ball!","spangram":"BALLGAMES","words":["SOCCER","TENNIS","RUGBY","CRICKET","BASEBALL","HOCKEY","GOLF","POLO","NETBALL","SQUASH","BOWLING","LACROSSE"]},
  {"id":"vegetables","clue":"Eat your greens","spangram":"VEGETABLES","words":["CARROT","POTATO","ONION","LEEK","CELERY","CABBAGE","SPINACH","LETTUCE","RADISH","TURNIP","PARSNIP","KALE"]},
  {"id":"seacreatures","clue":"Under the sea","spangram":"SEACREATURES","words":["SHARK","WHALE","SQUID","OCTOPUS","CRAB","LOBSTER","DOLPHIN","SEAL","CORAL","STARFISH","URCHIN","JELLYFISH"]},
  {"id":"geometry","clue":"Get in shape","spangram":"GEOMETRY","words":["CIRCLE","SQUARE","OVAL","TRIANGLE","HEXAGON","PENTAGON","RHOMBUS","CUBE","SPHERE","CONE","PRISM","STAR"]},
  {"id":"coffeeshop","clue":"Morning pick-me-up","spangram":"COFFEESHOP","words":["LATTE","MOCHA","ESPRESSO","CORTADO","MACCHIATO","AMERICANO","DECAF","BREW","ROAST","BEANS","CREMA","FRAPPE"]},
  {"id":"anatomy","clue":"Head to toe","spangram":"ANATOMY","words":["ELBOW","KNEE","ANKLE","WRIST","SHOULDER","THUMB","CHIN","NECK","HEEL","CHEST","SHIN","FOREARM"]},
  {"id":"hardware","clue":"In the toolbox","spangram":"HARDWARE","words":["HAMMER","WRENCH","PLIERS","CHISEL","DRILL","SANDER","CLAMP","LEVEL","MALLET","SPANNER","RASP","VICE"]},
  {"id":"capitals","clue":"Seats of power","spangram":"CAPITALS","words":["PARIS","LONDON","ROME","MADRID","BERLIN","TOKYO","OTTAWA","CAIRO","LIMA","OSLO","DUBLIN","VIENNA"]},
  {"id":"cardgames","clue":"Deal me in","spangram":"CARDGAMES","words":["POKER","RUMMY","BRIDGE","SNAP","WHIST","CRIBBAGE","CANASTA","EUCHRE","HEARTS","SPADES","SOLITAIRE","BACCARAT"]},
  {"id":"bouquet","clue":"Say it with flowers","spangram":"BOUQUET","words":["ROSE","TULIP","DAISY","LILY","ORCHID","POPPY","IRIS","PEONY","DAHLIA","VIOLET","LILAC","ASTER"]},
  {"id":"desserts","clue":"Save room","spangram":"DESSERTS","words":["CAKE","TART","MOUSSE","SUNDAE","BROWNIE","CUSTARD","TRIFLE","PUDDING","SORBET","GELATO","COBBLER","ECLAIR"]},
  {"id":"farmanimals","clue":"Old MacDonald had...","spangram":"FARMANIMALS","words":["HORSE","SHEEP","GOAT","PIGLET","CHICKEN","DUCK","GOOSE","TURKEY","DONKEY","LLAMA","ROOSTER","CALF"]},
  {"id":"chessboard","clue":"Your move","spangram":"CHESSBOARD","words":["KING","QUEEN","ROOK","BISHOP","KNIGHT","PAWN","CHECK","MATE","CASTLE","GAMBIT","STALEMATE","OPENING"]},
  {"id":"campsite","clue":"Roughing it","spangram":"CAMPSITE","words":["TENT","LANTERN","COMPASS","CAMPFIRE","KINDLING","HAMMOCK","COOLER","TARP","CANTEEN","MATCHES","STOVE","TORCH"]},
  {"id":"ingredients","clue":"Bake off","spangram":"INGREDIENTS","words":["FLOUR","SUGAR","BUTTER","YEAST","EGGS","MILK","VANILLA","COCOA","HONEY","SALT","RAISINS","CREAM"]},
  {"id":"alphabet","clue":"It's all Greek to me","spangram":"ALPHABET","words":["ALPHA","BETA","GAMMA","DELTA","THETA","LAMBDA","SIGMA","OMEGA","KAPPA","IOTA","ZETA","EPSILON"]},
  {"id":"gemstones","clue":"Jewel box","spangram":"GEMSTONES","words":["RUBY","EMERALD","DIAMOND","SAPPHIRE","OPAL","PEARL","TOPAZ","GARNET","AMETHYST","JADE","ONYX","QUARTZ"]},
  {"id":"currency","clue":"Spare change","spangram":"CURRENCY","words":["DOLLAR","EURO","POUND","PESO","RUPEE","FRANC","KRONA","DINAR","RAND","YUAN","LIRA","SHEKEL"]},
  {"id":"carparts","clue":"Under the hood","spangram":"CARPARTS","words":["WHEEL","BRAKE","CLUTCH","PISTON","BUMPER","MIRROR","HORN","TIRE","GEARBOX","RADIATOR","BATTERY","AXLE"]},
  {"id":"insects","clue":"Creepy crawlies","spangram":"INSECTS","words":["BEETLE","CRICKET","MOTH","WASP","HORNET","LOCUST","FIREFLY","TERMITE","APHID","MANTIS","EARWIG","GNAT","FLEA"]},
  {"id":"ballroom","clue":"Shall we dance?","spangram":"BALLROOM","words":["WALTZ","TANGO","SALSA","RUMBA","SAMBA","FOXTROT","POLKA","JIVE","MAMBO","CHACHA","QUICKSTEP","BOLERO"]},
  {"id":"seasoning","clue":"Herb garden","spangram":"SEASONING","words":["BASIL","THYME","SAGE","MINT","DILL","PARSLEY","OREGANO","ROSEMARY","CHIVES","TARRAGON","CORIANDER","FENNEL"]},
  {"id":"waterways","clue":"Go with the flow","spangram":"WATERWAYS","words":["NILE","AMAZON","THAMES","DANUBE","RHINE","SEINE","GANGES","VOLGA","YANGTZE","TIGRIS","INDUS","MEKONG"]},
  {"id":"breakfast","clue":"Most important meal","spangram":"BREAKFAST","words":["TOAST","CEREAL","BACON","EGGS","PANCAKE","WAFFLE","MUFFIN","PORRIDGE","BAGEL","OMELET","GRANOLA","YOGURT"]},
  {"id":"footwear","clue":"Best foot forward","spangram":"FOOTWEAR","words":["BOOT","SANDAL","SNEAKER","LOAFER","SLIPPER","CLOG","MULE","PUMP","BROGUE","OXFORD","WEDGE","STILETTO"]},
  {"id":"winterwear","clue":"Bundle up","spangram":"WINTERWEAR","words":["SCARF","GLOVES","MITTENS","BEANIE","PARKA","SWEATER","BOOTS","EARMUFFS","JACKET","THERMALS","FLEECE","COAT"]},
  {"id":"pastashapes","clue":"That's amore","spangram":"PASTASHAPES","words":["PENNE","FUSILLI","RIGATONI","LINGUINE","ORZO","RAVIOLI","LASAGNA","GNOCCHI","FARFALLE","ZITI","SPAGHETTI","TORTELLI"]},
  {"id":"bakery","clue":"Rise to the occasion","spangram":"BAKERY","words":["BAGUETTE","BRIOCHE","CIABATTA","FOCACCIA","NAAN","PITA","SOURDOUGH","BAGEL","CROISSANT","CHALLAH","TORTILLA","ROLL"]},
  {"id":"constellations","clue":"Join the dots","spangram":"CONSTELLATIONS","words":["ORION","LYRA","DRACO","PERSEUS","CYGNUS","ARIES","VIRGO","TAURUS","GEMINI","PEGASUS","ANDROMEDA"]},
  {"id":"horoscope","clue":"Written in the stars","spangram":"HOROSCOPE","words":["ARIES","TAURUS","GEMINI","CANCER","VIRGO","LIBRA","SCORPIO","PISCES","CAPRICORN","AQUARIUS","ZODIAC"]},
  {"id":"transport","clue":"Get moving","spangram":"TRANSPORT","words":["TRAIN","PLANE","TRUCK","TRAM","FERRY","BICYCLE","SCOOTER","TAXI","CANOE","YACHT","SUBWAY","GONDOLA"]},
  {"id":"stationery","clue":"Desk job","spangram":"STATIONERY","words":["STAPLER","PENCIL","ERASER","BINDER","FOLDER","TAPE","RULER","MARKER","ENVELOPE","PAPERCLIP","STAMP","NOTEPAD"]},
  {"id":"wildcats","clue":"Big cats","spangram":"WILDCATS","words":["LION","TIGER","LEOPARD","JAGUAR","CHEETAH","PUMA","COUGAR","LYNX","OCELOT","SERVAL","PANTHER","BOBCAT"]},
  {"id":"nutcracker","clue":"Tough nuts to crack","spangram":"NUTCRACKER","words":["ALMOND","CASHEW","PECAN","WALNUT","HAZELNUT","PISTACHIO","PEANUT","MACADAMIA","CHESTNUT","ACORN","COCONUT","BRAZIL"]},
  {"id":"spicerack","clue":"Spice up your life","spangram":"SPICERACK","words":["CUMIN","PAPRIKA","NUTMEG","CLOVE","TURMERIC","GINGER","CINNAMON","SAFFRON","PEPPER","CARDAMOM","ANISE","MACE"]},
  {"id":"musicgenres","clue":"Turn it up","spangram":"MUSICGENRES","words":["JAZZ","BLUES","ROCK","PUNK","REGGAE","FOLK","DISCO","TECHNO","SOUL","FUNK","OPERA","COUNTRY"]},
  {"id":"composers","clue":"Classical gas","spangram":"COMPOSERS","words":["BACH","MOZART","HANDEL","CHOPIN","LISZT","HAYDN","VERDI","ELGAR","BRAHMS","WAGNER","RAVEL","DVORAK"]},
  {"id":"shakespeare","clue":"The Bard's players","spangram":"SHAKESPEARE","words":["HAMLET","OTHELLO","MACBETH","ROMEO","JULIET","PUCK","OBERON","PORTIA","VIOLA","IAGO","LEAR","YORICK"]},
  {"id":"greekgods","clue":"Mount Olympus","spangram":"GREEKGODS","words":["ZEUS","HERA","ATHENA","APOLLO","ARES","HERMES","POSEIDON","HADES","ARTEMIS","HESTIA","DEMETER","NIKE"]},
  {"id":"sewingkit","clue":"A stitch in time","spangram":"SEWINGKIT","words":["NEEDLE","THREAD","BUTTON","THIMBLE","BOBBIN","PINS","ZIPPER","RIBBON","SCISSORS","LACE","YARN","SEAM"]},
  {"id":"cocktails","clue":"Happy hour","spangram":"COCKTAILS","words":["MOJITO","MARTINI","NEGRONI","DAIQUIRI","MARGARITA","SIDECAR","GIMLET","SANGRIA","BELLINI","MIMOSA","COSMO","PALOMA"]},
  {"id":"watercraft","clue":"All aboard","spangram":"WATERCRAFT","words":["CANOE","KAYAK","YACHT","FERRY","BARGE","DINGHY","SCHOONER","TUGBOAT","LINER","RAFT","SLOOP","GALLEON"]},
  {"id":"teaparty","clue":"Time for tea","spangram":"TEAPARTY","words":["CHAI","OOLONG","MATCHA","SENCHA","ROOIBOS","ASSAM","EARLGREY","HERBAL","MINT","CHAMOMILE","KETTLE","SCONE"]},
  {"id":"headwear","clue":"Hats off","spangram":"HEADWEAR","words":["BERET","FEDORA","BOWLER","BEANIE","STETSON","TURBAN","BONNET","TRILBY","SOMBRERO","HELMET","VISOR","PANAMA"]},
  {"id":"sandwiches","clue":"Lunch box","spangram":"SANDWICHES","words":["CLUB","REUBEN","PANINI","HOAGIE","SUBMARINE","WRAP","GYRO","BURGER","HOTDOG","TOASTIE","BAGUETTE","CUBANO"]},
  {"id":"rodents","clue":"Small and furry","spangram":"RODENTS","words":["MOUSE","HAMSTER","GERBIL","BEAVER","SQUIRREL","CHIPMUNK","VOLE","CAPYBARA","PORCUPINE","MARMOT","LEMMING","DORMOUSE"]},
  {"id":"primates","clue":"Monkey business","spangram":"PRIMATES","words":["GORILLA","CHIMP","BABOON","LEMUR","GIBBON","MANDRILL","ORANGUTAN","MACAQUE","TAMARIN","MARMOSET","BONOBO","HOWLER"]},
  {"id":"deserts","clue":"Hot and dry","spangram":"DESERTS","words":["SAHARA","GOBI","MOJAVE","KALAHARI","ATACAMA","SONORAN","NAMIB","ARABIAN","SYRIAN","THAR","NEGEV","KAROO"]},
  {"id":"mountains","clue":"Peak performance","spangram":"MOUNTAINS","words":["EVEREST","DENALI","ELBRUS","FUJI","OLYMPUS","ETNA","ARARAT","ACONCAGUA","RAINIER","VESUVIUS","SNOWDON","MONTBLANC"]},
  {"id":"islands","clue":"No man is one","spangram":"ISLANDS","words":["HAWAII","BALI","CUBA","MALTA","SICILY","CRETE","IBIZA","JAVA","FIJI","TAHITI","CORSICA","ICELAND"]},
  {"id":"olympics","clue":"Going for gold","spangram":"OLYMPICS","words":["SPRINT","JAVELIN","HURDLES","DISCUS","ROWING","FENCING","BOXING","DIVING","ARCHERY","JUDO","SAILING","MARATHON"]},
  {"id":"pirateship","clue":"Yo ho ho","spangram":"PIRATESHIP","words":["PARROT","PLANK","CUTLASS","CANNON","TREASURE","MUTINY","ANCHOR","COMPASS","GALLEON","CAPTAIN","DOUBLOON","BOOTY"]},
  {"id":"fairytale","clue":"Once upon a time","spangram":"FAIRYTALE","words":["DRAGON","CASTLE","PRINCESS","WITCH","GIANT","TROLL","KNIGHT","GOBLIN","WIZARD","POTION","UNICORN","OGRE"]},
  {"id":"halloween","clue":"Trick or treat","spangram":"HALLOWEEN","words":["GHOST","PUMPKIN","WITCH","ZOMBIE","MUMMY","SKELETON","VAMPIRE","BROOM","CANDY","CAULDRON","SPIDER","COSTUME"]},
  {"id":"festive","clue":"Deck the halls","spangram":"FESTIVE","words":["TINSEL","WREATH","STOCKING","CANDLE","SNOWMAN","REINDEER","SLEIGH","HOLLY","BAUBLE","GARLAND","PRESENT","ANGEL"]},
  {"id":"seaside","clue":"Life's a beach","spangram":"SEASIDE","words":["SAND","WAVES","SHELL","TOWEL","BUCKET","SPADE","PIER","DUNE","SUNSCREEN","PARASOL","SEAGULL","SURF"]},
  {"id":"gardening","clue":"Green fingers","spangram":"GARDENING","words":["RAKE","TROWEL","SHEARS","COMPOST","SEEDS","HOSE","WEEDS","MULCH","SHED","BARROW","PRUNE","SPADE"]},
  {"id":"cooking","clue":"Cooking up a storm","spangram":"COOKING","words":["BAKE","BOIL","ROAST","GRILL","SAUTE","STEAM","POACH","BRAISE","STEW","SIMMER","BROIL","BLANCH","SEAR"]},
  {"id":"computer","clue":"Plugged in","spangram":"COMPUTER","words":["MOUSE","MONITOR","KEYBOARD","LAPTOP","SCREEN","CABLE","PRINTER","SPEAKER","WEBCAM","MODEM","ROUTER","CHARGER"]},
  {"id":"languages","clue":"Code words","spangram":"LANGUAGES","words":["PYTHON","JAVA","RUST","RUBY","PERL","SWIFT","KOTLIN","HASKELL","PASCAL","COBOL","FORTRAN","ERLANG"]},
  {"id":"theater","clue":"All the world's a stage","spangram":"THEATER","words":["STAGE","CURTAIN","ACTOR","SCRIPT","USHER","ENCORE","LOBBY","BALCONY","CHORUS","MATINEE","PROMPTER","WINGS"]},
  {"id":"bigtop","clue":"Roll up, roll up","spangram":"BIGTOP","words":["CLOWN","ACROBAT","JUGGLER","TRAPEZE","LION","TAMER","TIGHTROPE","STILTS","UNICYCLE","POPCORN","ELEPHANT"]},
  {"id":"fabrics","clue":"Material things","spangram":"FABRICS","words":["COTTON","SILK","WOOL","LINEN","DENIM","VELVET","SATIN","TWEED","CORDUROY","LACE","CHIFFON","FLANNEL"]},
  {"id":"furniture","clue":"Make yourself at home","spangram":"FURNITURE","words":["SOFA","CHAIR","TABLE","BENCH","STOOL","DRESSER","OTTOMAN","BOOKCASE","WARDROBE","DESK","CABINET","FUTON"]},
  {"id":"floorplan","clue":"Room to roam","spangram":"FLOORPLAN","words":["KITCHEN","BEDROOM","BATHROOM","ATTIC","CELLAR","PANTRY","LOUNGE","STUDY","GARAGE","HALLWAY","LARDER","PORCH"]},
  {"id":"fishmonger","clue":"Plenty more in the sea","spangram":"FISHMONGER","words":["SALMON","TROUT","TUNA","HADDOCK","MACKEREL","SARDINE","HALIBUT","PLAICE","HERRING","ANCHOVY","BASS","SOLE"]},
  {"id":"arithmetic","clue":"It all adds up","spangram":"ARITHMETIC","words":["PLUS","MINUS","DIVIDE","TIMES","EQUALS","TOTAL","FRACTION","DECIMAL","PERCENT","MULTIPLY","REMAINDER","SQUARE"]},
  {"id":"timekeeping","clue":"Time flies","spangram":"TIMEKEEPING","words":["SECOND","MINUTE","HOUR","WEEK","MONTH","YEAR","DECADE","CENTURY","EPOCH","MOMENT","FORTNIGHT","INSTANT"]},
  {"id":"calendar","clue":"Turn the page","spangram":"CALENDAR","words":["JANUARY","FEBRUARY","MARCH","APRIL","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"]},
  {"id":"emotions","clue":"In your feelings","spangram":"EMOTIONS","words":["ANGER","FEAR","PRIDE","ENVY","GRIEF","BLISS","SHAME","HOPE","LOVE","DREAD","SORROW","DELIGHT"]},
  {"id":"mystery","clue":"Whodunnit","spangram":"MYSTERY","words":["CLUE","SUSPECT","MOTIVE","ALIBI","WITNESS","DETECTIVE","CULPRIT","VICTIM","EVIDENCE","SLEUTH","MANSION","BUTLER"]},
  {"id":"medieval","clue":"Days of yore","spangram":"MEDIEVAL","words":["CASTLE","KNIGHT","MOAT","JOUST","SQUIRE","LANCE","ARMOR","PEASANT","TURRET","SHIELD","BANQUET","FEAST"]},
  {"id":"outerspace","clue":"The final frontier","spangram":"OUTERSPACE","words":["ROCKET","GALAXY","NEBULA","ORBIT","METEOR","ASTEROID","QUASAR","PULSAR","SATELLITE","COSMOS","ALIEN","STAR"]},
  {"id":"mushrooms","clue":"Fun guys","spangram":"MUSHROOMS","words":["SHIITAKE","PORCINI","OYSTER","ENOKI","MOREL","BUTTON","TRUFFLE","CREMINI","MAITAKE","BOLETE","CHESTNUT","PUFFBALL"]},
  {"id":"confection","clue":"Sweet tooth","spangram":"CONFECTION","words":["FUDGE","TOFFEE","CARAMEL","NOUGAT","LICORICE","TRUFFLE","LOLLIPOP","GUMDROP","BONBON","PRALINE","MARZIPAN","TAFFY"]},
  {"id":"condiments","clue":"Get saucy","spangram":"CONDIMENTS","words":["KETCHUP","MUSTARD","MAYO","RELISH","SALSA","PESTO","GRAVY","AIOLI","CHUTNEY","HUMMUS","TAHINI","SRIRACHA"]},
  {"id":"reptiles","clue":"Cold-blooded","spangram":"REPTILES","words":["PYTHON","COBRA","VIPER","ADDER","GECKO","IGUANA","TORTOISE","TURTLE","LIZARD","CHAMELEON","ALLIGATOR","CROCODILE"]},
  {"id":"nautical","clue":"Learn the ropes","spangram":"NAUTICAL","words":["PORT","STARBOARD","STERN","DECK","MAST","RUDDER","KEEL","HULL","GALLEY","ANCHOR","BRIDGE","CABIN"]},
  {"id":"toiletries","clue":"Clean up","spangram":"TOILETRIES","words":["SOAP","SHAMPOO","RAZOR","LOTION","SPONGE","FLOSS","COMB","TOWEL","PERFUME","DEODORANT","LOOFAH","BRUSH"]},
  {"id":"babyanimals","clue":"Little ones","spangram":"BABYANIMALS","words":["KITTEN","PUPPY","FOAL","CALF","LAMB","PIGLET","DUCKLING","TADPOLE","FAWN","CYGNET","GOSLING","JOEY"]},
  {"id":"funfair","clue":"Fun of the fair","spangram":"FUNFAIR","words":["CAROUSEL","DODGEMS","RIDES","PRIZES","POPCORN","TICKETS","COASTER","SLIDE","HOOPLA","BALLOONS","CANDY","TEACUPS"]},
  {"id":"tenniscourt","clue":"Game, set, match","spangram":"TENNISCOURT","words":["SERVE","VOLLEY","RACKET","LOVE","DEUCE","BASELINE","SMASH","RALLY","UMPIRE","FAULT","TIEBREAK","LINESMAN"]},
  {"id":"golfcourse","clue":"Fore!","spangram":"GOLFCOURSE","words":["BIRDIE","EAGLE","BOGEY","PUTTER","DRIVER","BUNKER","GREEN","FAIRWAY","CADDIE","IRON","WEDGE","HOLE"]},
  {"id":"notation","clue":"Note-worthy","spangram":"NOTATION","words":["TEMPO","FORTE","PIANO","LEGATO","STACCATO","CRESCENDO","TREBLE","BASS","CHORD","SHARP","FLAT","REST"]},
  {"id":"birdsofprey","clue":"Talons out","spangram":"BIRDSOFPREY","words":["EAGLE","HAWK","FALCON","OSPREY","KESTREL","CONDOR","VULTURE","HARRIER","BUZZARD","KITE","MERLIN","GOSHAWK"]},
  {"id":"icecream","clue":"We all scream","spangram":"ICECREAM","words":["VANILLA","CHOCOLATE","MINT","PISTACHIO","COOKIE","CARAMEL","COFFEE","MANGO","COCONUT","TOFFEE","RUMRAISIN","HAZELNUT"]},
  {"id":"appliances","clue":"Plug it in","spangram":"APPLIANCES","words":["TOASTER","KETTLE","BLENDER","OVEN","FRIDGE","FREEZER","MIXER","JUICER","MICROWAVE","GRILL","IRON","AIRFRYER"]},
  {"id":"pokernight","clue":"Know when to fold","spangram":"POKERNIGHT","words":["FLUSH","STRAIGHT","BLUFF","RAISE","CHECK","FOLD","ANTE","RIVER","TURN","CHIPS","DEALER","SHOWDOWN"]}
]
```

- [ ] **Step 4: Run tests and fix any invalid themes**

Run: `node --test tests/themes.test.js tests/generator.bulk.test.js`
Expected: PASS. (This data was pre-validated with a prototype of the generator during planning.) If a theme fails anyway, replace the offending word with a theme-appropriate word of 4–9 A–Z letters, or add more mid-length (5–7 letter) words if the theme cannot form enough subsets; re-run until all pass. The bulk test prints average/max ms — include them in the commit message body.

- [ ] **Step 5: Commit**

```bash
git add data/themes.json tests/themes.test.js tests/generator.bulk.test.js
git commit -m "feat: add ~100 themes with validation and bulk generator test"
```

---

### Task 5: Bonus-word dictionary

**Files:**
- Create: `tools/build-dictionary.mjs`, `data/words.txt` (generated)

**Interfaces:**
- Consumes: ENABLE word list (public domain) and the LDNOOBW English blocklist (CC BY 4.0), downloaded at build time only.
- Produces: `data/words.txt` — lowercase words, one per line, LF endings, length ≥ 4, `a–z` only, profanity removed. The app uppercases them at load time.

- [ ] **Step 1: Write the script** — `tools/build-dictionary.mjs`

```js
// Builds data/words.txt from ENABLE (public domain), minus a profanity blocklist.
// Run once with `npm run build:dictionary` and commit the output.
import { writeFileSync } from 'node:fs';

const ENABLE_URL = 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt';
const BLOCKLIST_URL =
  'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en';

async function fetchLines(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.text()).split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean);
}

const [words, blocked] = await Promise.all([fetchLines(ENABLE_URL), fetchLines(BLOCKLIST_URL)]);
const blockSet = new Set(blocked.filter((w) => /^[a-z]+$/.test(w)));
const isBlocked = (w) => blockSet.has(w) || (w.endsWith('s') && blockSet.has(w.slice(0, -1)));

const kept = words.filter((w) => /^[a-z]{4,}$/.test(w) && !isBlocked(w));
writeFileSync(new URL('../data/words.txt', import.meta.url), kept.join('\n') + '\n');
console.log(`wrote ${kept.length} words (${words.length - kept.length} removed)`);
```

- [ ] **Step 2: Run it**

Run: `npm run build:dictionary`
Expected: `wrote 16xxxx words (...)` — roughly 160–170k words, file about 1.7 MB.

- [ ] **Step 3: Spot-check**

Run: `node -e "const s=new Set(require('fs').readFileSync('data/words.txt','utf8').split('\n'));console.log(['whisk','ladle','cat','tongs'].map(w=>w+':'+s.has(w)).join(' '))"`
Expected: `whisk:true ladle:true cat:false tongs:true`

- [ ] **Step 4: Commit**

```bash
git add tools/build-dictionary.mjs data/words.txt
git commit -m "feat: bonus-word dictionary built from ENABLE"
```

---

### Task 6: Game state logic

**Files:**
- Create: `js/game.js`
- Test: `tests/game.test.js`

**Interfaces:**
- Consumes: `samePath` from `js/grid.js`; Puzzle shape from Task 3.
- Produces (`js/game.js`):
  - `MIN_WORD_LENGTH = 4`, `HINT_COST = 3`
  - GameState: `{ puzzleId: string, seed: number, themeId: string, found: {word: string, order: number}[], log: ('T'|'S'|'H')[], bonusWords: string[], hintsUsed: number, hintMeter: number, activeHint: {word: string, level: 1|2} | null, startedAt: number, completed: boolean }` (`log` records theme finds `T`, spangram `S` and hints `H` in order, for sharing)
  - `newGameState(puzzle, puzzleId: string, now?: number): GameState`
  - `wordFromPath(puzzle, path: number[]): string`
  - `isFound(state, word: string): boolean`
  - `foundCells(state, puzzle): Set<number>`
  - `submitWord(state, puzzle, path: number[], dictionary: Set<string> | null): { state, result: { type, word } }` where `type` ∈ `'theme' | 'spangram' | 'wrong-spot' | 'bonus' | 'already-found' | 'too-short' | 'not-a-word'`; dictionary entries are UPPERCASE
  - `canHint(state): boolean`
  - `useHint(state, puzzle): GameState`

- [ ] **Step 1: Write the failing test** — `tests/game.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGameState, wordFromPath, foundCells, submitWord, canHint, useHint, HINT_COST,
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
    seed: 1, themeId: 'pets', clue: 'Pets', grid,
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
    puzzleId: 'seed-1', seed: 1, themeId: 'pets', found: [], log: [], bonusWords: [],
    hintsUsed: 0, hintMeter: 0, activeHint: null, startedAt: 1000, completed: false,
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

test('theme word on the wrong path is not accepted', () => {
  const p = makePuzzle();
  const start = newGameState(p, 'x');
  const { state, result } = submitWord(start, p, [24, 25, 26, 27], DICT);
  assert.deepEqual(result, { type: 'wrong-spot', word: 'CATS' });
  assert.equal(state, start);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/game.test.js`
Expected: FAIL — cannot find module `js/game.js`

- [ ] **Step 3: Implement** — `js/game.js`

```js
import { samePath } from './grid.js';

export const MIN_WORD_LENGTH = 4;
export const HINT_COST = 3;

export function newGameState(puzzle, puzzleId, now = Date.now()) {
  return {
    puzzleId,
    seed: puzzle.seed,
    themeId: puzzle.themeId,
    found: [],
    log: [],
    bonusWords: [],
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

  if (answer && !isFound(state, word)) {
    if (!samePath(answer.path, path)) return { state, result: { type: 'wrong-spot', word } };
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

  if (word.length < MIN_WORD_LENGTH) return { state, result: { type: 'too-short', word } };
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
  return !state.completed && state.hintMeter >= HINT_COST && state.activeHint?.level !== 2;
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
    hintMeter: 0,
    log: [...state.log, 'H'],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/game.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add js/game.js tests/game.test.js
git commit -m "feat: game state transitions, bonus words and hints"
```

---

### Task 7: Storage, progress and stats

**Files:**
- Create: `js/storage.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: `dateKey` from `js/rng.js`; GameState from Task 6.
- Produces (`js/storage.js`) — every function takes an optional final `store` argument (a `localStorage`-like object) for tests; it defaults to `globalThis.localStorage` and all access is wrapped in try/catch:
  - `loadProgress(puzzleId, store?): GameState | null`
  - `saveProgress(state, store?): void` — keeps only the 30 most recent puzzles
  - Stats: `{ played, completed, totalHints, currentStreak, bestStreak, lastDailyDate: string | null }`
  - `loadStats(store?): Stats`, `saveStats(stats, store?): void`
  - `applyStart(stats): Stats`
  - `applyCompletion(stats, state, dailyDate: string | null): Stats`
  - `displayStreak(stats, today: string): number`
  - `previousDateKey(key: string): string`
  - `isFirstVisit(store?): boolean`, `markVisited(store?): void`

- [ ] **Step 1: Write the failing test** — `tests/storage.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadProgress, saveProgress, loadStats, saveStats, applyStart, applyCompletion,
  displayStreak, previousDateKey, isFirstVisit, markVisited,
} from '../js/storage.js';

class MemoryStore {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
const throwingStore = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
  removeItem() { throw new Error('blocked'); },
};

test('progress round-trips', () => {
  const store = new MemoryStore();
  const state = { puzzleId: 'daily-2026-10-08', found: [{ word: 'A', order: 1 }] };
  saveProgress(state, store);
  assert.deepEqual(loadProgress('daily-2026-10-08', store), state);
  assert.equal(loadProgress('missing', store), null);
});

test('only the 30 most recent puzzles are kept', () => {
  const store = new MemoryStore();
  for (let i = 1; i <= 35; i++) saveProgress({ puzzleId: `seed-${i}` }, store);
  assert.equal(loadProgress('seed-1', store), null);
  assert.equal(loadProgress('seed-5', store), null);
  assert.deepEqual(loadProgress('seed-6', store), { puzzleId: 'seed-6' });
  assert.deepEqual(loadProgress('seed-35', store), { puzzleId: 'seed-35' });
});

test('blocked storage never throws', () => {
  assert.doesNotThrow(() => saveProgress({ puzzleId: 'x' }, throwingStore));
  assert.equal(loadProgress('x', throwingStore), null);
  assert.equal(loadStats(throwingStore).played, 0);
  assert.equal(isFirstVisit(throwingStore), true);
});

test('stats defaults and round-trip', () => {
  const store = new MemoryStore();
  const empty = loadStats(store);
  assert.deepEqual(empty, {
    played: 0, completed: 0, totalHints: 0, currentStreak: 0, bestStreak: 0, lastDailyDate: null,
  });
  saveStats(applyStart(empty), store);
  assert.equal(loadStats(store).played, 1);
});

test('previousDateKey crosses month and year boundaries', () => {
  assert.equal(previousDateKey('2026-10-08'), '2026-10-07');
  assert.equal(previousDateKey('2026-03-01'), '2026-02-28');
  assert.equal(previousDateKey('2027-01-01'), '2026-12-31');
});

test('daily completions build a streak; random puzzles do not', () => {
  let s = loadStats(new MemoryStore());
  s = applyCompletion(s, { hintsUsed: 1 }, '2026-10-06');
  s = applyCompletion(s, { hintsUsed: 0 }, '2026-10-07');
  s = applyCompletion(s, { hintsUsed: 2 }, null);
  assert.equal(s.currentStreak, 2);
  assert.equal(s.bestStreak, 2);
  assert.equal(s.completed, 3);
  assert.equal(s.totalHints, 3);
  s = applyCompletion(s, { hintsUsed: 0 }, '2026-10-07'); // same day again
  assert.equal(s.currentStreak, 2);
  s = applyCompletion(s, { hintsUsed: 0 }, '2026-10-10'); // gap resets
  assert.equal(s.currentStreak, 1);
  assert.equal(s.bestStreak, 2);
});

test('displayStreak shows 0 once a day is missed', () => {
  const s = { currentStreak: 4, lastDailyDate: '2026-10-07' };
  assert.equal(displayStreak(s, '2026-10-07'), 4);
  assert.equal(displayStreak(s, '2026-10-08'), 4);
  assert.equal(displayStreak(s, '2026-10-09'), 0);
});

test('first visit flag', () => {
  const store = new MemoryStore();
  assert.equal(isFirstVisit(store), true);
  markVisited(store);
  assert.equal(isFirstVisit(store), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/storage.test.js`
Expected: FAIL — cannot find module `js/storage.js`

- [ ] **Step 3: Implement** — `js/storage.js`

```js
import { dateKey } from './rng.js';

const PREFIX = 'unstranded:';
const MAX_SAVED = 30;

function defaultStore() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(key, fallback, store) {
  try {
    const raw = store?.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value, store) {
  try {
    store?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: play continues without persistence.
  }
}

function remove(key, store) {
  try {
    store?.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

export function loadProgress(puzzleId, store = defaultStore()) {
  return read(`progress:${puzzleId}`, null, store);
}

export function saveProgress(state, store = defaultStore()) {
  write(`progress:${state.puzzleId}`, state, store);
  const recent = read('recent', [], store).filter((id) => id !== state.puzzleId);
  recent.unshift(state.puzzleId);
  for (const old of recent.splice(MAX_SAVED)) remove(`progress:${old}`, store);
  write('recent', recent, store);
}

const EMPTY_STATS = {
  played: 0, completed: 0, totalHints: 0, currentStreak: 0, bestStreak: 0, lastDailyDate: null,
};

export function loadStats(store = defaultStore()) {
  return { ...EMPTY_STATS, ...read('stats', {}, store) };
}

export function saveStats(stats, store = defaultStore()) {
  write('stats', stats, store);
}

export function applyStart(stats) {
  return { ...stats, played: stats.played + 1 };
}

export function previousDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d - 1));
}

export function applyCompletion(stats, state, dailyDate) {
  const next = {
    ...stats,
    completed: stats.completed + 1,
    totalHints: stats.totalHints + state.hintsUsed,
  };
  if (dailyDate && stats.lastDailyDate !== dailyDate) {
    next.currentStreak = stats.lastDailyDate === previousDateKey(dailyDate) ? stats.currentStreak + 1 : 1;
    next.bestStreak = Math.max(stats.bestStreak, next.currentStreak);
    next.lastDailyDate = dailyDate;
  }
  return next;
}

export function displayStreak(stats, today) {
  const live = stats.lastDailyDate === today || stats.lastDailyDate === previousDateKey(today);
  return live ? stats.currentStreak : 0;
}

export function isFirstVisit(store = defaultStore()) {
  return !read('visited', false, store);
}

export function markVisited(store = defaultStore()) {
  write('visited', true, store);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/storage.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add js/storage.js tests/storage.test.js
git commit -m "feat: local progress, stats and streaks"
```

---

### Task 8: Share text

**Files:**
- Create: `js/share.js`
- Test: `tests/share.test.js`

**Interfaces:**
- Consumes: GameState (`log`) from Task 6; Puzzle (`clue`) from Task 3.
- Produces (`js/share.js`):
  - `buildShareText({ state, puzzle, label: string, url: string | null }): string`
  - `shareText(text: string, nav?: Navigator): Promise<'shared' | 'copied' | 'cancelled' | 'failed'>`

- [ ] **Step 1: Write the failing test** — `tests/share.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShareText, shareText } from '../js/share.js';

const puzzle = { clue: 'Drawer full of tools' };

test('daily share text', () => {
  const state = { log: ['T', 'T', 'H', 'T', 'S', 'T', 'T'] };
  assert.equal(
    buildShareText({ state, puzzle, label: '2026-10-08', url: null }),
    'UnStranded #2026-10-08\n"Drawer full of tools"\n🔵🔵💡🔵\n🟡🔵🔵',
  );
});

test('random share text includes the link', () => {
  const state = { log: ['S', 'T'] };
  assert.equal(
    buildShareText({ state, puzzle, label: '12345', url: 'https://x.test/?p=12345' }),
    'UnStranded #12345\n"Drawer full of tools"\n🟡🔵\nhttps://x.test/?p=12345',
  );
});

test('shareText prefers the native share sheet', async () => {
  let shared = null;
  const nav = { share: async (data) => { shared = data; }, clipboard: { writeText: async () => {} } };
  assert.equal(await shareText('hi', nav), 'shared');
  assert.deepEqual(shared, { text: 'hi' });
});

test('shareText falls back to the clipboard', async () => {
  let copied = null;
  const nav = { clipboard: { writeText: async (t) => { copied = t; } } };
  assert.equal(await shareText('hi', nav), 'copied');
  assert.equal(copied, 'hi');
});

test('shareText reports a cancelled share sheet', async () => {
  const nav = { share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } };
  assert.equal(await shareText('hi', nav), 'cancelled');
});

test('shareText falls back to clipboard when share fails, else reports failure', async () => {
  const failingShare = async () => { throw new Error('nope'); };
  let copied = null;
  assert.equal(await shareText('hi', { share: failingShare, clipboard: { writeText: async (t) => { copied = t; } } }), 'copied');
  assert.equal(copied, 'hi');
  assert.equal(await shareText('hi', { share: failingShare }), 'failed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/share.test.js`
Expected: FAIL — cannot find module `js/share.js`

- [ ] **Step 3: Implement** — `js/share.js`

```js
const EMOJI = { T: '🔵', S: '🟡', H: '💡' };
const PER_LINE = 4;

export function buildShareText({ state, puzzle, label, url }) {
  const emojis = state.log.map((entry) => EMOJI[entry]);
  const lines = [];
  for (let i = 0; i < emojis.length; i += PER_LINE) lines.push(emojis.slice(i, i + PER_LINE).join(''));
  return [`UnStranded #${label}`, `"${puzzle.clue}"`, ...lines, ...(url ? [url] : [])].join('\n');
}

export async function shareText(text, nav = globalThis.navigator) {
  if (nav?.share) {
    try {
      await nav.share({ text });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await nav.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/share.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add js/share.js tests/share.test.js
git commit -m "feat: emoji share summary with share sheet and clipboard"
```

---

### Task 9: Selection input

**Files:**
- Create: `js/input.js`
- Test: `tests/input.test.js`

**Interfaces:**
- Consumes: `isAdjacent` from `js/grid.js`.
- Produces (`js/input.js`):
  - `stepTap(path: number[], cell: number, isSelectable: (i) => boolean): number[]` — pure
  - `stepDrag(path: number[], cell: number, isSelectable): number[]` — pure; returns the same array instance when nothing changes
  - `createSelection({ gridEl: HTMLElement, isSelectable, onChange: (path) => void, onSubmit: (path) => void }): { clear(): void, readonly path: number[] }` — DOM controller; tiles are `.tile` elements with `data-index`

**Behaviour:** drag (press, move through adjacent letters, release to submit; moving back onto the previous letter undoes a step) and tap (tap letters one by one; tap the last letter again to submit; tapping a letter already in the path truncates to it; tapping a non-adjacent letter starts over). During a drag, a cell only registers when the pointer is within the inner 42% radius of the tile, so diagonal moves don't clip neighbouring tiles.

- [ ] **Step 1: Write the failing test** — `tests/input.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepTap, stepDrag } from '../js/input.js';

const all = () => true;
const not = (blocked) => (i) => !blocked.includes(i);

test('stepTap starts, extends, truncates and restarts', () => {
  assert.deepEqual(stepTap([], 0, all), [0]);
  assert.deepEqual(stepTap([0], 7, all), [0, 7]);
  assert.deepEqual(stepTap([0, 7, 14], 7, all), [0, 7]);
  assert.deepEqual(stepTap([0, 7], 20, all), [20]);
  assert.deepEqual(stepTap([0, 7], 8, not([8])), []);
});

test('stepDrag extends only to adjacent selectable cells', () => {
  assert.deepEqual(stepDrag([0], 1, all), [0, 1]);
  const path = [0, 1];
  assert.equal(stepDrag(path, 3, all), path);        // not adjacent: unchanged
  assert.equal(stepDrag(path, 2, not([2])), path);   // blocked: unchanged
  assert.equal(stepDrag(path, 1, all), path);        // already last: unchanged
});

test('stepDrag backtracks onto the previous cell', () => {
  assert.deepEqual(stepDrag([0, 1, 2], 1, all), [0, 1]);
});

test('stepDrag ignores cells earlier in the path', () => {
  const path = [0, 1, 7, 6];
  assert.equal(stepDrag(path, 0, all), path);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/input.test.js`
Expected: FAIL — cannot find module `js/input.js`

- [ ] **Step 3: Implement** — `js/input.js`

```js
import { isAdjacent } from './grid.js';

const HIT_RADIUS = 0.42; // fraction of tile width that counts as "on" a tile while dragging

export function stepTap(path, cell, isSelectable) {
  if (!isSelectable(cell)) return [];
  const at = path.indexOf(cell);
  if (at >= 0) return path.slice(0, at + 1);
  if (path.length && isAdjacent(path[path.length - 1], cell)) return [...path, cell];
  return [cell];
}

export function stepDrag(path, cell, isSelectable) {
  if (path.length >= 2 && cell === path[path.length - 2]) return path.slice(0, -1);
  if (path.includes(cell) || !isSelectable(cell)) return path;
  if (path.length && isAdjacent(path[path.length - 1], cell)) return [...path, cell];
  return path;
}

export function createSelection({ gridEl, isSelectable, onChange, onSubmit }) {
  let path = [];
  let pressed = false;
  let dragged = false;
  let pendingSubmit = false;

  const set = (next) => {
    path = next;
    onChange(path);
  };

  const submit = () => {
    const submitted = path;
    set([]);
    if (submitted.length > 1) onSubmit(submitted);
  };

  const cellAt = (x, y) => {
    const el = document.elementFromPoint(x, y)?.closest('.tile');
    if (!el || !gridEl.contains(el)) return null;
    const rect = el.getBoundingClientRect();
    const dx = x - (rect.left + rect.width / 2);
    const dy = y - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) > rect.width * HIT_RADIUS) return null;
    return Number(el.dataset.index);
  };

  gridEl.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.tile');
    if (!el) return;
    e.preventDefault();
    const cell = Number(el.dataset.index);
    if (!isSelectable(cell)) {
      set([]);
      return;
    }
    pressed = true;
    dragged = false;
    pendingSubmit = path.length > 0 && cell === path[path.length - 1];
    if (!pendingSubmit) set(stepTap(path, cell, isSelectable));
    gridEl.setPointerCapture?.(e.pointerId);
  });

  gridEl.addEventListener('pointermove', (e) => {
    if (!pressed) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (cell === null || cell === path[path.length - 1]) return;
    const next = stepDrag(path, cell, isSelectable);
    if (next !== path) {
      dragged = true;
      pendingSubmit = false;
      set(next);
    }
  });

  gridEl.addEventListener('pointerup', () => {
    if (!pressed) return;
    pressed = false;
    if (dragged || pendingSubmit) submit();
    pendingSubmit = false;
  });

  gridEl.addEventListener('pointercancel', () => {
    pressed = false;
    pendingSubmit = false;
  });

  return {
    clear: () => set([]),
    get path() {
      return path;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/input.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add js/input.js tests/input.test.js
git commit -m "feat: drag and tap selection input"
```

---

### Task 10: Page, styles, rendering and app wiring

**Files:**
- Create: `index.html`, `css/style.css`, `js/render.js`, `js/main.js`, `tools/serve.mjs`, `.claude/launch.json`

**Interfaces:**
- Consumes: everything above — `buildPuzzle` (generator); `newGameState, submitWord, useHint, canHint, foundCells, HINT_COST` (game); `dailySeed, dateKey, randomSeed` (rng); `createSelection` (input); `loadProgress, saveProgress, loadStats, saveStats, applyStart, applyCompletion, displayStreak, isFirstVisit, markVisited` (storage); `buildShareText, shareText` (share); `COLS, ROWS, CELLS, rowOf, colOf` (grid).
- Produces (`js/render.js`):
  - `createBoard(container: HTMLElement): { gridEl, svg, tiles: HTMLElement[] }`
  - `renderBoard(board, { puzzle, state, selection: number[] }): void`

- [ ] **Step 1: Dev server** — `tools/serve.mjs`

```js
// Zero-dependency static server for local development: `npm run serve`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^([/\\])+/, '');
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => console.log(`UnStranded at http://localhost:${PORT}`));
```

`.claude/launch.json`:
```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "unstranded", "runtimeExecutable": "node", "runtimeArgs": ["tools/serve.mjs"], "port": 8080 }
  ]
}
```

- [ ] **Step 2: Page shell** — `index.html`

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="description" content="An unlimited Strands-style word search. A shared daily puzzle, then as many more as you like.">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#121212" media="(prefers-color-scheme: dark)">
  <title>UnStranded</title>
  <link rel="stylesheet" href="css/style.css">
  <script type="module" src="js/main.js"></script>
</head>
<body>
  <header class="topbar">
    <button id="stats-btn" class="icon-btn" type="button" aria-label="Statistics">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7" /></svg>
    </button>
    <h1>UnStranded</h1>
    <button id="help-btn" class="icon-btn" type="button" aria-label="How to play">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01" /></svg>
    </button>
  </header>

  <main>
    <section class="theme-card">
      <p id="theme-label" class="theme-label">TODAY'S THEME</p>
      <p id="clue" class="clue">&nbsp;</p>
    </section>

    <p id="current" class="current" aria-live="polite"></p>

    <div id="grid" class="grid" aria-label="Letter grid"></div>

    <p class="progress"><b id="found-count">0</b> of <b id="total-count">0</b> theme words found</p>
    <p id="notice" class="notice" hidden>Word list unavailable, so hints are turned off.</p>

    <div class="actions">
      <button id="hint-btn" class="btn hint-btn" type="button" disabled>Hint</button>
      <button id="new-btn" class="btn" type="button">New puzzle</button>
      <button id="share-btn" class="btn primary" type="button" hidden>Share</button>
    </div>
  </main>

  <div id="fatal" class="fatal" hidden>
    <p>Couldn't load the puzzles.</p>
    <button id="retry-btn" class="btn primary" type="button">Retry</button>
  </div>

  <dialog id="results-dialog">
    <h2>Puzzle solved!</h2>
    <pre id="results-summary" class="summary"></pre>
    <div class="actions">
      <button id="results-share" class="btn primary" type="button">Share</button>
      <button id="results-new" class="btn" type="button">Play another</button>
    </div>
    <form method="dialog" class="close-row"><button class="link-btn">Close</button></form>
  </dialog>

  <dialog id="stats-dialog">
    <h2>Statistics</h2>
    <dl id="stats-list" class="stats"></dl>
    <form method="dialog" class="close-row"><button class="btn">Close</button></form>
  </dialog>

  <dialog id="help-dialog">
    <h2>How to play</h2>
    <ul class="help">
      <li>Find the theme words hidden in the grid. The clue tells you what they have in common.</li>
      <li>Drag through letters, or tap them one at a time and tap the last letter again to submit. Letters can connect in any direction, including diagonally.</li>
      <li>Theme words turn <span class="chip theme">blue</span>. The <span class="chip spangram">spangram</span> names the theme and stretches from one side of the board to the other.</li>
      <li>Every letter is used exactly once.</li>
      <li>Find 3 other words of 4+ letters to earn a hint.</li>
      <li>The first puzzle each day is the same for everyone. After that, press <b>New puzzle</b> for as many as you like.</li>
    </ul>
    <form method="dialog" class="close-row"><button class="btn primary">Let's play</button></form>
  </dialog>
</body>
</html>
```

- [ ] **Step 3: Styles** — `css/style.css`

```css
:root {
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #6b6b6b;
  --card: #f2f1ec;
  --rule: #dddcd6;
  --theme: #aedfee;
  --spangram: #f8cd05;
  --selected: #dbd8c5;
  --hint: #1a1a1a;
  --accent: #1a1a1a;
  --accent-fg: #ffffff;
  --shadow: rgba(0, 0, 0, 0.3);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121212;
    --fg: #f1f1f1;
    --muted: #a3a3a3;
    --card: #1f1f1f;
    --rule: #333333;
    --theme: #3d7f96;
    --spangram: #b8940a;
    --selected: #57534a;
    --hint: #f1f1f1;
    --accent: #f1f1f1;
    --accent-fg: #121212;
    --shadow: rgba(0, 0, 0, 0.6);
  }
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }

html, body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

body {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: env(safe-area-inset-top) 16px env(safe-area-inset-bottom);
}

.topbar {
  width: 100%;
  max-width: 420px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--rule);
}

h1 { margin: 0; font-size: 1.25rem; letter-spacing: 0.02em; }

.icon-btn {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--fg);
  cursor: pointer;
}
.icon-btn svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }

main {
  width: min(92vw, 420px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 10px 0 16px;
}

.theme-card {
  width: 100%;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--card);
  text-align: center;
}
.theme-label { margin: 0; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.12em; color: var(--muted); }
.clue { margin: 2px 0 0; font-size: 1.15rem; font-weight: 700; }

.current {
  margin: 0;
  min-height: 1.6em;
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-align: center;
}
.current.message { font-size: 1rem; letter-spacing: normal; color: var(--muted); }

/* Grid has no gap so SVG line coordinates (col + 0.5, row + 0.5) land on tile centres. */
.grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  grid-template-rows: repeat(8, 1fr);
  width: 100%; /* fallback for browsers without dvh */
  width: min(100%, calc((100dvh - 300px) * 0.75));
  min-width: 240px;
  aspect-ratio: 6 / 8;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.line { fill: none; stroke-width: 0.24; stroke-linecap: round; stroke-linejoin: round; }
.line.theme { stroke: var(--theme); }
.line.spangram { stroke: var(--spangram); }
.line.selected { stroke: var(--selected); }
.line.hint { stroke: var(--hint); stroke-width: 0.05; stroke-dasharray: 0.14 0.1; }

.tile {
  position: relative;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.tile span {
  width: 78%;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: clamp(1rem, 5.2vw, 1.45rem);
  font-weight: 600;
  transition: background-color 0.12s;
}
.tile.selected span { background: var(--selected); }
.tile.found { cursor: default; }
.tile.found.theme span { background: var(--theme); }
.tile.found.spangram span { background: var(--spangram); }
.tile.hinted span { outline: 2px dashed var(--hint); outline-offset: -2px; }
.tile.hint-start span { outline-style: solid; }

.grid.shake { animation: shake 0.3s; }
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  75% { transform: translateX(6px); }
}

.progress { margin: 0; color: var(--muted); }
.progress b { color: var(--fg); }
.notice { margin: 0; font-size: 0.8rem; color: var(--muted); text-align: center; }

.actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }

.btn {
  min-height: 44px;
  padding: 0 20px;
  border: 1.5px solid var(--fg);
  border-radius: 999px;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn:disabled { cursor: default; }

.hint-btn {
  background: linear-gradient(to right, var(--selected) calc(var(--meter, 0) * 100%), var(--bg) 0);
}
.hint-btn:disabled { color: var(--muted); border-color: var(--rule); }

.link-btn { border: 0; background: none; color: var(--muted); font: inherit; text-decoration: underline; cursor: pointer; padding: 8px; }

dialog {
  width: min(92vw, 380px);
  padding: 20px;
  border: 0;
  border-radius: 16px;
  background: var(--bg);
  color: var(--fg);
  box-shadow: 0 10px 40px var(--shadow);
}
dialog::backdrop { background: rgba(0, 0, 0, 0.45); }
dialog h2 { margin: 0 0 12px; text-align: center; }
.close-row { display: flex; justify-content: center; margin: 12px 0 0; }

.summary {
  margin: 0 0 14px;
  padding: 12px;
  border-radius: 8px;
  background: var(--card);
  font-family: inherit;
  font-size: 1.05rem;
  line-height: 1.5;
  text-align: center;
  white-space: pre-wrap;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(64px, 1fr));
  gap: 8px;
  margin: 0;
  text-align: center;
}
.stats div { display: flex; flex-direction: column-reverse; }
.stats dd { margin: 0; font-size: 1.6rem; font-weight: 700; }
.stats dt { font-size: 0.75rem; color: var(--muted); }

.help { margin: 0; padding-left: 1.2em; line-height: 1.45; }
.help li + li { margin-top: 6px; }
.chip { padding: 0 6px; border-radius: 999px; color: #1a1a1a; }
.chip.theme { background: var(--theme); }
.chip.spangram { background: var(--spangram); }

.fatal {
  position: fixed;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 12px;
  background: var(--bg);
  text-align: center;
}
```

- [ ] **Step 4: Board rendering** — `js/render.js`

```js
import { COLS, ROWS, CELLS, rowOf, colOf } from './grid.js';
import { isFound } from './game.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createBoard(container) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'lines');
  svg.setAttribute('viewBox', `0 0 ${COLS} ${ROWS}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const tiles = [];
  for (let i = 0; i < CELLS; i++) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.index = String(i);
    tile.append(document.createElement('span'));
    tiles.push(tile);
  }
  container.replaceChildren(svg, ...tiles);
  return { gridEl: container, svg, tiles };
}

function polyline(path, className) {
  const el = document.createElementNS(SVG_NS, 'polyline');
  el.setAttribute('points', path.map((i) => `${colOf(i) + 0.5},${rowOf(i) + 0.5}`).join(' '));
  el.setAttribute('class', className);
  return el;
}

export function renderBoard(board, { puzzle, state, selection }) {
  const kind = new Map();
  const foundAnswers = puzzle.answers.filter((a) => isFound(state, a.word));
  for (const a of foundAnswers) {
    for (const cell of a.path) kind.set(cell, a.isSpangram ? 'spangram' : 'theme');
  }
  const hint = state.activeHint ? puzzle.answers.find((a) => a.word === state.activeHint.word) : null;
  const hinted = new Set(hint ? hint.path : []);
  const showOrder = state.activeHint?.level === 2;
  const selected = new Set(selection);

  board.tiles.forEach((tile, i) => {
    tile.firstChild.textContent = puzzle.grid[i];
    const classes = ['tile'];
    if (kind.has(i)) classes.push('found', kind.get(i));
    if (selected.has(i)) classes.push('selected');
    if (hinted.has(i) && !kind.has(i)) classes.push('hinted');
    if (showOrder && hint.path[0] === i) classes.push('hint-start');
    tile.className = classes.join(' ');
  });

  const lines = foundAnswers.map((a) => polyline(a.path, `line ${a.isSpangram ? 'spangram' : 'theme'}`));
  if (hint && showOrder) lines.push(polyline(hint.path, 'line hint'));
  if (selection.length > 1) lines.push(polyline(selection, 'line selected'));
  board.svg.replaceChildren(...lines);
}
```

- [ ] **Step 5: App wiring** — `js/main.js`

```js
import { buildPuzzle } from './generator.js';
import { newGameState, submitWord, useHint, canHint, foundCells, HINT_COST } from './game.js';
import { dailySeed, dateKey, randomSeed } from './rng.js';
import { createBoard, renderBoard } from './render.js';
import { createSelection } from './input.js';
import {
  loadProgress, saveProgress, loadStats, saveStats, applyStart, applyCompletion,
  displayStreak, isFirstVisit, markVisited,
} from './storage.js';
import { buildShareText, shareText } from './share.js';

const $ = (id) => document.getElementById(id);

const MESSAGES = {
  spangram: 'SPANGRAM!',
  'wrong-spot': 'Right word, wrong spot!',
  'already-found': 'Already found',
  'too-short': 'Too short',
  'not-a-word': 'Not in word list',
};
const SHAKE_ON = new Set(['wrong-spot', 'already-found', 'too-short', 'not-a-word']);
const MESSAGE_MS = 1800;

const app = {
  themes: [],
  dictionary: null,
  puzzle: null,
  state: null,
  isDaily: false,
  today: dateKey(),
  selection: [],
  message: '',
  board: null,
  selector: null,
};

let messageTimer = 0;

function render() {
  const { puzzle, state } = app;
  if (!puzzle) return;
  renderBoard(app.board, { puzzle, state, selection: app.selection });
  $('theme-label').textContent = app.isDaily ? "TODAY'S THEME" : `PUZZLE #${puzzle.seed}`;
  $('clue').textContent = puzzle.clue;

  const current = $('current');
  const showMessage = app.selection.length === 0 && Boolean(app.message);
  current.textContent = showMessage ? app.message : app.selection.map((i) => puzzle.grid[i]).join('');
  current.classList.toggle('message', showMessage);

  $('found-count').textContent = String(state.found.length);
  $('total-count').textContent = String(puzzle.answers.length);

  const hintBtn = $('hint-btn');
  hintBtn.disabled = !canHint(state);
  hintBtn.style.setProperty('--meter', String(Math.min(state.hintMeter, HINT_COST) / HINT_COST));
  $('share-btn').hidden = !state.completed;
}

function flashMessage(text) {
  app.message = text;
  render();
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    app.message = '';
    render();
  }, MESSAGE_MS);
}

function shake() {
  const grid = $('grid');
  grid.classList.remove('shake');
  void grid.offsetWidth; // restart the animation
  grid.classList.add('shake');
}

function onSubmit(path) {
  const wasCompleted = app.state.completed;
  const { state, result } = submitWord(app.state, app.puzzle, path, app.dictionary);
  app.state = state;
  saveProgress(state);
  if (SHAKE_ON.has(result.type)) shake();
  if (result.type === 'bonus') flashMessage(`Bonus word! (${state.hintMeter}/${HINT_COST} toward a hint)`);
  else if (MESSAGES[result.type]) flashMessage(MESSAGES[result.type]);
  else render();

  if (state.completed && !wasCompleted) {
    saveStats(applyCompletion(loadStats(), state, app.isDaily ? app.today : null));
    setTimeout(showResults, 600);
  }
}

function onHint() {
  app.state = useHint(app.state, app.puzzle);
  saveProgress(app.state);
  render();
}

function currentShareText() {
  const label = app.isDaily ? app.today : String(app.puzzle.seed);
  const url = app.isDaily ? null : `${location.origin}${location.pathname}?p=${app.puzzle.seed}`;
  return buildShareText({ state: app.state, puzzle: app.puzzle, label, url });
}

async function doShare(button) {
  const outcome = await shareText(currentShareText());
  const labels = { copied: 'Copied!', failed: "Couldn't share" };
  if (!labels[outcome]) return;
  const original = button.textContent;
  button.textContent = labels[outcome];
  setTimeout(() => { button.textContent = original; }, 1500);
}

function showResults() {
  $('results-summary').textContent = currentShareText();
  const dialog = $('results-dialog');
  if (!dialog.open) dialog.showModal();
}

function showStats() {
  const s = loadStats();
  const avg = s.completed ? (s.totalHints / s.completed).toFixed(1) : '0';
  const items = [
    ['Played', s.played],
    ['Solved', s.completed],
    ['Streak', displayStreak(s, app.today)],
    ['Best streak', s.bestStreak],
    ['Avg hints', avg],
  ];
  $('stats-list').replaceChildren(...items.map(([label, value]) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = String(value);
    row.append(dt, dd);
    return row;
  }));
  $('stats-dialog').showModal();
}

function showFatal() {
  $('fatal').hidden = false;
}

function startPuzzle(seed, isDaily) {
  try {
    app.puzzle = buildPuzzle(app.themes, seed);
  } catch {
    showFatal();
    return;
  }
  app.isDaily = isDaily;
  const puzzleId = isDaily ? `daily-${app.today}` : `seed-${seed}`;
  let state = loadProgress(puzzleId);
  // Discard saved progress if themes.json changed underneath it.
  if (!state || state.seed !== seed || state.themeId !== app.puzzle.themeId) {
    state = newGameState(app.puzzle, puzzleId);
    saveStats(applyStart(loadStats()));
    saveProgress(state);
  }
  app.state = state;
  app.message = '';
  app.selector.clear();
  render();
  if (state.completed) showResults();
}

function newPuzzle() {
  const seed = randomSeed();
  history.replaceState(null, '', `?p=${seed}`);
  startPuzzle(seed, false);
}

function parseSeedParam() {
  const raw = new URLSearchParams(location.search).get('p');
  if (!raw || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 0xffffffff ? n : null;
}

async function loadDictionary() {
  try {
    const res = await fetch('data/words.txt');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    app.dictionary = new Set(text.split('\n').map((w) => w.trim().toUpperCase()).filter(Boolean));
  } catch {
    $('notice').hidden = false;
  }
}

async function init() {
  app.board = createBoard($('grid'));
  app.selector = createSelection({
    gridEl: $('grid'),
    isSelectable: (i) => Boolean(app.state) && !foundCells(app.state, app.puzzle).has(i),
    onChange: (path) => {
      app.selection = path;
      if (path.length) app.message = '';
      render();
    },
    onSubmit,
  });

  $('hint-btn').addEventListener('click', onHint);
  $('new-btn').addEventListener('click', newPuzzle);
  $('share-btn').addEventListener('click', (e) => doShare(e.currentTarget));
  $('results-share').addEventListener('click', (e) => doShare(e.currentTarget));
  $('results-new').addEventListener('click', () => {
    $('results-dialog').close();
    newPuzzle();
  });
  $('stats-btn').addEventListener('click', showStats);
  $('help-btn').addEventListener('click', () => $('help-dialog').showModal());
  $('retry-btn').addEventListener('click', () => location.reload());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') app.selector.clear();
  });

  try {
    const res = await fetch('data/themes.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    app.themes = await res.json();
  } catch {
    showFatal();
    return;
  }

  const seed = parseSeedParam();
  if (seed === null) {
    if (new URLSearchParams(location.search).has('p')) history.replaceState(null, '', location.pathname);
    startPuzzle(dailySeed(), true);
  } else {
    startPuzzle(seed, false);
  }

  if (isFirstVisit()) {
    markVisited();
    $('help-dialog').showModal();
  }
  loadDictionary();
}

init();
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all test files PASS (DOM modules are not imported by tests).

- [ ] **Step 7: Manual check on desktop**

Start the dev server (`preview_start` with name `unstranded`, or `npm run serve`) and open `http://localhost:8080`. Verify:
1. Help dialog appears on first visit; "Let's play" closes it.
2. Theme card shows "TODAY'S THEME" and a clue; a 6×8 grid of letters renders.
3. Dragging across letters highlights them with a connecting line; releasing on a theme word turns it blue (spangram yellow) and updates "N of M".
4. Tap mode: tap letters one at a time, tap the last letter again to submit.
5. A theme word traced on a different path shows "Right word, wrong spot!" and shakes.
6. Three bonus words enable Hint; first press outlines a word, second press (after 3 more) shows its order.
7. Reload mid-puzzle → progress is restored.
8. New puzzle → URL gets `?p=<seed>`, label shows `PUZZLE #<seed>`; reloading that URL gives the same board.
9. Solve a puzzle → results dialog with emoji summary; Share copies text ("Copied!").
10. Stats dialog shows played/solved/streak.
11. Console has no errors.

- [ ] **Step 8: Manual check on mobile**

Use the browser's mobile emulation (375×812, touch) or a real phone on the same network (`http://<pc-ip>:8080`). Verify: dragging does not scroll or zoom the page; tapping works; the theme card, grid, progress and buttons all fit without scrolling; text is legible; dark mode looks correct (toggle system theme).

- [ ] **Step 9: Commit**

```bash
git add index.html css/style.css js/render.js js/main.js tools/serve.mjs .claude/launch.json
git commit -m "feat: playable UI with board rendering, dialogs and app wiring"
```

---

### Task 11: README and deployment check

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the finished app.
- Produces: documentation only.

- [ ] **Step 1: Write** `README.md`

```markdown
# UnStranded

An unlimited Strands-style word search that runs entirely in the browser.

- **Daily puzzle:** the first puzzle each day is the same for everyone.
- **Unlimited puzzles:** press **New puzzle** for a fresh board. Every board has a link (`?p=<seed>`) you can share.
- Works on phones and desktops. No accounts, no tracking. Progress and stats are stored in your browser.

## Play locally

ES modules need to be served over HTTP (opening `index.html` directly won't work):

    npm run serve

Then open http://localhost:8080.

## Tests

    npm test

Uses Node 22+'s built-in test runner. No dependencies to install.

## Adding themes

Edit `data/themes.json`. Each theme needs:

- `id`: unique, lowercase
- `clue`: the hint shown above the grid
- `spangram`: 6–14 letters, A–Z only (join multiple words: `PIZZATOPPINGS`)
- `words`: at least 10 words, 4–9 letters each, A–Z only

Run `npm test` afterwards. The theme tests check that every theme can fill the 48-letter board.

Note: changing `themes.json` changes which board a given seed or date produces.

## Deploy

**GitHub Pages:** push the repository, then in *Settings → Pages* choose "Deploy from a branch", branch `main`, folder `/ (root)`.

**itch.io:** zip the project folder contents (`index.html` must be at the top level of the zip), create a new project with *Kind of project: HTML*, upload the zip and tick "This file will be played in the browser". A viewport of 420 × 820 works well, and enable "Mobile friendly".

## Credits

- Bonus-word dictionary: [ENABLE](https://github.com/dolph/dictionary) word list (public domain), filtered with the [LDNOOBW](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) list (CC BY 4.0).
- Theme word pools informed by [dariusk/corpora](https://github.com/dariusk/corpora) (CC0).
- Inspired by *Strands* from The New York Times. UnStranded is an independent fan project and is not affiliated with The New York Times.
```

- [ ] **Step 2: Deployment smoke test**

Run: `npm test`
Expected: all PASS.

Then confirm subpath-safety: with the dev server running, check that `index.html`, `css/style.css`, `js/main.js`, `data/themes.json` and `data/words.txt` are all referenced with relative paths (no leading `/`):

Run: `git grep -nE "(href|src)=\"/|fetch\('/" -- index.html js/`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with play, test, theme and deploy instructions"
```
