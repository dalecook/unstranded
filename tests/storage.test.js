import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadProgress, saveProgress, loadStats, saveStats, applyStart, applyCompletion,
  displayStreak, previousDateKey, isFirstVisit, markVisited,
  markPlayed, markSolved, loadPlayed, loadSolved,
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

test('played and solved round-trip as sets', () => {
  const store = new MemoryStore();
  assert.equal(loadPlayed(store).size, 0);
  markPlayed('2026-10-p01', store);
  markPlayed('2026-10-p02', store);
  markPlayed('2026-10-p01', store);
  markSolved('2026-10-p02', store);
  assert.deepEqual([...loadPlayed(store)].sort(), ['2026-10-p01', '2026-10-p02']);
  assert.deepEqual([...loadSolved(store)], ['2026-10-p02']);
});

test('played and solved keep the 500 most recent', () => {
  const store = new MemoryStore();
  for (let i = 1; i <= 505; i++) { markPlayed('p' + i, store); markSolved('p' + i, store); }
  for (const load of [loadPlayed, loadSolved]) {
    const set = load(store);
    assert.equal(set.size, 500);
    assert.equal(set.has('p5'), false);
    assert.equal(set.has('p6'), true);
    assert.equal(set.has('p505'), true);
  }
});

test('blocked storage never throws for played and solved', () => {
  assert.doesNotThrow(() => { markPlayed('x', throwingStore); markSolved('x', throwingStore); });
  assert.equal(loadPlayed(throwingStore).size, 0);
  assert.equal(loadSolved(throwingStore).size, 0);
});
