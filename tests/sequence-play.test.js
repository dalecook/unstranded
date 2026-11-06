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
