# Daily Sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace monthly drops with one shared, ordered set of 6 boards per day, followed by unlimited free play, all drawn from 366 pre-built boards that cycle every 61 days.

**Architecture:** A new pure module `js/sequence.js` works out today's set, later-pass orders, and the free-play pool from `drops/sequence.json` and the date. `js/drops.js` delegates to it once the sequence has started, and falls back to today's drop behaviour before the start date or when the file is missing. A new builder, `tools/build-sequence.mjs`, reuses the drop builder's search to make one board per theme. It writes the sequence file, and rebuilds only changed themes in place.

**Tech Stack:** Static ES modules, no build step, no runtime dependencies; Node 22 `node --test`; the existing worker-thread board search.

Spec: `docs/superpowers/specs/2026-11-05-daily-sets-design.md`.

## Global Constraints

- No runtime dependencies, no build step. Browser code is plain ES modules under `js/`.
- Node 22 built-in test runner: `npm test` runs `node --test`.
- Everything that decides order must be deterministic: `mulberry32` and `hashString` from `js/rng.js`, integer arithmetic only, so every device computes the same sets.
- Set size 6, sequence length 366 (61 days), free-play gap 30 days, seam 14 days.
- Holiday themes left out of the sequence: `halloween`, `thanksgiving`, `christmas`, `valentines-day`, `easter`.
- The share card must not change.
- Every board passes the same checks as drop boards: `verifyPuzzle`, `checkPuzzle`, `offensiveWordsOn`, answers 5–10 letters.
- Never reproduce NYT Strands content.
- Commits end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never run `git push`; the user pushes.
- Work on branch `feature/daily-sets`.

## File map

| File | Change | Responsibility |
|---|---|---|
| `js/sequence.js` | create | Load the sequence; day/pass arithmetic; pass orders; today's set; upcoming ids; free-play pool; openable check |
| `js/drops.js` | modify | `dailyFor`, `getPuzzle`, `randomPuzzle` take an optional sequence; new `canOpen` |
| `js/storage.js` | modify | Today's set progress `{ date, shown, freePlay }` |
| `js/main.js` | modify | Load the sequence; New puzzle walks the set, then free play; set label; links; rollover |
| `index.html`, `README.md` | modify | Help text and docs |
| `tools/build-drop.mjs` | modify | Export `tracedDictionaryWords` |
| `tools/build-sequence.mjs` | create | Full build and locked rebuild of `drops/sequence.json` |
| `package.json` | modify | `build:sequence` script |
| `tests/sequence.test.js` | create | Arithmetic, pass orders, sets, upcoming ids, loading |
| `tests/sequence-play.test.js` | create | Free-play pool, openable, the `drops.js` integration |
| `tests/storage.test.js` | modify | Set progress |
| `tests/build-sequence.test.js` | create | Builder selection, assembly, locked rebuild, args |
| `tests/sequence-file.test.js` | create | Validates the committed `drops/sequence.json` |

---

### Task 1: Sequence order and today's set (`js/sequence.js`)

**Files:**
- Create: `js/sequence.js`
- Test: `tests/sequence.test.js`

**Interfaces:**
- Consumes: `mulberry32(seed)`, `hashString(str)`, `shuffle(items, rand)` from `js/rng.js`.
- Produces:
  - `SEAM_DAYS = 14`, `FREE_PLAY_GAP_DAYS = 30`
  - `loadSequence(fetchImpl = fetch): Promise<Sequence|null>`. Sequence is `{ id, start: 'YYYY-MM-DD', setSize, puzzles: Puzzle[] }`.
  - `dayNumber(start, today): number`
  - `hasStarted(seq|null, today): boolean`
  - `arrangePass(puzzles, seed: string, { setSize, avoidFirst = new Set(), seamDays = SEAM_DAYS }): Puzzle[]`
  - `passOrder(seq, p): Puzzle[]`
  - `setFor(seq|null, today): Puzzle[]|null`
  - `upcomingIds(seq, today, days): Set<string>`
  - Puzzle size = `answers.length - 1`.

- [ ] **Step 1: Write the failing tests**

Create `tests/sequence.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadSequence, dayNumber, hasStarted, arrangePass, passOrder, setFor, upcomingIds, SEAM_DAYS, FREE_PLAY_GAP_DAYS,
} from '../js/sequence.js';

const START = '2026-11-10';
const mk = (i) => ({
  id: `seq-${String(i + 1).padStart(3, '0')}`,
  themeId: `theme-${i}`,
  clue: 'c',
  obscure: i % 7 === 0,
  grid: [],
  answers: Array.from({ length: 1 + 4 + (i % 5) }, (_, k) => ({ word: `W${k}`, path: [], isSpangram: k === 0 })),
  steppingStones: [],
  difficulty: 1,
});
const makeSeq = () => ({ id: 'sequence', start: START, setSize: 6, puzzles: Array.from({ length: 366 }, (_, i) => mk(i)) });
const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const ids = (list) => list.map((p) => p.id);
const size = (p) => p.answers.length - 1;
const daysOf = (order, setSize = 6) =>
  Array.from({ length: order.length / setSize }, (_, d) => order.slice(d * setSize, (d + 1) * setSize));

test('constants match the spec', () => {
  assert.equal(SEAM_DAYS, 14);
  assert.equal(FREE_PLAY_GAP_DAYS, 30);
});

test('dayNumber counts calendar days from the start', () => {
  assert.equal(dayNumber(START, START), 0);
  assert.equal(dayNumber(START, '2026-11-09'), -1);
  assert.equal(dayNumber('2026-03-01', '2026-03-31'), 30);
  assert.equal(dayNumber('2026-12-31', '2027-01-01'), 1);
});

test('hasStarted is false without a sequence and before the start', () => {
  const seq = makeSeq();
  assert.equal(hasStarted(null, START), false);
  assert.equal(hasStarted(seq, '2026-11-09'), false);
  assert.equal(hasStarted(seq, START), true);
});

test('arrangePass returns a permutation with at most one obscure board per day', () => {
  const seq = makeSeq();
  const order = arrangePass(seq.puzzles, 'pass-0', { setSize: 6 });
  assert.deepEqual([...ids(order)].sort(), [...ids(seq.puzzles)].sort());
  for (const day of daysOf(order)) assert.ok(day.filter((p) => p.obscure).length <= 1);
});

test('arrangePass spreads board sizes so no day is all small or all large', () => {
  const order = arrangePass(makeSeq().puzzles, 'pass-0', { setSize: 6 });
  for (const day of daysOf(order)) {
    assert.ok(!day.every((p) => size(p) <= 5), `small day: ${ids(day)}`);
    assert.ok(!day.every((p) => size(p) >= 7), `large day: ${ids(day)}`);
  }
});

test('arrangePass is deterministic for a seed and differs between seeds', () => {
  const a = arrangePass(makeSeq().puzzles, 'pass-1', { setSize: 6 });
  const b = arrangePass(structuredClone(makeSeq().puzzles), 'pass-1', { setSize: 6 });
  const c = arrangePass(makeSeq().puzzles, 'pass-2', { setSize: 6 });
  assert.deepEqual(ids(a), ids(b));
  assert.notDeepEqual(ids(a), ids(c));
});

test('arrangePass keeps avoided boards out of the first seam days', () => {
  const puzzles = makeSeq().puzzles;
  const avoidFirst = new Set(ids(puzzles.slice(0, 84)));
  const order = arrangePass(puzzles, 'pass-1', { setSize: 6, avoidFirst });
  for (const p of order.slice(0, SEAM_DAYS * 6)) assert.ok(!avoidFirst.has(p.id), p.id);
  for (const day of daysOf(order)) assert.ok(day.filter((p) => p.obscure).length <= 1);
});

test('arrangePass rejects more obscure boards than days and a length that is not whole days', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ ...mk(i), obscure: i < 3 }));
  assert.throws(() => arrangePass(twelve, 'x', { setSize: 6 }), /obscure/);
  assert.throws(() => arrangePass(twelve.slice(0, 10), 'x', { setSize: 6 }), /multiple/);
});

test('pass 0 is the stored order; later passes are permutations that respect the seam', () => {
  const seq = makeSeq();
  assert.equal(passOrder(seq, 0), seq.puzzles);
  for (const p of [1, 2]) {
    const prev = passOrder(seq, p - 1);
    const order = passOrder(seq, p);
    assert.deepEqual([...ids(order)].sort(), [...ids(seq.puzzles)].sort());
    const tail = new Set(ids(prev.slice(-SEAM_DAYS * 6)));
    for (const q of order.slice(0, SEAM_DAYS * 6)) assert.ok(!tail.has(q.id), `pass ${p}: ${q.id}`);
    for (const day of daysOf(order)) assert.ok(day.filter((q) => q.obscure).length <= 1);
  }
});

test('setFor gives the day\'s six boards in order and rolls into the next pass', () => {
  const seq = makeSeq();
  assert.equal(setFor(seq, '2026-11-09'), null);
  assert.equal(setFor(null, START), null);
  assert.deepEqual(ids(setFor(seq, START)), ids(seq.puzzles.slice(0, 6)));
  assert.deepEqual(ids(setFor(seq, addDays(START, 60))), ids(seq.puzzles.slice(360, 366)));
  assert.deepEqual(ids(setFor(seq, addDays(START, 61))), ids(passOrder(seq, 1).slice(0, 6)));
});

test('upcomingIds covers today and the following days, across a pass boundary', () => {
  const seq = makeSeq();
  assert.deepEqual(upcomingIds(seq, START, 30), new Set(ids(seq.puzzles.slice(0, 180))));
  const late = upcomingIds(seq, addDays(START, 50), 30);
  for (const id of ids(seq.puzzles.slice(300))) assert.ok(late.has(id), id);
  for (const id of ids(passOrder(seq, 1).slice(0, 114))) assert.ok(late.has(id), id);
  assert.ok(late.size <= 180);
});

test('loadSequence returns the file, or null when it is missing or the fetch fails', async () => {
  const seq = makeSeq();
  const urls = [];
  const ok = await loadSequence(async (url) => { urls.push(url); return { ok: true, json: async () => seq }; });
  assert.equal(ok, seq);
  assert.deepEqual(urls, ['drops/sequence.json']);
  assert.equal(await loadSequence(async () => ({ ok: false, status: 404, json: async () => ({}) })), null);
  assert.equal(await loadSequence(async () => { throw new Error('offline'); }), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/sequence.test.js`
Expected: FAIL with `Cannot find module` for `js/sequence.js`.

- [ ] **Step 3: Write the implementation**

Create `js/sequence.js`:

```js
// Daily sets: one shared order of boards, a set of `setSize` per day, cycling in passes.
// Pass 0 is the order stored in drops/sequence.json; every later pass is a seeded shuffle that
// keeps at most one obscure board per day and keeps the end of the previous pass out of its first
// SEAM_DAYS days. Everything here is pure and deterministic, so every device agrees on the sets.
import { mulberry32, hashString, shuffle } from './rng.js';

export const SEAM_DAYS = 14;
export const FREE_PLAY_GAP_DAYS = 30;

export async function loadSequence(fetchImpl = fetch) {
  try {
    const res = await fetchImpl('drops/sequence.json');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function dayOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function dayNumber(start, today) {
  return dayOf(today) - dayOf(start);
}

export function hasStarted(seq, today) {
  return Boolean(seq) && dayNumber(seq.start, today) >= 0;
}

const size = (p) => p.answers.length - 1;

// One pass: obscure boards on evenly spaced days (one per day at most, at a random place in the
// day), familiar boards spread by size so each day gets a mix, then any board in `avoidFirst`
// swapped out of the first `seamDays` days for a later board of the same kind.
export function arrangePass(puzzles, seed, { setSize, avoidFirst = new Set(), seamDays = SEAM_DAYS }) {
  const days = puzzles.length / setSize;
  if (!Number.isInteger(days)) throw new Error('sequence length must be a multiple of the set size');
  const rand = mulberry32(hashString(seed));
  const obscure = shuffle(puzzles.filter((p) => p.obscure), rand);
  if (obscure.length > days) throw new Error(`${obscure.length} obscure boards for ${days} days`);

  const buckets = new Map();
  for (const p of shuffle(puzzles.filter((p) => !p.obscure), rand)) {
    if (!buckets.has(size(p))) buckets.set(size(p), []);
    buckets.get(size(p)).push(p);
  }
  const familiar = [...buckets.values()]
    .flatMap((bucket) => bucket.map((p, j) => ({ p, at: (j + 0.5) / bucket.length })))
    .sort((a, b) => a.at - b.at || size(a.p) - size(b.p))
    .map((x) => x.p);

  const out = new Array(puzzles.length);
  obscure.forEach((p, i) => {
    const day = Math.floor((i * days) / obscure.length);
    out[day * setSize + Math.floor(rand() * setSize)] = p;
  });
  let f = 0;
  for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = familiar[f++];

  const seam = Math.min(seamDays * setSize, out.length);
  for (let i = 0; i < seam; i++) {
    if (!avoidFirst.has(out[i].id)) continue;
    const j = out.findIndex((q, k) => k >= seam && q.obscure === out[i].obscure && !avoidFirst.has(q.id));
    if (j < 0) throw new Error('cannot keep the end of the previous pass out of the seam');
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const passCache = new WeakMap();

export function passOrder(seq, p) {
  let cache = passCache.get(seq);
  if (!cache) {
    cache = [seq.puzzles];
    passCache.set(seq, cache);
  }
  while (cache.length <= p) {
    const prev = cache[cache.length - 1];
    const avoidFirst = new Set(prev.slice(-SEAM_DAYS * seq.setSize).map((q) => q.id));
    cache.push(arrangePass(seq.puzzles, `pass-${cache.length}`, { setSize: seq.setSize, avoidFirst }));
  }
  return cache[p];
}

function setOnDay(seq, d) {
  const days = seq.puzzles.length / seq.setSize;
  const i = d % days;
  return passOrder(seq, Math.floor(d / days)).slice(i * seq.setSize, (i + 1) * seq.setSize);
}

export function setFor(seq, today) {
  if (!hasStarted(seq, today)) return null;
  return setOnDay(seq, dayNumber(seq.start, today));
}

// Ids of every board in a set from today through the following `days - 1` days.
export function upcomingIds(seq, today, days) {
  const first = Math.max(0, dayNumber(seq.start, today));
  const last = dayNumber(seq.start, today) + days;
  const ids = new Set();
  for (let d = first; d < last; d++) for (const p of setOnDay(seq, d)) ids.add(p.id);
  return ids;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/sequence.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add js/sequence.js tests/sequence.test.js
git commit -m "sequence: daily sets, pass orders and upcoming boards" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Free play and the `drops.js` integration

**Files:**
- Modify: `js/sequence.js` (append)
- Modify: `js/drops.js`
- Test: `tests/sequence-play.test.js`

**Interfaces:**
- Consumes: Task 1's `hasStarted`, `setFor`, `upcomingIds`, `FREE_PLAY_GAP_DAYS`.
- Produces:
  - `freePlayPool(drops, seq, today): Puzzle[]` and `isOpenable(drops, seq, id, today): boolean` in `js/sequence.js`
  - in `js/drops.js`:
    - `dailyFor(drops, today, seq = null)`
    - `getPuzzle(drops, id, seq = null)`
    - `canOpen(drops, id, today, seq = null)`
    - `randomPuzzle(drops, today, { played, solved, excludeId, seq = null }, rand = Math.random)`

  With `seq` null, or before its start date, all of these behave exactly as today.

- [ ] **Step 1: Write the failing tests**

Create `tests/sequence-play.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freePlayPool, isOpenable, setFor, upcomingIds } from '../js/sequence.js';
import { dailyFor, getPuzzle, canOpen, randomPuzzle } from '../js/drops.js';

const START = '2026-11-10';
const mk = (i) => ({
  id: `seq-${String(i + 1).padStart(3, '0')}`,
  themeId: `theme-${i}`,
  clue: 'c',
  obscure: i % 7 === 0,
  grid: [],
  answers: Array.from({ length: 1 + 4 + (i % 5) }, (_, k) => ({ word: `W${k}`, path: [], isSpangram: k === 0 })),
  steppingStones: [],
  difficulty: 1,
});
const makeSeq = () => ({ id: 'sequence', start: START, setSize: 6, puzzles: Array.from({ length: 366 }, (_, i) => mk(i)) });
const mkDrop = (id) => ({ ...mk(0), id, themeId: `drop-${id}` });
const DROPS = [{
  id: '2026-11',
  puzzles: ['d1', 'd2', 'd3'].map(mkDrop),
  schedule: { '2026-11-07': 'd1', '2026-12-06': 'd2' },
  library: ['d3'],
}];
const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const ids = (list) => list.map((p) => p.id);
const none = new Set();

test('free play holds every drop board and every board not due in the next 30 days', () => {
  const seq = makeSeq();
  const pool = ids(freePlayPool(DROPS, seq, START));
  assert.deepEqual(pool, ['d1', 'd2', 'd3', ...ids(seq.puzzles.slice(180))]);
});

test('free play and the next 30 days of sets together cover every board, with no overlap', () => {
  const seq = makeSeq();
  for (const offset of [0, 40, 55, 70]) {
    const today = addDays(START, offset);
    const pool = new Set(ids(freePlayPool(DROPS, seq, today)));
    const upcoming = upcomingIds(seq, today, 30);
    for (const id of upcoming) assert.ok(!pool.has(id), `${today}: ${id}`);
    for (const p of seq.puzzles) assert.ok(pool.has(p.id) || upcoming.has(p.id), `${today}: ${p.id}`);
  }
});

test('isOpenable allows today\'s set and free play, not boards due soon', () => {
  const seq = makeSeq();
  assert.equal(isOpenable(DROPS, seq, setFor(seq, START)[3].id, START), true);
  assert.equal(isOpenable(DROPS, seq, 'seq-007', START), false);
  assert.equal(isOpenable(DROPS, seq, 'seq-200', START), true);
  assert.equal(isOpenable(DROPS, seq, 'd2', START), true);
  assert.equal(isOpenable(DROPS, seq, 'nope', START), false);
});

test('dailyFor uses the drop schedule before the start and the set\'s first board after', () => {
  const seq = makeSeq();
  assert.equal(dailyFor(DROPS, '2026-11-07', seq).id, 'd1');
  assert.equal(dailyFor(DROPS, START, seq).id, 'seq-001');
  assert.equal(dailyFor(DROPS, '2026-12-06', seq).id, setFor(seq, '2026-12-06')[0].id);
  assert.equal(dailyFor(DROPS, '2026-11-07').id, 'd1');
});

test('getPuzzle finds sequence boards only when given the sequence', () => {
  const seq = makeSeq();
  assert.equal(getPuzzle(DROPS, 'seq-005', seq).id, 'seq-005');
  assert.equal(getPuzzle(DROPS, 'seq-005'), null);
  assert.equal(getPuzzle(DROPS, 'd3', seq).id, 'd3');
});

test('canOpen uses release dates before the start and the free-play rules after', () => {
  const seq = makeSeq();
  assert.equal(canOpen(DROPS, 'd3', '2026-11-07', seq), true);
  assert.equal(canOpen(DROPS, 'd2', '2026-11-07', seq), false);
  assert.equal(canOpen(DROPS, 'd2', START, seq), true);
  assert.equal(canOpen(DROPS, 'seq-007', START, seq), false);
  assert.equal(canOpen(DROPS, 'seq-003', START, seq), true);
});

test('randomPuzzle draws only from free play once the sequence has started', () => {
  const seq = makeSeq();
  const today = new Set(ids(setFor(seq, START)));
  const pool = new Set(ids(freePlayPool(DROPS, seq, START)));
  for (let i = 0; i < 60; i++) {
    const p = randomPuzzle(DROPS, START, { played: none, solved: none, excludeId: 'd1', seq }, () => i / 60);
    assert.ok(pool.has(p.id), p.id);
    assert.ok(!today.has(p.id), p.id);
    assert.notEqual(p.id, 'd1');
  }
});

test('randomPuzzle still prefers unseen boards in free play', () => {
  const seq = makeSeq();
  const pool = ids(freePlayPool(DROPS, seq, START));
  const played = new Set(pool.filter((id) => id !== 'seq-300'));
  assert.equal(randomPuzzle(DROPS, START, { played, solved: none, excludeId: null, seq }, () => 0.5).id, 'seq-300');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/sequence-play.test.js`
Expected: FAIL. `freePlayPool` is not exported from `js/sequence.js`, and `canOpen` is not exported from `js/drops.js`.

- [ ] **Step 3: Write the implementation**

Append to `js/sequence.js`:

```js
// Boards for free play: every drop board and every sequence board, except today's set and any
// board in a set over the next FREE_PLAY_GAP_DAYS days, so free play never spoils a set.
export function freePlayPool(drops, seq, today) {
  const due = upcomingIds(seq, today, FREE_PLAY_GAP_DAYS);
  return [...drops.flatMap((d) => d.puzzles), ...seq.puzzles].filter((p) => !due.has(p.id));
}

export function isOpenable(drops, seq, id, today) {
  if (setFor(seq, today).some((p) => p.id === id)) return true;
  return freePlayPool(drops, seq, today).some((p) => p.id === id);
}
```

In `js/drops.js`:

- Add to the top: `import { hasStarted, setFor, freePlayPool, isOpenable } from './sequence.js';`
- Replace `getPuzzle`, `dailyFor` and `randomPuzzle`, and add `canOpen`, so the file's functions after `releasedPuzzles` read:

```js
export function getPuzzle(drops, id, seq = null) {
  for (const drop of drops) {
    const puzzle = drop.puzzles.find((p) => p.id === id);
    if (puzzle) return puzzle;
  }
  return seq?.puzzles.find((p) => p.id === id) ?? null;
}

// Once the sequence has started, the daily is the first board of today's set.
export function dailyFor(drops, today, seq = null) {
  if (hasStarted(seq, today)) return setFor(seq, today)[0];
  for (let i = drops.length - 1; i >= 0; i--) {
    const id = drops[i].schedule[today];
    if (id) return getPuzzle(drops, id);
  }
  const released = releasedPuzzles(drops, today);
  if (released.length > 0) return released[hashString('daily-' + today) % released.length];
  // Nothing released yet (e.g. device clock before the first drop): serve the earliest daily.
  const dates = drops.flatMap((drop) => Object.keys(drop.schedule).map((date) => [date, drop.schedule[date]]));
  if (dates.length === 0) return null;
  dates.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return getPuzzle(drops, dates[0][1]);
}

// Whether a ?id= link may open this board today.
export function canOpen(drops, id, today, seq = null) {
  return hasStarted(seq, today) ? isOpenable(drops, seq, id, today) : isReleased(drops, id, today);
}

export function randomPuzzle(drops, today, { played, solved, excludeId, seq = null }, rand = Math.random) {
  const daily = dailyFor(drops, today, seq);
  const pool = hasStarted(seq, today) ? freePlayPool(drops, seq, today) : releasedPuzzles(drops, today);
  const candidates = pool.filter((p) => p.id !== daily?.id && p.id !== excludeId);
  const tiers = [
    candidates.filter((p) => !played.has(p.id)),
    candidates.filter((p) => played.has(p.id) && !solved.has(p.id)),
    candidates,
  ];
  const found = tiers.find((t) => t.length > 0);
  return found ? found[Math.floor(rand() * found.length)] : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/sequence-play.test.js tests/runtime-drops.test.js tests/sequence.test.js`
Expected: PASS. The existing drop tests prove that behaviour without a sequence is unchanged.

- [ ] **Step 5: Commit**

```bash
git add js/sequence.js js/drops.js tests/sequence-play.test.js
git commit -m "sequence: free-play pool, link rules, and drops.js falls back before the start" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Today's set progress (`js/storage.js`)

**Files:**
- Modify: `js/storage.js` (append)
- Test: `tests/storage.test.js` (append, and add the new names to its import)

**Interfaces:**
- Produces:
  - `loadSetProgress(today, store = defaultStore()): { date, shown: string[], freePlay: boolean }`. It returns a fresh record when the stored one is for another date, or when storage is blocked.
  - `saveSetProgress(progress, store = defaultStore())`

- [ ] **Step 1: Write the failing tests**

In `tests/storage.test.js`, add `loadSetProgress, saveSetProgress` to the import list from `../js/storage.js`, then append:

```js
test('set progress starts empty for a new day', () => {
  const store = new MemoryStore();
  assert.deepEqual(loadSetProgress('2026-11-10', store), { date: '2026-11-10', shown: [], freePlay: false });
});

test('set progress round-trips for the same day and resets on the next', () => {
  const store = new MemoryStore();
  saveSetProgress({ date: '2026-11-10', shown: ['seq-001', 'seq-002'], freePlay: true }, store);
  assert.deepEqual(loadSetProgress('2026-11-10', store), { date: '2026-11-10', shown: ['seq-001', 'seq-002'], freePlay: true });
  assert.deepEqual(loadSetProgress('2026-11-11', store), { date: '2026-11-11', shown: [], freePlay: false });
});

test('set progress survives blocked storage', () => {
  assert.doesNotThrow(() => saveSetProgress({ date: '2026-11-10', shown: ['x'], freePlay: false }, throwingStore));
  assert.deepEqual(loadSetProgress('2026-11-10', throwingStore), { date: '2026-11-10', shown: [], freePlay: false });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/storage.test.js`
Expected: FAIL. `loadSetProgress` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `js/storage.js`:

```js
// Which of today's set this device has shown, and whether free play has begun. One record,
// replaced when the date changes, so a new day starts a new set.
export function loadSetProgress(today, store = defaultStore()) {
  const saved = read('set', null, store);
  if (saved?.date === today && Array.isArray(saved.shown)) {
    return { date: today, shown: saved.shown, freePlay: Boolean(saved.freePlay) };
  }
  return { date: today, shown: [], freePlay: false };
}

export function saveSetProgress(progress, store = defaultStore()) {
  write('set', progress, store);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/storage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/storage.js tests/storage.test.js
git commit -m "storage: remember today's set progress" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Play the daily set in the app

**Files:**
- Modify: `js/main.js`
- Modify: `index.html` (lines 6 and 76)

**Interfaces:**
- Consumes:
  - `loadSequence`, `setFor` from `js/sequence.js`
  - `dailyFor(drops, today, seq)`, `getPuzzle(drops, id, seq)`, `canOpen(drops, id, today, seq)`, `randomPuzzle(drops, today, { …, seq })` from `js/drops.js`
  - `loadSetProgress`, `saveSetProgress` from `js/storage.js`
- Produces: no exports. Browser behaviour is verified in Task 8.

`main.js` has no unit tests: it is DOM wiring. All its logic sits in the modules tested in Tasks 1–3, and Task 8 drives it in a browser.

- [ ] **Step 1: Update the imports and app state in `js/main.js`**

Replace the `drops.js` and `storage.js` imports, and add the `sequence.js` import:

```js
import { loadDrops, dailyFor, getPuzzle, canOpen, randomPuzzle } from './drops.js';
import { loadSequence, setFor } from './sequence.js';
```

```js
import {
  loadProgress, saveProgress, loadStats, saveStats, applyStart, applyCompletion,
  displayStreak, isFirstVisit, markVisited, markPlayed, markSolved, loadPlayed, loadSolved,
  loadSetProgress, saveSetProgress,
} from './storage.js';
```

Add `seq: null,` after `drops: [],` in the `app` object, and add this constant under `MESSAGE_MS`:

```js
const FREE_PLAY_NOTE = "That's today's 6. Now it's free play.";
```

- [ ] **Step 2: Show the set position on the theme label**

In `render()`, replace the `theme-label` line with:

```js
  const set = setFor(app.seq, app.today);
  const position = set ? set.findIndex((p) => p.id === puzzle.id) : -1;
  const label = position >= 0 ? `TODAY ${position + 1} OF ${set.length}` : (app.isDaily ? "TODAY'S THEME" : 'PUZZLE');
  $('theme-label').textContent = label + (puzzle.obscure ? ' · DEEP CUT' : '');
```

- [ ] **Step 3: Record set boards as shown, and pass the sequence everywhere**

In `startPuzzle(puzzle)`:
- Change the `isDaily` line to:
  ```js
    app.isDaily = dailyFor(app.drops, app.today, app.seq)?.id === puzzle.id;
  ```
- Directly after `markPlayed(puzzle.id);`, add:
  ```js
    if (setFor(app.seq, app.today)?.some((p) => p.id === puzzle.id)) {
      const progress = loadSetProgress(app.today);
      if (!progress.shown.includes(puzzle.id)) {
        progress.shown.push(puzzle.id);
        saveSetProgress(progress);
      }
    }
  ```

Replace `newPuzzle`, `playDaily` and `checkDateRollover` with:

```js
// Today's set first, in order; then free play, announced once.
function newPuzzle() {
  const set = setFor(app.seq, app.today);
  if (set) {
    const shown = loadSetProgress(app.today).shown;
    const next = set.find((p) => !shown.includes(p.id) && p.id !== app.puzzle?.id);
    if (next) {
      history.replaceState(null, '', `?id=${next.id}`);
      startPuzzle(next);
      return;
    }
  }
  const pick = randomPuzzle(app.drops, app.today, {
    played: loadPlayed(),
    solved: loadSolved(),
    excludeId: app.puzzle?.id,
    seq: app.seq,
  });
  if (!pick) {
    flashMessage("You've seen them all! More soon.");
    return;
  }
  history.replaceState(null, '', `?id=${pick.id}`);
  startPuzzle(pick);
  if (set) {
    const progress = loadSetProgress(app.today);
    if (!progress.freePlay) {
      progress.freePlay = true;
      saveSetProgress(progress);
      flashMessage(FREE_PLAY_NOTE);
    }
  }
}

function playDaily() {
  history.replaceState(null, '', location.pathname);
  startPuzzle(dailyFor(app.drops, app.today, app.seq));
}

function checkDateRollover() {
  const key = dateKey();
  if (key === app.today) return;
  app.today = key;
  const daily = dailyFor(app.drops, app.today, app.seq);
  if (app.isDaily && daily) {
    history.replaceState(null, '', location.pathname);
    startPuzzle(daily);
    return;
  }
  // The puzzle on screen may itself have just become today's daily.
  app.isDaily = daily?.id === app.puzzle?.id;
  render();
}
```

- [ ] **Step 4: Load the sequence and use it for links in `init()`**

Replace the block from `try { app.drops = await loadDrops();` to the end of the `if (linked) … else …` block with:

```js
  try {
    [app.drops, app.seq] = await Promise.all([loadDrops(), loadSequence()]);
  } catch {
    showFatal();
    return;
  }
  const daily = dailyFor(app.drops, app.today, app.seq);
  if (!daily) {
    showFatal();
    return;
  }

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const linked = id && canOpen(app.drops, id, app.today, app.seq) ? getPuzzle(app.drops, id, app.seq) : null;
  if (linked) {
    startPuzzle(linked);
  } else {
    if (params.has('id') || params.has('p')) history.replaceState(null, '', location.pathname);
    startPuzzle(daily);
  }
```

- [ ] **Step 5: Update the help text and description in `index.html`**

Line 6:

```html
  <meta name="description" content="A Strands-style word search. The same six puzzles for everyone each day, then free play as long as you like.">
```

Line 76:

```html
      <li>Everyone gets the same six puzzles each day, in the same order. Press <b>New puzzle</b> to move through them. After the sixth, <b>New puzzle</b> keeps going with free play.</li>
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS. No `drops/sequence.json` exists yet, so the app's behaviour is unchanged.

- [ ] **Step 7: Commit**

```bash
git add js/main.js index.html
git commit -m "app: play today's set of six in order, then free play" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sequence builder logic (`tools/build-sequence.mjs`)

**Files:**
- Modify: `tools/build-drop.mjs:266`. Change `function tracedDictionaryWords(` to `export function tracedDictionaryWords(`.
- Create: `tools/build-sequence.mjs` (pure functions only in this task; the CLI comes in Task 6)
- Test: `tests/build-sequence.test.js`

**Interfaces:**
- Consumes:
  - `arrangePass` from `js/sequence.js`
  - `planDrop`, `tracedDictionaryWords` from `tools/build-drop.mjs`
  - `eligibleAnswers` from `tools/lib/familiarity.js`
  - `countWordSets`, `targetCounts`, `spreadStones` from `tools/lib/variety.js`
  - `hashString` from `js/rng.js`
- Produces:
  - Constants `SEQUENCE_LENGTH = 366`, `SET_SIZE = 6`, `SEED = 'sequence'`, `HOLIDAY_THEMES`.
  - `contentHash(theme): number`
  - `sequenceId(i): 'seq-001'…`
  - `sequenceJobs({ themes, ranks, earlier }): { jobs, failures, rejections }`. Jobs are the drop builder's `{ theme, eligible, feasible, target, fresh, avoid }`.
  - `selectSequence(successes, { length, setSize }): selected[]`. Successes are jobs plus `candidates`; each selected item is a success plus `chosen`.
  - `toPuzzle({ theme, chosen }): Puzzle` without `id`.
  - `metaFor(theme, puzzle, rebuilds = 0): { themeId, contentHash, rebuilds, checkedLong, stoneCandidates }`
  - `assembleSequence({ start, selected, setSize }): { sequence, meta }`
  - `rebuildJobs({ sequence, meta, themes, ranks, earlier, names, attempts, seconds }): { jobs, failures }`. Each job is `{ id, theme, eligible, feasible, target, avoid, dropId, attempts, seconds, stones }`.
  - `applyRebuild({ sequence, meta, jobs, results }): { sequence, meta, rebuilt: string[], failures }`. `results` is a Map from theme id to the search result.
  - `boardReport(sequence, ids, dictionaryWords, themesById): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/build-sequence.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEQUENCE_LENGTH, SET_SIZE, HOLIDAY_THEMES, contentHash, sequenceId, sequenceJobs, selectSequence,
  assembleSequence, rebuildJobs, applyRebuild, metaFor, boardReport,
} from '../tools/build-sequence.mjs';

const words = (s) => s.split(' ');
const theme = (id, i = 0, obscure = false) => ({
  id, clue: `clue ${id}`, spangram: 'SPANGRAM', obscure,
  answers: words('ALPHA BRAVO CHARLIE DELTA ECHOES FOXTROT GOLFING HOTELS INDIAN'),
  recognized: words('JULIET KILO LIMA MIKE NOVEMBER OSCAR PAPA').concat([`EXTRA${i}`]),
});
const board = (count, stones, score) => ({
  variant: {
    grid: Array(48).fill('A'),
    answers: [{ word: 'SPANGRAM', path: [], isSpangram: true },
      ...words('ALPHA BRAVO CHARLIE DELTA ECHOES FOXTROT GOLFING HOTELS').slice(0, count).map((w) => ({ word: w, path: [], isSpangram: false }))],
  },
  score,
  steppingStones: Array.from({ length: stones }, (_, k) => `ST${k}`),
});
const success = (id, i, { obscure = false, reused = false } = {}) => ({
  theme: theme(id, i, obscure),
  avoid: reused ? [{ words: ['ALPHA'], grid: 'X' }] : [],
  candidates: [board(4 + (i % 5), 2, i / 1000), board(4 + (i % 5), 3, i / 1000 + 0.0001), board(4 + (i % 5), 4, i / 1000)],
});

test('constants match the spec', () => {
  assert.equal(SEQUENCE_LENGTH, 366);
  assert.equal(SET_SIZE, 6);
  assert.deepEqual(HOLIDAY_THEMES, ['halloween', 'thanksgiving', 'christmas', 'valentines-day', 'easter']);
  assert.equal(sequenceId(0), 'seq-001');
  assert.equal(sequenceId(365), 'seq-366');
});

test('sequenceJobs leaves holiday themes out', () => {
  const birds = {
    clue: 'Feathered friends', spangram: 'FEATHERED', obscure: false,
    answers: words('PELICAN FLAMINGO CORMORANT PARAKEET OSTRICH PHEASANT SPARROW PENGUIN MAGPIE BUZZARD SWALLOW STARLING'),
    recognized: words('ROBIN WREN DOVE HAWK CROW LARK KITE SWAN DUCK GOOSE'),
  };
  const ranks = new Map(birds.answers.map((w) => [w, 1]));
  const { jobs } = sequenceJobs({ themes: [{ ...birds, id: 'easter' }, { ...birds, id: 'birds' }], ranks, earlier: {} });
  assert.deepEqual(jobs.map((j) => j.theme.id), ['birds']);
});

test('selectSequence prefers never-used themes, caps obscure at one per day, and spreads stones', () => {
  const successes = [
    ...Array.from({ length: 10 }, (_, i) => success(`fresh-${i}`, i)),
    ...Array.from({ length: 4 }, (_, i) => success(`old-${i}`, 20 + i, { reused: true })),
    ...Array.from({ length: 4 }, (_, i) => success(`deep-${i}`, 40 + i, { obscure: true })),
  ];
  const picked = selectSequence(successes, { length: 12, setSize: 6 });
  const ids = picked.map((s) => s.theme.id);
  assert.equal(picked.length, 12);
  assert.equal(picked.filter((s) => s.theme.obscure).length, 2);
  for (let i = 0; i < 10; i++) assert.ok(ids.includes(`fresh-${i}`));
  assert.equal(ids.filter((id) => id.startsWith('old-')).length, 0);
  const stones = new Set(picked.map((s) => s.chosen.steppingStones.length));
  assert.ok(stones.size >= 2, 'stepping-stone counts are spread');
});

test('selectSequence fails loudly when too few themes produced a board', () => {
  assert.throws(() => selectSequence([success('a', 1)], { length: 12, setSize: 6 }), /needs 12/);
});

test('assembleSequence numbers the boards in pass-0 order and snapshots meta', () => {
  const selected = selectSequence(Array.from({ length: 12 }, (_, i) => success(`t-${i}`, i, { obscure: i < 2 })), { length: 12, setSize: 6 });
  const { sequence, meta } = assembleSequence({ start: '2026-11-10', selected, setSize: 6 });
  assert.equal(sequence.id, 'sequence');
  assert.equal(sequence.start, '2026-11-10');
  assert.equal(sequence.setSize, 6);
  assert.deepEqual(sequence.puzzles.map((p) => p.id), Array.from({ length: 12 }, (_, i) => sequenceId(i)));
  for (let d = 0; d < 2; d++) {
    assert.ok(sequence.puzzles.slice(d * 6, d * 6 + 6).filter((p) => p.obscure).length <= 1);
  }
  for (const p of sequence.puzzles) {
    assert.ok(!p.id.includes(p.themeId));
    assert.equal(meta[p.id].themeId, p.themeId);
    assert.equal(meta[p.id].rebuilds, 0);
    assert.equal(meta[p.id].contentHash, contentHash(selected.find((s) => s.theme.id === p.themeId).theme));
  }
});

test('metaFor lists unchosen long words to check and short words as stone candidates', () => {
  const t = theme('x');
  const m = metaFor(t, { answers: [{ word: 'SPANGRAM' }, { word: 'ALPHA' }, { word: 'CHARLIE' }] });
  assert.ok(m.checkedLong.includes('FOXTROT') && !m.checkedLong.includes('CHARLIE'));
  assert.ok(m.stoneCandidates.includes('BRAVO') && !m.stoneCandidates.includes('ALPHA'));
});

function built() {
  const selected = selectSequence(Array.from({ length: 12 }, (_, i) => success(`t-${i}`, i)), { length: 12, setSize: 6 });
  return { selected, ...assembleSequence({ start: '2026-11-10', selected, setSize: 6 }) };
}

test('rebuildJobs picks only named and changed themes, avoiding the current board', () => {
  const { sequence, meta, selected } = built();
  const themes = selected.map((s) => s.theme);
  const changed = { ...themes[3], recognized: [...themes[3].recognized, 'ZULU'] };
  const all = themes.map((t) => (t.id === changed.id ? changed : t));
  const ranks = new Map(all.flatMap((t) => t.answers).map((w) => [w, 1]));
  const { jobs, failures } = rebuildJobs({ sequence, meta, themes: all, ranks, earlier: {}, names: [themes[5].id], attempts: 10, seconds: 5 });
  assert.deepEqual(failures, []);
  assert.deepEqual(jobs.map((j) => j.theme.id).sort(), [themes[3].id, themes[5].id].sort());
  for (const job of jobs) {
    const current = sequence.puzzles.find((p) => p.id === job.id);
    assert.equal(job.theme.id, current.themeId);
    assert.equal(job.dropId, 'sequence-r1');
    assert.equal(job.target, current.answers.length - 1);
    assert.equal(job.stones, current.steppingStones.length);
    assert.equal(job.avoid.at(-1).grid, current.grid.join(''));
  }
});

test('rebuildJobs reports unknown names and missing theme files', () => {
  const { sequence, meta, selected } = built();
  const themes = selected.map((s) => s.theme).slice(1);
  const ranks = new Map(themes.flatMap((t) => t.answers).map((w) => [w, 1]));
  const { failures } = rebuildJobs({ sequence, meta, themes, ranks, earlier: {}, names: ['nope'] });
  const reasons = failures.map((f) => f.reason).sort();
  assert.deepEqual(reasons, ['not in the sequence', 'theme file missing']);
});

test('applyRebuild replaces boards in place and leaves the rest untouched', () => {
  const { sequence, meta, selected } = built();
  const target = sequence.puzzles[4];
  const t = selected.find((s) => s.theme.id === target.themeId).theme;
  const jobs = [{ id: target.id, theme: t, stones: target.steppingStones.length }];
  const fresh = board(5, target.steppingStones.length, 0.9);
  fresh.variant.grid = Array(48).fill('B');
  const results = new Map([[t.id, { candidates: [board(5, 9, 0.1), fresh] }]]);
  const out = applyRebuild({ sequence, meta, jobs, results });
  assert.deepEqual(out.rebuilt, [target.id]);
  assert.equal(out.sequence.puzzles[4].id, target.id);
  assert.equal(out.sequence.puzzles[4].grid[0], 'B');
  assert.equal(out.meta[target.id].rebuilds, 1);
  out.sequence.puzzles.forEach((p, i) => { if (i !== 4) assert.equal(p, sequence.puzzles[i]); });
});

test('applyRebuild reports a failed search and keeps the old board', () => {
  const { sequence, meta, selected } = built();
  const target = sequence.puzzles[2];
  const t = selected.find((s) => s.theme.id === target.themeId).theme;
  const out = applyRebuild({
    sequence, meta, jobs: [{ id: target.id, theme: t, stones: 2 }], results: new Map([[t.id, { failure: 'no passing board' }]]),
  });
  assert.deepEqual(out.rebuilt, []);
  assert.equal(out.failures[0].reason, 'no passing board');
  assert.equal(out.sequence.puzzles[2], target);
});

test('boardReport names day and position for each listed board', () => {
  const { sequence, selected } = built();
  const byId = new Map(selected.map((s) => [s.theme.id, s.theme]));
  const report = boardReport(sequence, [sequence.puzzles[7].id], [], byId);
  assert.match(report, /^seq-008 \[day 2, board 2\]/);
  assert.match(report, /answers: SPANGRAM/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/build-sequence.test.js`
Expected: FAIL with `Cannot find module` for `tools/build-sequence.mjs`.

- [ ] **Step 3: Export `tracedDictionaryWords`**

In `tools/build-drop.mjs`, change `function tracedDictionaryWords(grid, dictionaryWords, exclude) {` to `export function tracedDictionaryWords(grid, dictionaryWords, exclude) {`.

- [ ] **Step 4: Write the builder logic**

Create `tools/build-sequence.mjs`:

```js
// Offline builder for the daily-set sequence (docs/superpowers/specs/2026-11-05-daily-sets-design.md):
// one board per theme, SEQUENCE_LENGTH boards in a fixed pass-0 order of SET_SIZE per day.
//
// A full build searches every eligible theme (holidays left out), picks the boards (themes never
// used in a drop first, at most one obscure board per day) and orders them with arrangePass. A
// locked rebuild keeps every board in its place and re-searches only the themes named with
// --rebuild or whose content has changed since their board was built (meta.contentHash).
import { hashString } from '../js/rng.js';
import { arrangePass } from '../js/sequence.js';
import { eligibleAnswers } from './lib/familiarity.js';
import { countWordSets, targetCounts, spreadStones } from './lib/variety.js';
import { planDrop, tracedDictionaryWords } from './build-drop.mjs';

export const SEQUENCE_LENGTH = 366;
export const SET_SIZE = 6;
export const SEED = 'sequence';
export const HOLIDAY_THEMES = ['halloween', 'thanksgiving', 'christmas', 'valentines-day', 'easter'];

export const contentHash = (theme) => hashString(JSON.stringify(theme));
export const sequenceId = (i) => `seq-${String(i + 1).padStart(3, '0')}`;

export function sequenceJobs({ themes, ranks, earlier = {} }) {
  const eligible = themes.filter((t) => !HOLIDAY_THEMES.includes(t.id));
  return planDrop({ dropId: SEED, themes: eligible, ranks, earlier, dailies: 0 });
}

// Never-used themes first (no earlier boards to avoid), hardest first; at most one obscure
// board per day. Then each theme's stepping-stone count is chosen to spread counts over 2-5.
export function selectSequence(successes, { length = SEQUENCE_LENGTH, setSize = SET_SIZE } = {}) {
  const maxObscure = length / setSize;
  const ranked = successes
    .map((s) => ({ ...s, score: Math.max(...s.candidates.map((c) => c.score)) }))
    .sort((a, b) => Number(a.avoid.length > 0) - Number(b.avoid.length > 0)
      || b.score - a.score || a.theme.id.localeCompare(b.theme.id));
  const picked = [];
  let obscure = 0;
  for (const s of ranked) {
    if (picked.length === length) break;
    if (s.theme.obscure) {
      if (obscure === maxObscure) continue;
      obscure++;
    }
    picked.push(s);
  }
  if (picked.length < length) {
    throw new Error(`Only ${picked.length} themes produced a usable board; the sequence needs ${length}.`);
  }
  const stones = spreadStones(picked.map((s) => ({
    id: s.theme.id,
    options: s.candidates.map((c) => ({ stones: c.steppingStones.length, score: c.score })),
  })));
  return picked.map((s) => ({ ...s, chosen: s.candidates.find((c) => c.steppingStones.length === stones.get(s.theme.id)) }));
}

export function toPuzzle({ theme, chosen }) {
  return {
    themeId: theme.id,
    clue: theme.clue,
    obscure: !!theme.obscure,
    grid: chosen.variant.grid,
    answers: chosen.variant.answers,
    steppingStones: chosen.steppingStones,
    difficulty: Math.round(chosen.score * 100) / 100,
  };
}

// The words a board's checks used, as in the drop meta, plus what a locked rebuild needs.
export function metaFor(theme, puzzle, rebuilds = 0) {
  const answerWords = new Set(puzzle.answers.map((a) => a.word));
  return {
    themeId: theme.id,
    contentHash: contentHash(theme),
    rebuilds,
    checkedLong: [...new Set([...theme.answers, ...theme.recognized])]
      .filter((w) => w.length >= 6 && !answerWords.has(w)).sort(),
    stoneCandidates: [...new Set([...theme.recognized, ...theme.answers])]
      .filter((w) => w.length >= 4 && w.length <= 5 && !answerWords.has(w)).sort(),
  };
}

export function assembleSequence({ start, selected, setSize = SET_SIZE }) {
  const boards = selected.map((s) => ({ id: s.theme.id, ...toPuzzle(s) }));
  const ordered = arrangePass(boards, 'pass-0', { setSize });
  const byTheme = new Map(selected.map((s) => [s.theme.id, s.theme]));
  const puzzles = ordered.map(({ id, ...rest }, i) => ({ id: sequenceId(i), ...rest }));
  const meta = Object.fromEntries(puzzles.map((p) => [p.id, metaFor(byTheme.get(p.themeId), p)]));
  return { sequence: { id: SEED, start, setSize, puzzles }, meta };
}

// Search jobs for a locked rebuild: named themes and themes whose content changed. Each job
// keeps the board's word count and stepping-stone count, avoids its current board (and any
// earlier drop boards), and uses a fresh seed so a named theme gets a new board.
export function rebuildJobs({ sequence, meta, themes, ranks, earlier = {}, names = [], attempts, seconds }) {
  const byId = new Map(themes.map((t) => [t.id, t]));
  const inSequence = new Set(sequence.puzzles.map((p) => p.themeId));
  const failures = names.filter((n) => !inSequence.has(n)).map((n) => ({ id: null, themeId: n, reason: 'not in the sequence' }));
  const jobs = [];
  for (const p of sequence.puzzles) {
    const theme = byId.get(p.themeId);
    if (!theme) {
      failures.push({ id: p.id, themeId: p.themeId, reason: 'theme file missing' });
      continue;
    }
    const m = meta[p.id];
    if (!names.includes(theme.id) && m.contentHash === contentHash(theme)) continue;
    const { eligible } = eligibleAnswers(theme, ranks);
    const feasible = targetCounts(countWordSets(theme.spangram, eligible));
    if (!feasible.length) {
      failures.push({ id: p.id, themeId: theme.id, reason: 'no word set fills the board' });
      continue;
    }
    const current = { words: p.answers.filter((a) => !a.isSpangram).map((a) => a.word), grid: p.grid.join('') };
    jobs.push({
      id: p.id, theme, eligible, feasible,
      target: p.answers.length - 1,
      avoid: [...(earlier.boards?.[theme.id] ?? []), current],
      dropId: `${SEED}-r${(m.rebuilds ?? 0) + 1}`,
      attempts, seconds,
      stones: p.steppingStones.length,
    });
  }
  return { jobs, failures };
}

export function applyRebuild({ sequence, meta, jobs, results }) {
  const puzzles = [...sequence.puzzles];
  const nextMeta = { ...meta };
  const rebuilt = [];
  const failures = [];
  for (const job of jobs) {
    const found = results.get(job.theme.id);
    if (found.failure) {
      failures.push({ id: job.id, themeId: job.theme.id, reason: found.failure });
      continue;
    }
    const chosen = [...found.candidates].sort((a, b) =>
      Math.abs(a.steppingStones.length - job.stones) - Math.abs(b.steppingStones.length - job.stones)
      || b.score - a.score)[0];
    const at = puzzles.findIndex((p) => p.id === job.id);
    const puzzle = { id: job.id, ...toPuzzle({ theme: job.theme, chosen }) };
    puzzles[at] = puzzle;
    nextMeta[job.id] = metaFor(job.theme, puzzle, (meta[job.id].rebuilds ?? 0) + 1);
    rebuilt.push(job.id);
  }
  return { sequence: { ...sequence, puzzles }, meta: nextMeta, rebuilt, failures };
}

// The review report for the listed boards: place, theme, answers, stones and traceable decoys.
export function boardReport(sequence, ids, dictionaryWords, themesById) {
  const lines = [];
  sequence.puzzles.forEach((p, i) => {
    if (!ids.includes(p.id)) return;
    const theme = themesById.get(p.themeId);
    const known = new Set([...p.answers.map((a) => a.word), ...theme.answers]);
    const decoys = tracedDictionaryWords(p.grid, dictionaryWords, known);
    const day = Math.floor(i / sequence.setSize) + 1;
    const position = (i % sequence.setSize) + 1;
    lines.push(`${p.id} [day ${day}, board ${position}] ${p.themeId}${p.obscure ? ' (obscure)' : ''} difficulty ${p.difficulty.toFixed(2)}`);
    lines.push(`  answers: ${p.answers.map((a) => a.word).join(' ')}`);
    lines.push(`  stepping stones: ${p.steppingStones.join(' ')}`);
    if (decoys.length) lines.push(`  dictionary decoys (review): ${decoys.join(' ')}`);
  });
  return lines.join('\n');
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/build-sequence.test.js tests/build-drop.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/build-sequence.mjs tools/build-drop.mjs tests/build-sequence.test.js
git commit -m "builder: select, order and rebuild-in-place for the daily-set sequence" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Builder command, sequence validation test, docs

**Files:**
- Modify: `tools/build-sequence.mjs` (append the CLI)
- Modify: `package.json` (add the script)
- Create: `tests/sequence-file.test.js`
- Modify: `tests/build-sequence.test.js` (append args tests)
- Modify: `README.md` ("Adding content" section)

**Interfaces:**
- Consumes:
  - Task 5's functions
  - `earlierUse`, `runInWorkers`, `runSequential`, `DEFAULT_ATTEMPTS`, `DEFAULT_SECONDS` from `tools/build-drop.mjs`
  - `loadRanks`, `loadBoardBlocklist`, `tallyLine`
- Produces:
  - `parseSequenceArgs(argv): { start, fresh, rebuild: string[], attempts, seconds, workers, content, out }`
  - `npm run build:sequence`
  - The files `drops/sequence.json` and `drops/sequence.meta.json`.

- [ ] **Step 1: Write the failing args tests**

Append to `tests/build-sequence.test.js` (and add `parseSequenceArgs` to its import):

```js
test('parseSequenceArgs reads flags, lists and numbers', () => {
  const a = parseSequenceArgs(['--start', '2026-11-10', '--fresh', '--rebuild', 'birds,trees', '--workers', '4']);
  assert.equal(a.start, '2026-11-10');
  assert.equal(a.fresh, true);
  assert.deepEqual(a.rebuild, ['birds', 'trees']);
  assert.equal(a.workers, 4);
  assert.equal(a.out, 'drops');
  const b = parseSequenceArgs([]);
  assert.equal(b.fresh, false);
  assert.deepEqual(b.rebuild, []);
  assert.equal(b.start, null);
});

test('parseSequenceArgs rejects bad dates, numbers and unknown flags', () => {
  assert.throws(() => parseSequenceArgs(['--start', '10/11/2026']), /YYYY-MM-DD/);
  assert.throws(() => parseSequenceArgs(['--workers', '0']), /positive integer/);
  assert.throws(() => parseSequenceArgs(['--colour', 'blue']), /Unknown/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/build-sequence.test.js`
Expected: FAIL. `parseSequenceArgs` is not exported.

- [ ] **Step 3: Write the CLI**

Add these imports at the top of `tools/build-sequence.mjs`, merging with the existing ones:

```js
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import { loadRanks } from './lib/familiarity.js';
import { tallyLine } from './lib/variety.js';
import { loadBoardBlocklist } from './lib/blocklist.js';
import {
  earlierUse, runInWorkers, runSequential, DEFAULT_ATTEMPTS, DEFAULT_SECONDS,
} from './build-drop.mjs';
```

(`eligibleAnswers` and `planDrop`/`tracedDictionaryWords` are already imported. Combine imports from the same module into one statement.)

Append:

```js
const USAGE = `Usage: build-sequence [--start YYYY-MM-DD] [--fresh] [--rebuild id,id] [--attempts N] [--seconds N] [--workers N] [--content dir] [--out dir]
  With no <out>/sequence.json, or with --fresh, builds all ${SEQUENCE_LENGTH} boards (--start required).
  Otherwise keeps every board in place and rebuilds only themes named with --rebuild or whose
  content changed; --start then just moves the start date.`;

export function parseSequenceArgs(argv) {
  const args = {
    start: null, fresh: false, rebuild: [], attempts: DEFAULT_ATTEMPTS, seconds: DEFAULT_SECONDS,
    workers: Math.max(1, os.availableParallelism() - 2), content: 'content/themes', out: 'drops',
  };
  const numeric = ['attempts', 'seconds', 'workers'];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'fresh') { args.fresh = true; continue; }
    const value = argv[++i];
    if (![...numeric, 'start', 'rebuild', 'content', 'out'].includes(key) || value === undefined) {
      throw new Error(`Unknown or incomplete argument: ${argv[i - 1]}\n${USAGE}`);
    }
    if (numeric.includes(key)) {
      if (!/^[1-9]\d*$/.test(value)) throw new Error(`--${key} must be a positive integer, got "${value}"\n${USAGE}`);
      args[key] = Number(value);
    } else if (key === 'start') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`--start must be YYYY-MM-DD, got "${value}"`);
      args.start = value;
    } else if (key === 'rebuild') {
      args.rebuild = value.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      args[key] = value;
    }
  }
  return args;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
}

async function main() {
  const args = parseSequenceArgs(process.argv.slice(2));
  const files = (await readdir(args.content)).filter((f) => f.endsWith('.json')).sort();
  const themes = await Promise.all(files.map((f) => readJson(join(args.content, f))));
  const themesById = new Map(themes.map((t) => [t.id, t]));
  const index = await readJson('drops/index.json', []);
  const earlier = earlierUse(await Promise.all(index.map((id) => readJson(`drops/${id}.json`))));
  const dictionaryWords = (await readFile('data/words.txt', 'utf8'))
    .split('\n').map((w) => w.trim().toUpperCase()).filter(Boolean);
  const ranks = await loadRanks();
  const blockset = await loadBoardBlocklist();
  const run = (jobs) => (args.workers > 1 ? runInWorkers : runSequential)(jobs, { blockset, workers: args.workers });
  const file = join(args.out, 'sequence.json');
  const metaFile = join(args.out, 'sequence.meta.json');
  const existing = args.fresh ? null : await readJson(file, null);
  const started = performance.now();
  let sequence;
  let meta;
  const lines = [];

  if (!existing) {
    if (!args.start) throw new Error(`--start is required for a full build\n${USAGE}`);
    const { jobs, failures, rejections } = sequenceJobs({ themes, ranks, earlier });
    const results = await run(jobs.map((j) => ({ ...j, dropId: SEED, attempts: args.attempts, seconds: args.seconds })));
    const successes = [];
    for (const job of jobs) {
      const found = results.get(job.theme.id).result;
      if (found.failure) failures.push({ themeId: job.theme.id, reason: found.failure });
      else successes.push({ ...job, candidates: found.candidates });
    }
    ({ sequence, meta } = assembleSequence({ start: args.start, selected: selectSequence(successes) }));
    lines.push(`Sequence: ${sequence.puzzles.length} boards from ${successes.length} buildable themes, start ${sequence.start}`);
    lines.push(`Theme words per board: ${tallyLine(sequence.puzzles.map((p) => p.answers.length - 1))}`);
    lines.push(`Stepping stones per board: ${tallyLine(sequence.puzzles.map((p) => p.steppingStones.length))}`);
    if (failures.length) lines.push('Skipped themes:', ...failures.map((f) => `  ${f.themeId}: ${f.reason}`));
    if (rejections.length) lines.push('Familiarity rejections:', ...rejections.map((r) => `  ${r.themeId}: ${r.words.join(' ')}`));
    lines.push(boardReport(sequence, sequence.puzzles.map((p) => p.id), dictionaryWords, themesById));
  } else {
    const existingMeta = await readJson(metaFile);
    const { jobs, failures } = rebuildJobs({
      sequence: existing, meta: existingMeta, themes, ranks, earlier,
      names: args.rebuild, attempts: args.attempts, seconds: args.seconds,
    });
    const results = jobs.length ? await run(jobs) : new Map();
    const applied = applyRebuild({ sequence: existing, meta: existingMeta, jobs, results: new Map([...results].map(([k, v]) => [k, v.result])) });
    failures.push(...applied.failures);
    if (failures.length) {
      console.error(['Rebuild failed; nothing written:', ...failures.map((f) => `  ${f.themeId}${f.id ? ` (${f.id})` : ''}: ${f.reason}`)].join('\n'));
      process.exit(1);
    }
    sequence = { ...applied.sequence, start: args.start ?? existing.start };
    meta = applied.meta;
    lines.push(`Rebuilt ${applied.rebuilt.length} board(s); start ${sequence.start}`);
    lines.push(boardReport(sequence, applied.rebuilt, dictionaryWords, themesById));
  }

  lines.unshift(`Wall time ${((performance.now() - started) / 1000).toFixed(1)}s, ${args.workers} worker(s)`);
  console.log(lines.join('\n'));
  await mkdir(args.out, { recursive: true });
  await writeFile(file, JSON.stringify(sequence));
  await writeFile(metaFile, JSON.stringify(meta, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
```

In `package.json` `scripts`, add after `build:drop`:

```json
    "build:sequence": "node tools/build-sequence.mjs"
```

(Add a comma to the `build:drop` line.)

- [ ] **Step 4: Write the sequence validation test**

Create `tests/sequence-file.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyPuzzle } from '../tools/lib/layout.js';
import { checkPuzzle } from '../tools/lib/checks.js';
import { loadBoardBlocklist, offensiveWordsOn } from '../tools/lib/blocklist.js';
import { HOLIDAY_THEMES, SEQUENCE_LENGTH, SET_SIZE, sequenceId } from '../tools/build-sequence.mjs';

async function readJson(path) {
  try {
    return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// The shipped sequence must always be fully validated: this file may never mark a test todo or
// skip, so a stale sequence can't ship behind a pending test.
test('the sequence test is never marked todo or skip', async () => {
  const source = await readFile(new URL(import.meta.url), 'utf8');
  const flags = ['to' + 'do', 'sk' + 'ip'].join('|');
  const flagged = source.match(new RegExp(String.raw`\b(${flags})\s*:|\.(${flags})\s*\(`, 'g')) ?? [];
  assert.deepEqual(flagged, []);
});

const seq = await readJson('../drops/sequence.json');
const meta = await readJson('../drops/sequence.meta.json');
const blocklist = await loadBoardBlocklist();

if (!seq) {
  test('sequence: not built yet', () => assert.ok(true));
} else {
  test('the sequence file is valid', () => {
    assert.equal(seq.setSize, SET_SIZE);
    assert.match(seq.start, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(seq.puzzles.length, SEQUENCE_LENGTH);
    assert.deepEqual(seq.puzzles.map((p) => p.id), seq.puzzles.map((_, i) => sequenceId(i)));
    const themes = seq.puzzles.map((p) => p.themeId);
    assert.equal(new Set(themes).size, themes.length, 'one board per theme');
    for (const h of HOLIDAY_THEMES) assert.ok(!themes.includes(h), `${h} is a holiday theme`);
    for (let d = 0; d < seq.puzzles.length / SET_SIZE; d++) {
      const day = seq.puzzles.slice(d * SET_SIZE, (d + 1) * SET_SIZE);
      assert.ok(day.filter((p) => p.obscure).length <= 1, `day ${d + 1} has more than one obscure board`);
    }
  });

  test('every sequence board passes the board checks', () => {
    for (const p of seq.puzzles) {
      assert.ok(!p.id.includes(p.themeId), `${p.id} reveals its theme`);
      assert.ok(verifyPuzzle(p), `${p.id} fails verifyPuzzle`);
      const m = meta[p.id];
      assert.ok(m, `${p.id} has meta`);
      assert.equal(m.themeId, p.themeId);
      const result = checkPuzzle(p, {
        answers: [...p.answers.map((a) => a.word), ...m.checkedLong],
        recognized: m.stoneCandidates,
      });
      assert.equal(result.ok, true, `${p.id}: ${result.reason}`);
      assert.deepEqual(result.steppingStones, p.steppingStones, `${p.id} stepping stones`);
      assert.deepEqual(offensiveWordsOn(p.grid, blocklist, p.answers), [], `${p.id} spells a blocked word`);
      for (const a of p.answers.filter((x) => !x.isSpangram)) {
        assert.ok(/^[A-Z]{5,10}$/.test(a.word), `${p.id}: ${a.word} must be 5-10 letters`);
      }
    }
  });
}
```

- [ ] **Step 5: Document the builder in `README.md`**

In the "Adding content" section, replace its first paragraph and the `build:drop` example with:

```markdown
Theme content lives in `content/themes/`. Puzzles are built ahead of time and committed. The daily sets come from `drops/sequence.json`: 366 boards (one per theme, holiday themes left out), six a day in a fixed order that everyone shares, cycling every 61 days. Earlier monthly drops in `drops/` stay playable in free play.

    npm run build:sequence -- --start YYYY-MM-DD

builds all 366 boards. Once the file exists, the same command keeps every board in place and rebuilds only themes whose content changed, plus any named with `--rebuild id,id`. `--start` on its own just moves the start date. Add `--fresh` to rebuild everything, or `--out <dir>` for a trial build.

Before the start date, or if `drops/sequence.json` is missing, the game falls back to the monthly drops:

    npm run build:drop -- --id YYYY-MM --start YYYY-MM-DD
```

Also, in the opening bullets of `README.md`, change the "More puzzles" bullet to:

```markdown
- **Daily set:** everyone gets the same six puzzles each day, in the same order. After those, **New puzzle** keeps going with free play. Every puzzle has a link (`?id=<id>`) you can share.
```

and remove the "Daily puzzle" bullet above it.

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS. With no sequence file, `tests/sequence-file.test.js` reports "sequence: not built yet".

- [ ] **Step 7: Smoke-test the CLI on a trial directory**

Run, from the repo root:

```bash
mkdir -p "$TMPDIR/seq-themes" && cp content/themes/{birds,breads,cheeses,herbs,trees,nuts,spices,pasta,metals,gemstones,flowers,dog-breeds}.json "$TMPDIR/seq-themes/" 2>/dev/null; ls "$TMPDIR/seq-themes" | wc -l
node tools/build-sequence.mjs --start 2026-11-10 --content "$TMPDIR/seq-themes" --out "$TMPDIR/seq-out"
```

Expected: exits with `Only N themes produced a usable board; the sequence needs 366.` This proves the full-build path runs end to end and fails loudly. Don't write to `drops/`.

- [ ] **Step 8: Commit**

```bash
git add tools/build-sequence.mjs package.json tests/sequence-file.test.js tests/build-sequence.test.js README.md
git commit -m "builder: build:sequence command and validation of drops/sequence.json" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Build and review the 366 boards (controller, not a subagent)

This task is run by the session controller, because it involves long builds, parallel review agents and editorial judgment.

- [ ] **Step 1: Full build** (about 30–60 minutes; run in the background)

```bash
npm run build:sequence -- --start 2026-11-20 > "<scratchpad>/sequence-build.txt" 2>&1
```

The start date is provisional; Task 9 sets the real one. Read the header: board count, word-count and stone tallies, skipped themes. If the build fails with `Only N themes…`, fix or replace the skipped themes (as in the earlier "make themes buildable" work), then rerun.

- [ ] **Step 2: Decoy review, round 1.** Dispatch about 8 read-only editor agents in parallel, each covering 46 consecutive boards of the report. Use the same brief as the November reviews:
  - flag on-theme decoys missing from `recognized`, as SERIOUS or MINOR
  - flag off-theme stepping stones
  - skip words nested in an answer or the spangram, and plurals of stepping stones

- [ ] **Step 3: Apply fixes.** Add the flagged words to each theme's `recognized` list, keeping the one-line-per-key file format. Remove off-theme stones from `recognized`, provided each theme still has at least 8 four- and five-letter words. Run `node --test tests/content.test.js`, then commit:

```bash
git add content/themes && git commit -m "content: recognize on-theme decoys from the sequence review" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Locked rebuild of the changed themes only**

```bash
npm run build:sequence > "<scratchpad>/sequence-rebuild-1.txt" 2>&1
```

The report lists only the rebuilt boards. Review just those, as in Step 2, with one agent per 46 boards. Repeat Steps 3–4 until a round finds no SERIOUS issue. MINOR finds go into content without another rebuild.

- [ ] **Step 5: Validate and commit**

Run: `npm test`
Expected: PASS, including "the sequence file is valid" and "every sequence board passes the board checks".

```bash
git add drops/sequence.json drops/sequence.meta.json && git commit -m "sequence: 366 boards for the daily sets" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Browser verification (controller)

Use the built-in browser with the `unstranded` preview server. To fake the date, overwrite the page with a `Date` shim and re-import `main.js`. This is the same technique used for the November drop:

```js
localStorage.clear();
const html = await fetch('/index.html').then((r) => r.text());
const shim = `<script>(()=>{const R=Date,o=new R('DATE_HERE T12:00:00'.replace(' ','')).getTime()-R.now();class F extends R{constructor(...a){a.length?super(...a):super(R.now()+o)}static now(){return R.now()+o}}window.Date=F;})()</script>`;
document.open(); document.write(html.replace('<head>', '<head>' + shim)); document.close();
await new Promise((r) => setTimeout(r, 500));
await import('/js/main.js?fresh=' + Math.random());
```

Replace `DATE_HERE` with each date below. Check every result with `read_page` or `get_page_text`, plus a screenshot for the label.

- [ ] **Step 1: Start date.** The board is `seq-001`. The label reads `TODAY 1 OF 6`. Pressing New puzzle five times shows set boards 2–6 in file order, with the label going to `TODAY 6 OF 6`.
- [ ] **Step 2: The sixth New puzzle.** It opens a free-play board, the message line reads `That's today's 6. Now it's free play.`, and the board's id is not in the first 180 boards (`seq-001`–`seq-180`). Pressing New puzzle 10 more times never shows an id in `seq-001`–`seq-180`, and never shows the message again.
- [ ] **Step 3: Links.** `?id=seq-010` (day 2) falls back to today's daily. `?id=seq-300` opens.
- [ ] **Step 4: The day before the start.** The game behaves as the November drop does: the daily comes from `drops/2026-11.json`, and there's no set label.
- [ ] **Step 5: Day 61 (start + 61 days).** The daily is the first board of pass 1, which is not `seq-001`. No console errors.
- [ ] **Step 6: Phone width.** `resize_window` with the mobile preset: the free-play message fits on one line without being cut off. If it is cut off, shorten `FREE_PLAY_NOTE` in `js/main.js`, commit, and recheck. Reset with the `desktop` preset when finished.

---

### Task 9: Ship on push day (controller)

- [ ] **Step 1: Set the real start date** to the day the user pushes (this is a locked rebuild with no changes):

```bash
npm run build:sequence -- --start YYYY-MM-DD
```

Expected: `Rebuilt 0 board(s); start YYYY-MM-DD`.

- [ ] **Step 2: Test and commit**

Run: `npm test`. Expected: PASS.

```bash
git add drops/sequence.json && git commit -m "sequence: start the daily sets on YYYY-MM-DD" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Merge and package.** Fast-forward `main` to `feature/daily-sets`. Rebuild `dist/unstranded-itch.zip` with the same layout as before (`index.html`, `css/`, `js/`, `data/`, `drops/`), which now includes `drops/sequence.json`. Give the user `git push origin main` to run themselves, and ask them to upload the zip to itch.io.
