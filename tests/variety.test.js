import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORD_COUNTS, feasibleCounts, assignTargets, fallbackOrder, pickBalanced, spreadStones, tallyLine } from '../tools/lib/variety.js';
import { mulberry32 } from '../js/rng.js';
import { chooseWords } from '../tools/lib/layout.js';

const wordsOf = (...lengths) => lengths.map((n, i) => String.fromCharCode(65 + i).repeat(n));
const tally = (values) => {
  const out = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
};

test('feasibleCounts lists the word counts that can exactly fill the board', () => {
  // Spangram of 8 leaves 40 cells: eight 5s, or four 10s, or mixtures in between.
  const pool = wordsOf(5, 5, 5, 5, 5, 5, 5, 5, 10, 10, 10, 10);
  assert.deepEqual(feasibleCounts('SPANGRAM', pool), [4, 5, 6, 7, 8]);
  assert.deepEqual(feasibleCounts('SPANGRAM', wordsOf(10, 10, 10, 10)), [4]);
  assert.deepEqual(feasibleCounts('SPANGRAM', wordsOf(5, 5, 5, 5, 5, 5, 5, 5)), [8]);
});

test('feasibleCounts respects 5k <= cells <= 10k and the words actually on offer', () => {
  // Spangram of 9 leaves 39 cells: eight words need at least 40, four words at most 40.
  const pool = wordsOf(5, 5, 5, 5, 5, 5, 5, 5, 6, 7, 8, 9, 10, 10, 10, 10);
  assert.deepEqual(feasibleCounts('SPANGRAMS', pool), [4, 5, 6, 7]);
  // 39 cells from sevens and eights only: 7+8+8+8+8.
  assert.deepEqual(feasibleCounts('SPANGRAMS', wordsOf(7, 7, 7, 8, 8, 8, 8)), [5]);
  assert.deepEqual(feasibleCounts('SPANGRAMS', wordsOf(6, 6, 6, 6, 6, 6, 6, 6)), []);
  assert.deepEqual(feasibleCounts('SPANGRAMS', []), []);
});

test('every feasible count has a subset chooseWords finds with exactly that many words', () => {
  const pool = wordsOf(5, 5, 5, 5, 5, 5, 6, 7, 7, 8, 8, 9, 10, 10, 10);
  const theme = { spangram: 'SPANGRAMS', words: pool };
  for (const k of WORD_COUNTS) {
    const words = chooseWords(theme, mulberry32(k), { minCount: k, maxCount: k });
    if (feasibleCounts(theme.spangram, pool).includes(k)) {
      assert.equal(words.length, k);
      assert.equal(words.join('').length, 39);
      assert.equal(new Set(words).size, k);
    } else {
      assert.equal(words, null);
    }
  }
});

test('assignTargets gives every theme a feasible count and spreads them evenly', () => {
  const themes = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, feasible: [4, 5, 6, 7, 8] }));
  const targets = assignTargets(themes, 'drop');
  assert.equal(targets.size, 20);
  assert.deepEqual(tally(targets.values()), { 4: 4, 5: 4, 6: 4, 7: 4, 8: 4 });
});

test('assignTargets places the least flexible themes first', () => {
  const themes = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `wide${i}`, feasible: [4, 5, 6, 7] })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `five${i}`, feasible: [5] })),
  ];
  const targets = assignTargets(themes, 'drop');
  for (let i = 0; i < 4; i++) assert.equal(targets.get(`five${i}`), 5);
  // The flexible themes avoid the count the fixed ones already filled and cover the others.
  const wide = tally(themes.slice(0, 4).map((t) => targets.get(t.id)));
  assert.deepEqual(Object.keys(wide), ['4', '6', '7']);
  for (const t of themes) assert.ok(t.feasible.includes(targets.get(t.id)));
});

test('assignTargets is deterministic, varies with the seed and skips infeasible themes', () => {
  const themes = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, feasible: [5, 6, 7] }));
  themes.push({ id: 'none', feasible: [] });
  const a = assignTargets(themes, '2026-10');
  assert.deepEqual([...assignTargets([...themes].reverse(), '2026-10')].sort(), [...a].sort());
  assert.ok(!a.has('none'));
  const b = assignTargets(themes, '2026-11');
  assert.deepEqual(tally(b.values()), { 5: 4, 6: 4, 7: 4 });
  assert.notDeepEqual([...a].sort(), [...b].sort());
});

test('fallbackOrder tries the target first, then the nearest feasible counts', () => {
  assert.deepEqual(fallbackOrder(6, [4, 5, 6, 7, 8]), [6, 7, 5, 8, 4]);
  assert.deepEqual(fallbackOrder(4, [4, 5, 7]), [4, 5, 7]);
  assert.deepEqual(fallbackOrder(8, [4, 5, 6]), [6, 5, 4]);
  assert.deepEqual(fallbackOrder(5, []), []);
});

test('pickBalanced takes the best-ranked item of the least-used key', () => {
  const ranked = [
    { id: 'a', k: 5 }, { id: 'b', k: 5 }, { id: 'c', k: 5 }, { id: 'd', k: 6 }, { id: 'e', k: 7 }, { id: 'f', k: 6 },
  ];
  const { picked, left } = pickBalanced(ranked, 4, (x) => x.k);
  assert.deepEqual(picked.map((x) => x.id), ['a', 'd', 'e', 'b']);
  assert.deepEqual(left.map((x) => x.id), ['c', 'f']);
});

test('pickBalanced keeps rank order when every key is the same and shares a running tally', () => {
  const same = [{ id: 'a', k: 5 }, { id: 'b', k: 5 }, { id: 'c', k: 5 }];
  assert.deepEqual(pickBalanced(same, 2, (x) => x.k).picked.map((x) => x.id), ['a', 'b']);
  const counts = new Map([[5, 2]]);
  const { picked } = pickBalanced([{ id: 'a', k: 5 }, { id: 'b', k: 6 }], 1, (x) => x.k, counts);
  assert.deepEqual(picked.map((x) => x.id), ['b']);
  assert.deepEqual([...counts].sort(), [[5, 2], [6, 1]]);
  assert.deepEqual(pickBalanced(same, 9, (x) => x.k).left, []);
});

test('spreadStones balances stone counts across themes, preferring harder boards on ties', () => {
  const both = (id) => ({ id, options: [{ stones: 2, score: 0.5 }, { stones: 3, score: 0.4 }] });
  const plan = spreadStones([
    both('a'), both('b'), both('c'), both('d'),
    { id: 'only2', options: [{ stones: 2, score: 0.1 }] },
    { id: 'wide', options: [{ stones: 2, score: 0.9 }, { stones: 4, score: 0.2 }, { stones: 5, score: 0.3 }] },
  ]);
  assert.equal(plan.get('only2'), 2);
  // One theme already has 2, so the two-option themes split 1:3 in favour of 3 ... then 2 again.
  assert.deepEqual(tally(['a', 'b', 'c', 'd'].map((id) => plan.get(id))), { 2: 2, 3: 2 });
  // 4 and 5 are both unused: the harder board wins.
  assert.equal(plan.get('wide'), 5);
  assert.equal(spreadStones([both('x')]).get('x'), 2);
});

test('tallyLine prints counts in key order', () => {
  assert.equal(tallyLine([5, 7, 5, 4, 5]), '4×1 5×3 7×1');
  assert.equal(tallyLine([]), '(none)');
});
