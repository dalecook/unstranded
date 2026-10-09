import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleDrop } from '../tools/lib/assemble.js';
import { mulberry32 } from '../js/rng.js';

function fakePuzzles(total = 50, obscure = 10) {
  return Array.from({ length: total }, (_, i) => ({
    themeId: `theme-${i}`,
    obscure: i < obscure,
    difficulty: (i * 7) % 10,
  }));
}

function build(puzzles = fakePuzzles(), seed = 1) {
  return assembleDrop({ id: '2026-10', startDate: '2026-10-09', puzzles, rand: mulberry32(seed) });
}

test('schedule has 30 consecutive dates across a month boundary', () => {
  const dates = Object.keys(build().schedule);
  assert.equal(dates.length, 30);
  assert.equal(dates[0], '2026-10-09');
  assert.equal(dates[29], '2026-11-07');
});

test('library holds the other 20 and the partition is exact', () => {
  const drop = build();
  assert.equal(drop.library.length, 20);
  assert.equal(drop.puzzles.length, 50);
  const all = [...Object.values(drop.schedule), ...drop.library];
  assert.equal(new Set(all).size, 50);
  assert.deepEqual([...all].sort(), drop.puzzles.map((p) => p.id).sort());
});

test('at most one obscure daily per 7 consecutive dates, on weekends here', () => {
  const drop = build();
  const byId = new Map(drop.puzzles.map((p) => [p.id, p]));
  const dates = Object.keys(drop.schedule);
  const flags = dates.map((d) => byId.get(drop.schedule[d]).obscure);
  for (let i = 0; i + 7 <= flags.length; i++) {
    assert.ok(flags.slice(i, i + 7).filter(Boolean).length <= 1);
  }
  dates.forEach((d, i) => {
    if (!flags[i]) return;
    const [y, m, day] = d.split('-').map(Number);
    const dow = new Date(y, m - 1, day).getDay();
    assert.ok(dow === 0 || dow === 6, d);
  });
  assert.equal(flags.filter(Boolean).length, 5);
});

test('ids hide the theme', () => {
  const drop = build();
  for (const p of drop.puzzles) {
    assert.match(p.id, /^2026-10-p\d{2}$/);
    assert.ok(!p.id.includes(p.themeId));
  }
});

test('valid with zero obscure puzzles', () => {
  const drop = build(fakePuzzles(50, 0));
  assert.equal(Object.keys(drop.schedule).length, 30);
  assert.equal(drop.library.length, 20);
});

test('throws on too few puzzles', () => {
  assert.throws(() => build(fakePuzzles(29, 2)));
});

test('throws when familiar puzzles cannot fill familiar slots', () => {
  assert.throws(() => build(fakePuzzles(30, 30)));
});

test('deterministic for the same seed', () => {
  assert.deepEqual(build(fakePuzzles(), 5), build(fakePuzzles(), 5));
});

test('familiar slots ascend by difficulty within each 7-day block', () => {
  const drop = build();
  const byId = new Map(drop.puzzles.map((p) => [p.id, p]));
  const ps = Object.values(drop.schedule).map((id) => byId.get(id));
  for (let b = 0; b < ps.length; b += 7) {
    const d = ps.slice(b, b + 7).filter((p) => !p.obscure).map((p) => p.difficulty);
    assert.deepEqual(d, [...d].sort((x, y) => x - y));
  }
});
