import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDrops, isReleased, dailyFor, getPuzzle, randomPuzzle, releasedPuzzles,
} from '../js/drops.js';
import { hashString } from '../js/rng.js';

const mk = (id) => ({ id, themeId: 't', clue: 'c', obscure: false, grid: [], answers: [], steppingStones: [], difficulty: 1 });
const DROPS = [
  {
    id: '2026-09',
    puzzles: ['a1', 'a2', 'a3', 'a4', 'a5'].map(mk),
    schedule: { '2026-09-01': 'a1', '2026-09-02': 'a2', '2026-09-03': 'a3' },
    library: ['a4', 'a5'],
  },
  {
    id: '2026-10',
    puzzles: ['b1', 'b2', 'b3'].map(mk),
    schedule: { '2026-10-20': 'b1', '2026-10-21': 'b2' },
    library: ['b3'],
  },
];
const TODAY = '2026-10-08';
const none = new Set();

test('loadDrops fetches the index then each drop in order', async () => {
  const urls = [];
  const files = { 'drops/index.json': ['2026-09', '2026-10'], 'drops/2026-09.json': DROPS[0], 'drops/2026-10.json': DROPS[1] };
  const fetchImpl = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => files[url] };
  };
  const drops = await loadDrops(fetchImpl);
  assert.deepEqual(urls, ['drops/index.json', 'drops/2026-09.json', 'drops/2026-10.json']);
  assert.deepEqual(drops.map((d) => d.id), ['2026-09', '2026-10']);
});

test('loadDrops rejects on a failed fetch', async () => {
  await assert.rejects(loadDrops(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});

test('isReleased: scheduled by date, library by drop start', () => {
  assert.equal(isReleased(DROPS, 'a3', TODAY), true);
  assert.equal(isReleased(DROPS, 'a3', '2026-09-03'), true);
  assert.equal(isReleased(DROPS, 'a3', '2026-09-02'), false);
  assert.equal(isReleased(DROPS, 'b1', TODAY), false);
  assert.equal(isReleased(DROPS, 'b1', '2026-10-20'), true);
  assert.equal(isReleased(DROPS, 'a4', TODAY), true);
  assert.equal(isReleased(DROPS, 'a4', '2026-08-31'), false);
  assert.equal(isReleased(DROPS, 'b3', TODAY), false);
  assert.equal(isReleased(DROPS, 'b3', '2026-10-20'), true);
  assert.equal(isReleased(DROPS, 'nope', TODAY), false);
});

test('releasedPuzzles follows index then puzzle order', () => {
  assert.deepEqual(releasedPuzzles(DROPS, TODAY).map((p) => p.id), ['a1', 'a2', 'a3', 'a4', 'a5']);
  assert.deepEqual(
    releasedPuzzles(DROPS, '2026-10-21').map((p) => p.id),
    ['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2', 'b3'],
  );
});

test('dailyFor uses the schedule when it covers today', () => {
  assert.equal(dailyFor(DROPS, '2026-09-02').id, 'a2');
  assert.equal(dailyFor(DROPS, '2026-10-21').id, 'b2');
});

test('dailyFor prefers the latest drop that schedules today', () => {
  const drops = [
    { id: 'x', puzzles: [mk('x1')], schedule: { '2026-10-08': 'x1' }, library: [] },
    { id: 'y', puzzles: [mk('y1')], schedule: { '2026-10-08': 'y1' }, library: [] },
  ];
  assert.equal(dailyFor(drops, '2026-10-08').id, 'y1');
});

test('dailyFor falls back to a deterministic hash pick of released puzzles', () => {
  const released = releasedPuzzles(DROPS, TODAY);
  const expected = released[hashString('daily-' + TODAY) % released.length];
  assert.equal(dailyFor(DROPS, TODAY).id, expected.id);
  assert.equal(dailyFor(DROPS, TODAY).id, dailyFor(DROPS, TODAY).id);
});

test('getPuzzle finds by id or returns null', () => {
  assert.equal(getPuzzle(DROPS, 'b2').id, 'b2');
  assert.equal(getPuzzle(DROPS, 'zzz'), null);
});

test('randomPuzzle never returns unreleased puzzles', () => {
  for (let i = 0; i < 20; i++) {
    const p = randomPuzzle(DROPS, TODAY, { played: none, solved: none, excludeId: null }, () => i / 20);
    assert.ok(!p.id.startsWith('b'), p.id);
  }
});

test("randomPuzzle excludes today's daily and excludeId", () => {
  const daily = dailyFor(DROPS, TODAY).id;
  for (let i = 0; i < 20; i++) {
    const p = randomPuzzle(DROPS, TODAY, { played: none, solved: none, excludeId: 'a4' }, () => i / 20);
    assert.notEqual(p.id, daily);
    assert.notEqual(p.id, 'a4');
  }
});

test('randomPuzzle tiers: unplayed, then unsolved, then all', () => {
  const day = '2026-09-03'; // daily is a3; candidates a1, a2, a4, a5
  const cands = ['a1', 'a2', 'a4', 'a5'];
  const seen = (played, solved) => {
    const ids = new Set();
    for (let i = 0; i < 40; i++) {
      const rand = () => i / 40;
      ids.add(randomPuzzle(DROPS, day, { played: new Set(played), solved: new Set(solved), excludeId: null }, rand).id);
    }
    return [...ids].sort();
  };
  assert.deepEqual(seen(['a1', 'a2'], []), ['a4', 'a5']);
  assert.deepEqual(seen(cands, ['a1', 'a2']), ['a4', 'a5']);
  assert.deepEqual(seen(cands, cands), cands);
});

test('randomPuzzle returns null with no candidates', () => {
  const drops = [{ id: 'x', puzzles: [mk('x1')], schedule: { '2026-10-08': 'x1' }, library: [] }];
  assert.equal(randomPuzzle(drops, TODAY, { played: none, solved: none, excludeId: null }), null);
});

test('dailyFor before any release falls back to the first scheduled puzzle', () => {
  assert.equal(dailyFor(DROPS, '2026-08-31').id, 'a1');
  const later = [DROPS[1], DROPS[0]]; // earliest by date, not index order
  assert.equal(dailyFor(later, '2026-08-31').id, 'a1');
});

test('dailyFor returns null when there are no puzzles', () => {
  assert.equal(dailyFor([], TODAY), null);
  assert.equal(dailyFor([{ id: 'x', puzzles: [], schedule: {}, library: [] }], TODAY), null);
});

test('a drop with an empty schedule never releases its library and does not crash', () => {
  const drops = [{ id: 'x', puzzles: [mk('x1'), mk('x2')], schedule: {}, library: ['x1', 'x2'] }];
  assert.equal(isReleased(drops, 'x1', TODAY), false);
  assert.deepEqual(releasedPuzzles(drops, TODAY), []);
  assert.equal(randomPuzzle(drops, TODAY, { played: none, solved: none, excludeId: null }), null);
  assert.doesNotThrow(() => dailyFor(drops, TODAY));
});
