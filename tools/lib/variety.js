// Board variety: pure planning helpers that spread a drop's boards over different numbers of
// theme words and stepping stones. Everything here is deterministic (seeded by the drop id).
import { CELLS } from '../../js/grid.js';
import { hashString } from '../../js/rng.js';

// Theme words per board, spangram excluded. Words are 5-10 letters and the spangram 6-14, so
// the words fill 34-42 cells: fewer than 4 or more than 8 can never fit.
export const WORD_COUNTS = [4, 5, 6, 7, 8];

// A word count is a proper target only when at least this many distinct word sets fill the
// board with it: with fewer, the search keeps laying out the same few sets and rarely passes.
export const MIN_SETS = 15;
// Word sets are counted up to this many (the exact number past it does not matter).
export const SET_CAP = 1000;

// How many distinct sets of exactly k of `words` fill the cells the spangram leaves: Map of
// k -> number of sets (0 when none, at most SET_CAP), for each k in `counts`.
export function countWordSets(spangram, words, counts = WORD_COUNTS) {
  const cells = CELLS - spangram.length;
  const max = Math.max(...counts);
  // ways[k][s]: sets of exactly k words whose lengths total s.
  const ways = Array.from({ length: max + 1 }, () => new Array(cells + 1).fill(0));
  ways[0][0] = 1;
  for (const word of new Set(words)) {
    for (let k = max; k >= 1; k--) {
      for (let s = cells; s >= word.length; s--) {
        ways[k][s] = Math.min(SET_CAP, ways[k][s] + ways[k - 1][s - word.length]);
      }
    }
  }
  return new Map(counts.map((k) => [k, ways[k][cells]]));
}

// The counts k for which some k of `words` exactly fill the cells the spangram leaves. This is
// the exact form of "5k <= cells <= 10k": it also needs the right lengths to be on offer.
export function feasibleCounts(spangram, words, counts = WORD_COUNTS) {
  const sets = countWordSets(spangram, words, counts);
  return counts.filter((k) => sets.get(k) > 0);
}

// The counts worth aiming for, given countWordSets' result: those with at least `min` word
// sets, or, for a theme with none, every count that is possible at all.
export function targetCounts(sets, min = MIN_SETS) {
  const counts = [...sets.keys()].sort((a, b) => a - b);
  const proper = counts.filter((k) => sets.get(k) >= min);
  return proper.length ? proper : counts.filter((k) => sets.get(k) > 0);
}

// Target word count per theme: Map of id -> count for `themes` ({ id, feasible }), leaving out
// themes with no feasible count. Greedy: themes with the fewest feasible counts go first, and
// each takes its least-used feasible count so far, so flexible themes fill the counts the
// constrained ones cannot reach. Ties (in order, and between equally used counts) are settled by
// a hash of the seed and theme id, so a theme is not always given the same size.
export function assignTargets(themes, seed = '') {
  const order = themes
    .filter((t) => t.feasible.length)
    .map((t) => ({ ...t, key: hashString(`${seed}:${t.id}`) }))
    .sort((a, b) => a.feasible.length - b.feasible.length || a.key - b.key || a.id.localeCompare(b.id));
  const used = new Map();
  const targets = new Map();
  for (const t of order) {
    const least = Math.min(...t.feasible.map((k) => used.get(k) ?? 0));
    const options = t.feasible.filter((k) => (used.get(k) ?? 0) === least);
    const k = options[t.key % options.length];
    used.set(k, least + 1);
    targets.set(t.id, k);
  }
  return targets;
}

// The order to try word counts in: the target, then the nearest feasible counts (the larger
// first when two are equally near).
export function fallbackOrder(target, feasible) {
  return [...feasible].sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || b - a);
}

// Pick up to `n` of `ranked` (best first) so the keys stay balanced: each pick is the
// best-ranked item among those whose key has been used least. `used` (Map of key -> picks) is
// updated, so several calls can share one running tally.
export function pickBalanced(ranked, n, keyOf, used = new Map()) {
  const left = [...ranked];
  const picked = [];
  while (picked.length < n && left.length) {
    let at = 0;
    for (let i = 1; i < left.length; i++) {
      if ((used.get(keyOf(left[i])) ?? 0) < (used.get(keyOf(left[at])) ?? 0)) at = i;
    }
    const [item] = left.splice(at, 1);
    used.set(keyOf(item), (used.get(keyOf(item)) ?? 0) + 1);
    picked.push(item);
  }
  return { picked, left };
}

// Stepping-stone count per theme: Map of id -> count for `themes` ({ id, options }, where each
// option is { stones, score } for a board the theme could use). Greedy like assignTargets:
// themes with the fewest options go first and each takes its least-used stone count, the
// higher score (then the fewer stones) winning a tie.
export function spreadStones(themes) {
  const order = [...themes].sort((a, b) => a.options.length - b.options.length || a.id.localeCompare(b.id));
  const used = new Map();
  const plan = new Map();
  for (const t of order) {
    const [choice] = [...t.options].sort((a, b) =>
      (used.get(a.stones) ?? 0) - (used.get(b.stones) ?? 0) || b.score - a.score || a.stones - b.stones);
    used.set(choice.stones, (used.get(choice.stones) ?? 0) + 1);
    plan.set(t.id, choice.stones);
  }
  return plan;
}

// "4×3 5×20 6×12": how many times each value occurs, in value order.
export function tallyLine(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (!counts.size) return '(none)';
  return [...counts].sort((a, b) => a[0] - b[0]).map(([v, n]) => `${v}×${n}`).join(' ');
}
