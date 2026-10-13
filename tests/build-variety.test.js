import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDrop, buildDropParallel, parseArgs, planDrop, searchTheme, selectBoards } from '../tools/build-drop.mjs';
import { feasibleCounts } from '../tools/lib/variety.js';
import { checkPuzzle } from '../tools/lib/checks.js';

const words = (s) => s.split(' ');

// Themes with 5-letter answers as well as longer ones, so boards of several sizes are possible.
const VARIED = [
  {
    id: 'birds', clue: 'Feathered friends', spangram: 'FEATHERS', obscure: false,
    answers: words('PELICAN FLAMINGO CORMORANT PARAKEET OSTRICH PHEASANT SPARROW PENGUIN MAGPIE BUZZARD SWALLOW STARLING ROBIN EAGLE FINCH HERON STORK RAVEN GOOSE QUAIL'),
    recognized: words('WREN DOVE HAWK CROW LARK KITE SWAN DUCK TERN GULL RHEA IBIS ALBATROSS VULTURE PIGEON'),
  },
  {
    id: 'fruits', clue: 'Bowl of sweetness', spangram: 'FRUITBOWL', obscure: false,
    answers: words('BANANA ORANGE CHERRY APRICOT PINEAPPLE STRAWBERRY BLUEBERRY RASPBERRY MANDARIN PAPAYA NECTARINE LEMON GRAPE MANGO PEACH MELON GUAVA APPLE OLIVE'),
    recognized: words('PEAR PLUM LIME KIWI DATE FIGS SLOE UGLI COCONUT POMEGRANATE GRAPEFRUIT TANGERINE'),
  },
  {
    id: 'gems', clue: 'Treasure from the ground', spangram: 'GEMSTONE', obscure: false,
    answers: words('DIAMOND EMERALD SAPPHIRE AMETHYST GARNET TURQUOISE PERIDOT CITRINE JASPER MALACHITE PEARL AGATE TOPAZ BERYL AMBER CORAL LAPIS'),
    recognized: words('RUBY OPAL JADE ONYX SARD MICA GOLD RING SPINEL QUARTZ ZIRCON'),
  },
  {
    id: 'trees', clue: 'Standing tall', spangram: 'WOODLAND', obscure: true,
    answers: words('SYCAMORE CHESTNUT HAWTHORN MAHOGANY SEQUOIA REDWOOD CYPRESS WILLOW HEMLOCK JUNIPER SPRUCE POPLAR BIRCH ASPEN MAPLE ALDER BEECH LARCH CEDAR'),
    recognized: words('TEAK PALM PINE YEWS OAKS ELMS FIRS LIME'),
  },
];
const ranks = new Map(VARIED.flatMap((t) => t.answers).map((w) => [w, 1]));
const OPTS = {
  dropId: '2026-10', startDate: '2026-10-09', count: 4, dailies: 2, attempts: 200, seconds: 60,
  themes: VARIED, ranks,
};
let cached = null;
const result = () => (cached ??= buildDrop(OPTS));
const wordCount = (p) => p.answers.length - 1;

test('planDrop gives every theme a feasible target and spreads the targets', () => {
  const { jobs, failures } = planDrop(OPTS);
  assert.deepEqual(jobs.map((j) => j.theme.id), ['birds', 'fruits', 'gems', 'trees']);
  for (const j of jobs) {
    assert.deepEqual(j.feasible, feasibleCounts(j.theme.spangram, j.eligible));
    assert.ok(j.feasible.includes(j.target));
  }
  assert.equal(new Set(jobs.map((j) => j.target)).size, 4, 'four themes, four different sizes');
  assert.deepEqual(failures, []);
  const again = planDrop({ ...OPTS, themes: [...VARIED].reverse() });
  assert.deepEqual(again.jobs.map((j) => j.target), jobs.map((j) => j.target));
  const skipped = planDrop({ ...OPTS, existingDropThemeIds: ['gems'] });
  assert.deepEqual(skipped.jobs.map((j) => j.theme.id), ['birds', 'fruits', 'trees']);
});

test('planDrop reports a theme whose words cannot fill the board', () => {
  const sixes = { ...VARIED[0], id: 'sixes', spangram: 'FEATHERED', answers: words('MAGPIE CANARY PIGEON TOUCAN FALCON OSPREY') };
  const { jobs, failures } = planDrop({ dropId: 'x', themes: [sixes], ranks: new Map(sixes.answers.map((w) => [w, 1])) });
  assert.deepEqual(jobs, []);
  assert.deepEqual(failures, [{ themeId: 'sixes', reason: 'no word set fills the board' }]);
});

test('searchTheme builds boards with exactly the target number of theme words', () => {
  const birds = VARIED[0];
  for (const target of [5, 7]) {
    const found = searchTheme(birds, '2026-10', { attempts: 300, seconds: 60, eligible: birds.answers, target, maxCandidates: 6 });
    assert.equal(found.count, target);
    assert.equal(found.target, target);
    assert.ok(found.candidates.length >= 1);
    for (const c of found.candidates) {
      assert.equal(c.variant.answers.length - 1, target);
      assert.equal(checkPuzzle(c.variant, birds).ok, true);
    }
    // One candidate per stepping-stone count; `best` is the hardest of them.
    const stones = found.candidates.map((c) => c.steppingStones.length);
    assert.deepEqual(stones, [...new Set(stones)].sort());
    assert.equal(found.best.score, Math.max(...found.candidates.map((c) => c.score)));
  }
});

test('searchTheme falls back to the nearest feasible count and says so', () => {
  // Answers of 6-9 letters: only five of them can fill the 39 cells.
  const birds = { ...VARIED[0], spangram: 'FEATHERED', answers: VARIED[0].answers.filter((w) => w.length > 5) };
  const found = searchTheme(birds, '2026-10', { attempts: 300, seconds: 60, eligible: birds.answers, target: 8, maxCandidates: 2 });
  assert.equal(found.target, 8);
  assert.equal(found.count, 5);
  assert.equal(found.best.variant.answers.length - 1, 5);
});

test('a drop has boards of varied sizes, each at its target unless reported as a fallback', () => {
  const { drop, report, variety } = result();
  const { jobs } = planDrop(OPTS);
  const fellBack = new Map(variety.fallbacks.map((f) => [f.themeId, f]));
  for (const p of drop.puzzles) {
    const { target } = jobs.find((j) => j.theme.id === p.themeId);
    if (fellBack.has(p.themeId)) {
      assert.deepEqual(fellBack.get(p.themeId), { themeId: p.themeId, target, count: wordCount(p) });
      assert.notEqual(wordCount(p), target);
    } else {
      assert.equal(wordCount(p), target);
    }
    for (const a of p.answers.filter((x) => !x.isSpangram)) assert.match(a.word, /^[A-Z]{5,10}$/);
  }
  assert.ok(new Set(drop.puzzles.map(wordCount)).size >= 3, 'at least three different board sizes');
  assert.deepEqual(variety.wordCounts, drop.puzzles.map(wordCount).sort());
  assert.deepEqual(variety.stoneCounts, drop.puzzles.map((p) => p.steppingStones.length).sort());
  assert.match(report, /\nTheme words per board: (\d×\d+ ?)+\n/);
  assert.match(report, /\nStepping stones per board: (\d×\d+ ?)+\n/);
  assert.match(report, /\nFell back from target word count: /);
});

test('a varied drop passes the checks from its meta snapshot and is the same in parallel', async () => {
  const { drop, meta, report } = result();
  for (const p of drop.puzzles) {
    const m = meta[p.id];
    const check = checkPuzzle(p, { answers: [...p.answers.map((a) => a.word), ...m.checkedLong], recognized: m.stoneCandidates });
    assert.equal(check.ok, true);
    assert.deepEqual(check.steppingStones, p.steppingStones);
  }
  const par = await buildDropParallel(OPTS, { workers: 2 });
  assert.equal(JSON.stringify(par.drop), JSON.stringify(drop));
  assert.equal(par.report, report);
});

test('selection balances board sizes before difficulty, and stepping-stone counts after', () => {
  const board = (k, stones, score) => ({
    variant: { grid: [], answers: Array.from({ length: k + 1 }, (_, i) => ({ word: 'X', path: [], isSpangram: i === 0 })) },
    score, steppingStones: Array.from({ length: stones }, (_, i) => `S${i}`),
  });
  // Four hard five-word boards and two easier boards of other sizes.
  const found = {
    a: [board(5, 2, 0.9), board(5, 3, 0.8)], b: [board(5, 2, 0.8), board(5, 4, 0.7)],
    c: [board(5, 2, 0.7)], d: [board(5, 2, 0.6)], e: [board(6, 2, 0.2)], f: [board(7, 2, 0.1), board(7, 5, 0.05)],
  };
  const successes = Object.keys(found).map((id) => ({ theme: { id, obscure: false }, candidates: found[id] }));
  const picked = selectBoards(successes, 4);
  assert.deepEqual(picked.selected.map((s) => s.theme.id), ['a', 'e', 'f', 'b']);
  assert.deepEqual(picked.spares, ['c', 'd']);
  // Stones: e only has a 2-stone board, so a, b and f take their other one.
  assert.deepEqual(picked.selected.map((s) => s.chosen.steppingStones.length), [3, 2, 5, 4]);
});

test('selection still takes at most ten obscure themes while familiar ones remain', () => {
  const board = (score) => ({
    variant: { grid: [], answers: Array.from({ length: 6 }, (_, i) => ({ word: 'X', path: [], isSpangram: i === 0 })) },
    score, steppingStones: ['S1', 'S2'],
  });
  const make = (prefix, n, obscure) => Array.from({ length: n }, (_, i) => ({
    theme: { id: `${prefix}${String(i).padStart(2, '0')}`, obscure }, candidates: [board(0.9 - i / 100)],
  }));
  const picked = selectBoards([...make('o', 12, true), ...make('f', 5, false)], 16);
  assert.equal(picked.selected.filter((s) => s.theme.obscure).length, 11);
  assert.deepEqual(picked.spares, ['o11']);
  const plenty = selectBoards([...make('o', 12, true), ...make('f', 9, false)], 16);
  assert.equal(plenty.selected.filter((s) => s.theme.obscure).length, 10);
  assert.deepEqual(plenty.spares, ['f06', 'f07', 'f08', 'o10', 'o11']);
});

test('parseArgs takes an output directory, drops/ by default', () => {
  assert.equal(parseArgs(['--id', 'x', '--start', '2026-10-08']).out, 'drops');
  assert.equal(parseArgs(['--id', 'x', '--start', '2026-10-08', '--out', 'tmp/trial']).out, 'tmp/trial');
});
