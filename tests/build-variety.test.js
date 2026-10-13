import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDrop, buildDropParallel, parseArgs, planDrop, searchTheme, selectBoards, searchLimits, enoughCandidates, MAX_CANDIDATES,
} from '../tools/build-drop.mjs';
import { countWordSets, targetCounts, tallyLine } from '../tools/lib/variety.js';
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
    assert.deepEqual(j.feasible, targetCounts(countWordSets(j.theme.spangram, j.eligible)));
    assert.ok(j.feasible.includes(j.target));
  }
  // Counts with too few word sets are not targets, which leaves these themes 5, 6 and 7.
  assert.equal(new Set(jobs.map((j) => j.target)).size, 3, 'four themes, three different sizes');
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
  const planned = drop.puzzles.map((p) => jobs.find((j) => j.theme.id === p.themeId).target);
  assert.deepEqual(variety.planned, planned.sort());
  assert.ok(report.includes(`\nTheme words per board: ${tallyLine(variety.wordCounts)} (planned: ${tallyLine(variety.planned)})\n`));
  assert.match(report, /\nStepping stones per board: (\d×\d+ ?)+\n/);
  assert.match(report, /\nFell back from target word count: .*\nSpares that fell back: /);
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

const ALL_PAIRS = new Set([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].flatMap((a) => [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((b) => a + b)));

test('planDrop targets only word counts with enough distinct word sets', () => {
  // 40 cells. Four 10s is a single set of four; sets of five, six and seven are plentiful.
  const answers = words('AAAAAAAAAA BBBBBBBBBB CCCCCCCCCC DDDDDDDDDD EEEEE FFFFF GGGGG HHHHH IIIII JJJJJ KKKKK');
  const theme = { ...VARIED[0], id: 'thin', answers };
  const ranked = new Map(answers.map((w) => [w, 1]));
  const { jobs } = planDrop({ dropId: 'x', themes: [theme], ranks: ranked });
  const sets = countWordSets(theme.spangram, answers);
  assert.equal(sets.get(4), 1);
  assert.equal(sets.get(8), 0);
  assert.deepEqual(jobs[0].feasible, [5, 6, 7]);
  // A theme with nothing but thin counts still gets them.
  const few = { ...theme, id: 'few', answers: answers.slice(0, 4) };
  const thin = planDrop({ dropId: 'x', themes: [few], ranks: ranked });
  assert.deepEqual(thin.jobs[0].feasible, [4]);
  assert.equal(thin.jobs[0].target, 4);
});

test('searchLimits caps attempts by the word sets on offer and gives up early on a barren count', () => {
  assert.deepEqual(searchLimits(6000, 1000), { cap: 6000, giveUp: 600 });
  assert.deepEqual(searchLimits(6000, 15), { cap: 1500, giveUp: 600 });
  assert.deepEqual(searchLimits(6000, 1), { cap: 100, giveUp: 600 });
  assert.deepEqual(searchLimits(300, 1000), { cap: 300, giveUp: 200 });
  assert.deepEqual(searchLimits(1000, 0), { cap: 0, giveUp: 200 });
});

test('enoughCandidates stops at the maximum, or at twelve boards covering three stone counts', () => {
  assert.equal(enoughCandidates(MAX_CANDIDATES, 1), true);
  assert.equal(enoughCandidates(MAX_CANDIDATES - 1, 2), false);
  assert.equal(enoughCandidates(12, 3), true);
  assert.equal(enoughCandidates(12, 4), true);
  assert.equal(enoughCandidates(11, 4), false);
  assert.equal(enoughCandidates(12, 2), false);
  assert.equal(enoughCandidates(3, 1, 3), true);
});

test('searchTheme leaves a count that yields nothing after the give-up point and tries the next', () => {
  const birds = VARIED[0];
  const found = searchTheme(birds, '2026-10', {
    attempts: 2500, seconds: 600, eligible: birds.answers, target: 6, feasible: [6, 5], blockset: ALL_PAIRS,
  });
  // 250 attempts at six words, then 250 at five: not 2500 each.
  assert.match(found.failure, /^no passing board in 500 attempts/);
  assert.equal(found.capped, false);
});

test('searchTheme does not try a count more often than its word sets justify', () => {
  // Exactly one set of four fills the 40 cells: at most 100 attempts.
  const birds = { ...VARIED[0], answers: words('CORMORANTS PARAKEETED STARLINGED PHEASANTED') };
  const found = searchTheme(birds, '2026-10', {
    attempts: 5000, seconds: 600, eligible: birds.answers, target: 4, blockset: ALL_PAIRS,
  });
  assert.match(found.failure, /^no passing board in 100 attempts/);
});

test('searchTheme stops early once twelve boards cover three stepping-stone counts', () => {
  const birds = VARIED[0];
  const opts = { attempts: 3000, seconds: 600, eligible: birds.answers, target: 6 };
  const found = searchTheme(birds, '2026-10', opts);
  const full = searchTheme(birds, '2026-10', { ...opts, earlyStop: false });
  assert.equal(full.passes, MAX_CANDIDATES);
  assert.ok(full.candidates.length >= 3, 'the fixture reaches three stone counts');
  assert.ok(found.passes >= 12 && found.passes < MAX_CANDIDATES);
  assert.equal(found.candidates.length, 3);
  assert.ok(found.attempts < full.attempts);
});

test('the report lists fallbacks for selected themes and for spares separately', () => {
  const { jobs } = planDrop(OPTS);
  const target = Object.fromEntries(jobs.map((j) => [j.theme.id, j.target]));
  // Every theme comes back one word off its target.
  const off = (id) => (target[id] === 4 ? 5 : target[id] - 1);
  const board = (id, score) => ({
    variant: { grid: Array(48).fill('A'), answers: Array.from({ length: off(id) + 1 }, (_, i) => ({ word: `W${i}`, path: [], isSpangram: i === 0 })) },
    score, steppingStones: ['S1', 'S2'],
  });
  const scores = { birds: 0.9, fruits: 0.8, gems: 0.1, trees: 0.5 };
  const built = buildDrop({
    ...OPTS, count: 3, dailies: 2,
    search: (theme) => ({ candidates: [board(theme.id, scores[theme.id])] }),
  });
  const chosen = built.drop.puzzles.map((p) => p.themeId).sort();
  assert.equal(chosen.length, 3);
  assert.equal(built.spares.length, 1);
  const [spare] = built.spares;
  const arrow = (id) => `${id} (${target[id]}→${off(id)})`;
  assert.deepEqual(built.variety.fallbacks.map((f) => f.themeId), chosen);
  assert.deepEqual(built.variety.spareFallbacks, [{ themeId: spare, target: target[spare], count: off(spare) }]);
  assert.ok(built.report.includes(`\nFell back from target word count: ${chosen.map(arrow).join(' ')}\nSpares that fell back: ${arrow(spare)}\n`));
  assert.deepEqual(built.variety.planned, chosen.map((id) => target[id]).sort());
});
