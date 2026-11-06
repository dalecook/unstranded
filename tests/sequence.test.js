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
