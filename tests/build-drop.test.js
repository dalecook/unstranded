import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDrop, buildDropParallel, parseArgs, searchTheme, earlierUse, planDrop, DEFAULT_ATTEMPTS, DEFAULT_SECONDS } from '../tools/build-drop.mjs';
import { verifyPuzzle } from '../tools/lib/layout.js';
import { checkPuzzle } from '../tools/lib/checks.js';

const words = (s) => s.split(' ');

const THEMES = [
  {
    id: 'birds', clue: 'Feathered friends', spangram: 'FEATHERED', obscure: false,
    answers: words('PELICAN FLAMINGO CORMORANT PARAKEET OSTRICH PHEASANT SPARROW PENGUIN MAGPIE BUZZARD SWALLOW STARLING'),
    recognized: words('ROBIN WREN DOVE HAWK CROW LARK KITE SWAN DUCK GOOSE EAGLE FINCH HERON STORK TERN RAVEN ALBATROSS VULTURE PIGEON'),
  },
  {
    id: 'gems', clue: 'Treasure from the ground', spangram: 'GEMSTONES', obscure: false,
    answers: words('DIAMOND EMERALD SAPPHIRE AMETHYST GARNET TURQUOISE PERIDOT CITRINE JASPER MALACHITE'),
    recognized: words('RUBY OPAL JADE ONYX PEARL AGATE TOPAZ BERYL AMBER CORAL LAPIS SARD NACRE MICA SPINEL QUARTZ ZIRCON GOLD RING GLEAM CROWN TIARA CARAT REGAL'),
  },
  {
    id: 'fruits', clue: 'Bowl of sweetness', spangram: 'FRUITBOWL', obscure: false,
    answers: words('BANANA ORANGE CHERRY APRICOT PINEAPPLE STRAWBERRY BLUEBERRY RASPBERRY MANDARIN PAPAYA NECTARINE'),
    recognized: words('PEAR PLUM LIME LEMON GRAPE MANGO PEACH MELON GUAVA KIWI DATE COCONUT POMEGRANATE GRAPEFRUIT TANGERINE'),
  },
  {
    id: 'trees', clue: 'Standing tall', spangram: 'WOODLAND', obscure: true,
    answers: words('SYCAMORE CHESTNUT HAWTHORN MAHOGANY SEQUOIA REDWOOD CYPRESS WILLOW HEMLOCK JUNIPER SPRUCE POPLAR'),
    recognized: words('BIRCH ASPEN MAPLE ALDER ELDER BEECH LARCH CEDAR TEAK PALM OLIVE'),
  },
  {
    id: 'tiny', clue: 'Too few words', spangram: 'SMALLSET', obscure: false,
    answers: words('ALPHABET BRAVEST CHARIOTS'),
    recognized: words('ONE TWO THREE FOUR FIVE'),
  },
];

const ranks = new Map(THEMES.flatMap((t) => t.answers).map((w) => [w, 1]));

function run(overrides = {}) {
  return buildDrop({
    dropId: '2026-10',
    startDate: '2026-10-09',
    count: 3,
    dailies: 2,
    attempts: 60,
    seconds: 60,
    themes: THEMES,
    ranks,
    earlier: { dailyThemeIds: ['gems'] },
    dictionaryWords: ['TRIPLET', 'CARDINAL'],
    ...overrides,
  });
}

let cached = null;
function result() {
  if (!cached) cached = run();
  return cached;
}

test('builds a drop whose puzzles all pass the checks', () => {
  const { drop, meta } = result();
  assert.equal(drop.puzzles.length, 3);
  assert.equal(Object.keys(drop.schedule).length, 2);
  assert.equal(drop.library.length, 1);
  for (const p of drop.puzzles) {
    assert.ok(verifyPuzzle(p));
    const m = meta[p.id];
    const check = checkPuzzle(p, {
      answers: [...p.answers.map((a) => a.word), ...m.checkedLong],
      recognized: m.stoneCandidates,
    });
    assert.equal(check.ok, true);
    assert.deepEqual(check.steppingStones, p.steppingStones);
    assert.equal(p.difficulty, Math.round(p.difficulty * 100) / 100);
  }
});

test('puzzle ids are numbered and never reveal the theme', () => {
  const { drop } = result();
  for (const p of drop.puzzles) {
    assert.match(p.id, /^2026-10-p\d{2}$/);
    assert.ok(!p.id.includes(p.themeId));
  }
});

test('meta snapshots the words the checks used', () => {
  const { drop, meta } = result();
  for (const p of drop.puzzles) {
    assert.ok(Array.isArray(meta[p.id].checkedLong));
    assert.ok(meta[p.id].stoneCandidates.length >= p.steppingStones.length);
    assert.ok(meta[p.id].checkedLong.every((w) => w.length >= 6));
    assert.ok(meta[p.id].stoneCandidates.every((w) => w.length >= 4 && w.length <= 5));
  }
});

test('meta lists unchosen 4-5 letter answers among the stepping-stone candidates', () => {
  // BOOK runs 0-6-7-1; the theme also offers IJLMN and STUDY as answers, not chosen here.
  const grid = ['BKQRST', 'OOUVWY', 'CDEFGH', 'IJLMNP', 'DCFEHG', 'JILNPM', 'ECGDHF', 'LINJPM'].join('').split('');
  const row = (r) => Array.from({ length: 6 }, (_, c) => r * 6 + c);
  const paths = [row(2), [0, 6, 7, 1], [2, 3, 4, 5], [8, 9, 10, 11], row(3), row(4), row(5), row(6), row(7)];
  const answers = paths.map((path, k) => ({ word: path.map((c) => grid[c]).join(''), path, isSpangram: k === 0 }));
  const theme = {
    id: 'rows', clue: 'Rows', spangram: 'CDEFGH', obscure: false,
    answers: [...answers.slice(1).map((a) => a.word), 'IJLMN', 'STUDY'], recognized: ['CDEF', 'WXYZ', 'ABCDEFG'],
  };
  const { drop, meta } = buildDrop({
    dropId: '2026-10', startDate: '2026-10-09', count: 1, dailies: 1, themes: [theme],
    ranks: new Map(theme.answers.map((w) => [w, 1])),
    search: () => ({ best: { variant: { grid, answers }, score: 0.5, steppingStones: ['CDEF', 'IJLMN'] } }),
  });
  const [p] = drop.puzzles;
  assert.deepEqual(meta[p.id].stoneCandidates, ['CDEF', 'IJLMN', 'STUDY', 'WXYZ']);
  assert.deepEqual(meta[p.id].checkedLong, ['ABCDEFG']);
  const check = checkPuzzle(p, {
    answers: [...p.answers.map((a) => a.word), ...meta[p.id].checkedLong], recognized: meta[p.id].stoneCandidates,
  });
  assert.deepEqual(check, { ok: true, steppingStones: ['CDEF', 'IJLMN'] });
});

const dailyThemes = (drop) => new Set(drop.puzzles.filter((p) => Object.values(drop.schedule).includes(p.id)).map((p) => p.themeId));

test('dailies come only from themes never used as a daily', () => {
  const { drop } = result();
  assert.ok(!dailyThemes(drop).has('gems'));
  // only trees is left when three themes are spent, short of two dailies.
  assert.throws(() => run({ earlier: { dailyThemeIds: ['gems', 'birds', 'fruits'] } }), /Not enough fresh themes/);
});

test('library puzzles may reuse a theme that was an earlier daily', () => {
  const { drop } = run({ count: 4, dailies: 3, earlier: { dailyThemeIds: ['gems'] } });
  const library = new Set(drop.library);
  const lib = drop.puzzles.filter((p) => library.has(p.id));
  assert.deepEqual(lib.map((p) => p.themeId), ['gems']);
  assert.ok(!dailyThemes(drop).has('gems'));
});

test('a reused theme gets a different word set and grid from its earlier boards', () => {
  const birds = THEMES[0];
  const first = searchTheme(birds, '2026-09', { attempts: 200, seconds: 60, eligible: birds.answers, target: 6 }).best.variant;
  const prior = { words: first.answers.filter((a) => !a.isSpangram).map((a) => a.word), grid: first.grid.join('') };
  const { drop } = run({ count: 4, dailies: 3, earlier: { dailyThemeIds: ['birds'], boards: { birds: [prior] } } });
  const again = drop.puzzles.find((p) => p.themeId === 'birds');
  assert.ok(drop.library.includes(again.id));
  const words = again.answers.filter((a) => !a.isSpangram).map((a) => a.word);
  assert.ok(!words.every((w) => prior.words.includes(w)), 'not contained in the earlier answers');
  assert.notEqual(again.grid.join(''), prior.grid);
  assert.ok(verifyPuzzle(again));
});

test('earlierUse reads daily themes and per-theme boards from earlier drops', () => {
  const answers = [{ word: 'FEATHERED', isSpangram: true }, { word: 'PELICAN', isSpangram: false }];
  const drop = {
    schedule: { '2026-10-09': 'x-p01' },
    puzzles: [
      { id: 'x-p01', themeId: 'birds', grid: ['A', 'B'], answers },
      { id: 'x-p02', themeId: 'gems', grid: ['C'], answers },
    ],
  };
  assert.deepEqual(earlierUse([drop]), {
    dailyThemeIds: ['birds'],
    boards: { birds: [{ words: ['PELICAN'], grid: 'AB' }], gems: [{ words: ['PELICAN'], grid: 'C' }] },
  });
});

test('building fails loudly when there are fewer fresh themes than dailies', () => {
  assert.throws(
    () => run({ count: 3, dailies: 3, earlier: { dailyThemeIds: ['birds', 'gems'] } }),
    /Not enough fresh themes for the dailies: 3 needed, 2 never used/,
  );
  assert.throws(
    () => planDrop({ dropId: 'x', themes: THEMES, ranks, dailies: 5 }),
    /Not enough fresh themes/,
  );
});

test('a theme with too few eligible answers is reported as a failure', () => {
  const { failures, report } = result();
  const tiny = failures.find((f) => f.themeId === 'tiny');
  assert.ok(tiny);
  assert.match(tiny.reason, /eligible/);
  assert.match(report, /tiny/);
});

test('the report lists every puzzle with its stepping stones', () => {
  const { drop, report } = result();
  for (const p of drop.puzzles) {
    assert.ok(report.includes(p.id));
    assert.ok(report.includes(p.themeId));
  }
  assert.match(report, /LIBRARY/);
  assert.match(report, /Spares:/);
});

test('the dictionary decoy list includes words traceable only by crossing over', () => {
  // BOOK runs 0-6-7-1; BKQVRU reads 0-1-2-9-3-8, whose steps 2-9 and 3-8 cross.
  const grid = ['BKQRST', 'OOUVWY', 'CDEFGH', 'IJLMNP', 'DCFEHG', 'JILNPM', 'ECGDHF', 'LINJPM'].join('').split('');
  const row = (r) => Array.from({ length: 6 }, (_, c) => r * 6 + c);
  const paths = [row(2), [0, 6, 7, 1], [2, 3, 4, 5], [8, 9, 10, 11], row(3), row(4), row(5), row(6), row(7)];
  const answers = paths.map((path, k) => ({ word: path.map((c) => grid[c]).join(''), path, isSpangram: k === 0 }));
  const theme = {
    id: 'rows', clue: 'Rows', spangram: 'CDEFGH', obscure: false,
    answers: answers.slice(1).map((a) => a.word), recognized: ['CDEF', 'IJLM'],
  };
  const { report } = buildDrop({
    dropId: '2026-10', startDate: '2026-10-09', count: 1, dailies: 1, themes: [theme],
    ranks: new Map(theme.answers.map((w) => [w, 1])), dictionaryWords: ['BKQVRU', 'BKQRTS', 'CDEFGH'],
    search: () => ({ best: { variant: { grid, answers }, score: 0.5, steppingStones: ['CDEF', 'IJLM'] } }),
  });
  assert.match(report, /dictionary decoys \(review\): BKQVRU\n/);
});

test('building is deterministic', () => {
  const again = run();
  assert.equal(JSON.stringify(again.drop), JSON.stringify(result().drop));
  assert.equal(JSON.stringify(again.meta), JSON.stringify(result().meta));
});

test('parseArgs reads ids and numeric options', () => {
  const a = parseArgs(['--id', '2026-10', '--start', '2026-10-08', '--count', '40', '--seconds', '60']);
  assert.equal(a.id, '2026-10');
  assert.equal(a.count, 40);
  assert.equal(a.seconds, 60);
  assert.equal(a.attempts, DEFAULT_ATTEMPTS);
  assert.equal(parseArgs(['--id', 'x', '--start', '2026-10-08']).seconds, DEFAULT_SECONDS);
});

test('parseArgs rejects non-positive-integer numeric options with usage', () => {
  for (const bad of ['abc', '0', '-5', '1.5', '']) {
    assert.throws(() => parseArgs(['--id', 'x', '--start', '2026-10-08', '--count', bad]), /Usage/, bad);
  }
});

test('parallel workers produce the same drop as the sequential build', async () => {
  const opts = {
    dropId: '2026-10', startDate: '2026-10-09', count: 3, dailies: 2, attempts: 60, seconds: 60,
    themes: THEMES, ranks, earlier: { dailyThemeIds: ['gems'] }, dictionaryWords: ['TRIPLET', 'CARDINAL'],
  };
  const seq = await buildDropParallel(opts, { workers: 1 });
  const par = await buildDropParallel(opts, { workers: 3 });
  assert.equal(JSON.stringify(par.drop), JSON.stringify(seq.drop));
  assert.equal(JSON.stringify(par.meta), JSON.stringify(seq.meta));
  assert.equal(par.report, seq.report);
  assert.equal(JSON.stringify(par.drop), JSON.stringify(result().drop));
  assert.deepEqual(par.timings.map((t) => t.themeId), ['birds', 'fruits', 'gems', 'trees']);
  assert.ok(par.wallMs >= 0);
});

test('searchTheme stops after collecting maxCandidates passing boards and keeps the hardest', () => {
  const birds = THEMES[0];
  const found = searchTheme(birds, '2026-10', {
    attempts: 500, seconds: 60, eligible: birds.answers, maxCandidates: 3,
  });
  assert.equal(found.passes, 3);
  assert.ok(found.attempts >= 3);
  const { variant, steppingStones } = found.best;
  assert.equal(checkPuzzle(variant, birds).ok, true);
  assert.deepEqual(checkPuzzle(variant, birds).steppingStones, steppingStones);
});

test('searchTheme explains a theme that never yields a board', () => {
  const found = searchTheme(THEMES[0], '2026-10', {
    attempts: 3, seconds: 60, eligible: THEMES[0].answers, maxCandidates: 3,
    // Every letter pair is blocked, so any two neighbouring answers spell one.
    blockset: new Set([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].flatMap((a) => [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((b) => a + b))),
  });
  assert.match(found.failure, /no passing board in 3 attempts \(pruned: .*offensive/);
});
