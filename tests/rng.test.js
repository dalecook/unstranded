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
