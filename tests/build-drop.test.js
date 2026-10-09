import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDrop } from '../tools/build-drop.mjs';
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
    existingDropThemeIds: ['gems'],
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
      recognized: m.recognizedShort,
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
    assert.ok(meta[p.id].recognizedShort.length >= p.steppingStones.length);
    assert.ok(meta[p.id].checkedLong.every((w) => w.length >= 6));
    assert.ok(meta[p.id].recognizedShort.every((w) => w.length >= 4 && w.length <= 5));
  }
});

test('themes already used in an existing drop are skipped', () => {
  const { drop } = result();
  assert.ok(!drop.puzzles.some((p) => p.themeId === 'gems'));
  const alt = run({ existingDropThemeIds: ['birds'] });
  assert.equal(alt.drop, null);
  assert.match(alt.report, /FAILED/);
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

test('building is deterministic', () => {
  const again = run();
  assert.equal(JSON.stringify(again.drop), JSON.stringify(result().drop));
  assert.equal(JSON.stringify(again.meta), JSON.stringify(result().meta));
});
