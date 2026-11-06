import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEQUENCE_LENGTH, SET_SIZE, HOLIDAY_THEMES, contentHash, sequenceId, sequenceJobs, selectSequence,
  assembleSequence, toPuzzle, rebuildJobs, applyRebuild, refreshMeta, refreshBoards, metaFor, boardReport, parseSequenceArgs,
} from '../tools/build-sequence.mjs';
import { searchTheme } from '../tools/build-drop.mjs';

const words = (s) => s.split(' ');
const theme = (id, i = 0, obscure = false) => ({
  id, clue: `clue ${id}`, spangram: 'SPANGRAM', obscure,
  answers: words('ALPHA BRAVO CHARLIE DELTA ECHOES FOXTROT GOLFING HOTELS INDIAN'),
  recognized: words('JULIET KILO LIMA MIKE NOVEMBER OSCAR PAPA').concat([`EXTRA${i}`]),
});
const board = (count, stones, score) => ({
  variant: {
    grid: Array(48).fill('A'),
    answers: [{ word: 'SPANGRAM', path: [], isSpangram: true },
      ...words('ALPHA BRAVO CHARLIE DELTA ECHOES FOXTROT GOLFING HOTELS').slice(0, count).map((w) => ({ word: w, path: [], isSpangram: false }))],
  },
  score,
  steppingStones: Array.from({ length: stones }, (_, k) => `ST${k}`),
});
const success = (id, i, { obscure = false, reused = false } = {}) => ({
  theme: theme(id, i, obscure),
  avoid: reused ? [{ words: ['ALPHA'], grid: 'X' }] : [],
  candidates: [board(4 + (i % 5), 2, i / 1000), board(4 + (i % 5), 3, i / 1000 + 0.0001), board(4 + (i % 5), 4, i / 1000)],
});

test('constants match the spec', () => {
  assert.equal(SEQUENCE_LENGTH, 366);
  assert.equal(SET_SIZE, 6);
  assert.deepEqual(HOLIDAY_THEMES, ['halloween', 'thanksgiving', 'christmas', 'valentines-day', 'easter']);
  assert.equal(sequenceId(0), 'seq-001');
  assert.equal(sequenceId(365), 'seq-366');
});

test('sequenceJobs leaves holiday themes out', () => {
  const birds = {
    clue: 'Feathered friends', spangram: 'FEATHERED', obscure: false,
    answers: words('PELICAN FLAMINGO CORMORANT PARAKEET OSTRICH PHEASANT SPARROW PENGUIN MAGPIE BUZZARD SWALLOW STARLING'),
    recognized: words('ROBIN WREN DOVE HAWK CROW LARK KITE SWAN DUCK GOOSE'),
  };
  const ranks = new Map(birds.answers.map((w) => [w, 1]));
  const { jobs } = sequenceJobs({ themes: [{ ...birds, id: 'easter' }, { ...birds, id: 'birds' }], ranks, earlier: {} });
  assert.deepEqual(jobs.map((j) => j.theme.id), ['birds']);
});

test('selectSequence prefers never-used themes, caps obscure at one per day, and spreads stones', () => {
  const successes = [
    ...Array.from({ length: 10 }, (_, i) => success(`fresh-${i}`, i)),
    ...Array.from({ length: 4 }, (_, i) => success(`old-${i}`, 20 + i, { reused: true })),
    ...Array.from({ length: 4 }, (_, i) => success(`deep-${i}`, 40 + i, { obscure: true })),
  ];
  const picked = selectSequence(successes, { length: 12, setSize: 6 });
  const ids = picked.map((s) => s.theme.id);
  assert.equal(picked.length, 12);
  assert.equal(picked.filter((s) => s.theme.obscure).length, 2);
  for (let i = 0; i < 10; i++) assert.ok(ids.includes(`fresh-${i}`));
  assert.equal(ids.filter((id) => id.startsWith('old-')).length, 0);
  const stones = new Set(picked.map((s) => s.chosen.steppingStones.length));
  assert.ok(stones.size >= 2, 'stepping-stone counts are spread');
});

test('selectSequence fails loudly when too few themes produced a board', () => {
  assert.throws(() => selectSequence([success('a', 1)], { length: 12, setSize: 6 }), /needs 12/);
});

test('assembleSequence numbers the boards in pass-0 order and snapshots meta', () => {
  const selected = selectSequence(Array.from({ length: 12 }, (_, i) => success(`t-${i}`, i, { obscure: i < 2 })), { length: 12, setSize: 6 });
  const { sequence, meta } = assembleSequence({ start: '2026-11-10', selected, setSize: 6 });
  assert.equal(sequence.id, 'sequence');
  assert.equal(sequence.start, '2026-11-10');
  assert.equal(sequence.setSize, 6);
  assert.deepEqual(sequence.puzzles.map((p) => p.id), Array.from({ length: 12 }, (_, i) => sequenceId(i)));
  for (let d = 0; d < 2; d++) {
    assert.ok(sequence.puzzles.slice(d * 6, d * 6 + 6).filter((p) => p.obscure).length <= 1);
  }
  for (const p of sequence.puzzles) {
    assert.ok(!p.id.includes(p.themeId));
    assert.equal(meta[p.id].themeId, p.themeId);
    assert.equal(meta[p.id].rebuilds, 0);
    assert.equal(meta[p.id].contentHash, contentHash(selected.find((s) => s.theme.id === p.themeId).theme));
  }
});

test('metaFor lists unchosen long words to check and short words as stone candidates', () => {
  const t = theme('x');
  const m = metaFor(t, { answers: [{ word: 'SPANGRAM' }, { word: 'ALPHA' }, { word: 'CHARLIE' }] });
  assert.ok(m.checkedLong.includes('FOXTROT') && !m.checkedLong.includes('CHARLIE'));
  assert.ok(m.stoneCandidates.includes('BRAVO') && !m.stoneCandidates.includes('ALPHA'));
});

function built() {
  const selected = selectSequence(Array.from({ length: 12 }, (_, i) => success(`t-${i}`, i)), { length: 12, setSize: 6 });
  return { selected, ...assembleSequence({ start: '2026-11-10', selected, setSize: 6 }) };
}

test('rebuildJobs picks only named and changed themes, avoiding the current board', () => {
  const { sequence, meta, selected } = built();
  const themes = selected.map((s) => s.theme);
  const changed = { ...themes[3], recognized: [...themes[3].recognized, 'ZULU'] };
  const all = themes.map((t) => (t.id === changed.id ? changed : t));
  const ranks = new Map(all.flatMap((t) => t.answers).map((w) => [w, 1]));
  const { jobs, failures } = rebuildJobs({ sequence, meta, themes: all, ranks, earlier: {}, names: [themes[5].id], attempts: 10, seconds: 5 });
  assert.deepEqual(failures, []);
  assert.deepEqual(jobs.map((j) => j.theme.id).sort(), [themes[3].id, themes[5].id].sort());
  for (const job of jobs) {
    const current = sequence.puzzles.find((p) => p.id === job.id);
    assert.equal(job.theme.id, current.themeId);
    assert.equal(job.dropId, 'sequence-r1');
    assert.equal(job.target, current.answers.length - 1);
    assert.equal(job.stones, current.steppingStones.length);
    assert.equal(job.avoid.at(-1).grid, current.grid.join(''));
  }
});

test('rebuildJobs reports unknown names and missing theme files', () => {
  const { sequence, meta, selected } = built();
  const themes = selected.map((s) => s.theme).slice(1);
  const ranks = new Map(themes.flatMap((t) => t.answers).map((w) => [w, 1]));
  const { failures } = rebuildJobs({ sequence, meta, themes, ranks, earlier: {}, names: ['nope'] });
  const reasons = failures.map((f) => f.reason).sort();
  assert.deepEqual(reasons, ['not in the sequence', 'theme file missing']);
});

test('applyRebuild replaces boards in place and leaves the rest untouched', () => {
  const { sequence, meta, selected } = built();
  const target = sequence.puzzles[4];
  const t = selected.find((s) => s.theme.id === target.themeId).theme;
  const jobs = [{ id: target.id, theme: t, stones: target.steppingStones.length }];
  const fresh = board(5, target.steppingStones.length, 0.9);
  fresh.variant.grid = Array(48).fill('B');
  const results = new Map([[t.id, { candidates: [board(5, 9, 0.1), fresh] }]]);
  const out = applyRebuild({ sequence, meta, jobs, results });
  assert.deepEqual(out.rebuilt, [target.id]);
  assert.equal(out.sequence.puzzles[4].id, target.id);
  assert.equal(out.sequence.puzzles[4].grid[0], 'B');
  assert.equal(out.meta[target.id].rebuilds, 1);
  out.sequence.puzzles.forEach((p, i) => { if (i !== 4) assert.equal(p, sequence.puzzles[i]); });
});

test('applyRebuild reports a failed search and keeps the old board', () => {
  const { sequence, meta, selected } = built();
  const target = sequence.puzzles[2];
  const t = selected.find((s) => s.theme.id === target.themeId).theme;
  const out = applyRebuild({
    sequence, meta, jobs: [{ id: target.id, theme: t, stones: 2 }], results: new Map([[t.id, { failure: 'no passing board' }]]),
  });
  assert.deepEqual(out.rebuilt, []);
  assert.equal(out.failures[0].reason, 'no passing board');
  assert.equal(out.sequence.puzzles[2], target);
});

test('boardReport names day and position for each listed board', () => {
  const { sequence, selected } = built();
  const byId = new Map(selected.map((s) => [s.theme.id, s.theme]));
  const report = boardReport(sequence, [sequence.puzzles[7].id], [], byId);
  assert.match(report, /^seq-008 \[day 2, board 2\]/);
  assert.match(report, /answers: SPANGRAM/);
});

test('parseSequenceArgs reads flags, lists and numbers', () => {
  const a = parseSequenceArgs(['--start', '2026-11-10', '--fresh', '--rebuild', 'birds,trees', '--workers', '4']);
  assert.equal(a.start, '2026-11-10');
  assert.equal(a.fresh, true);
  assert.deepEqual(a.rebuild, ['birds', 'trees']);
  assert.equal(a.workers, 4);
  assert.equal(a.out, 'drops');
  const b = parseSequenceArgs([]);
  assert.equal(b.fresh, false);
  assert.deepEqual(b.rebuild, []);
  assert.equal(b.start, null);
});

test('parseSequenceArgs rejects bad dates, numbers and unknown flags', () => {
  assert.throws(() => parseSequenceArgs(['--start', '10/11/2026']), /YYYY-MM-DD/);
  assert.throws(() => parseSequenceArgs(['--workers', '0']), /positive integer/);
  assert.throws(() => parseSequenceArgs(['--colour', 'blue']), /Unknown/);
});

// A real board (the fixture boards above are fake) for the revalidation tests.
const BIRDS = {
  id: 'birds', clue: 'Feathered friends', spangram: 'FEATHERED', obscure: false,
  answers: words('PELICAN FLAMINGO CORMORANT PARAKEET OSTRICH PHEASANT SPARROW PENGUIN MAGPIE BUZZARD SWALLOW STARLING'),
  recognized: words('ROBIN WREN DOVE HAWK CROW LARK KITE SWAN DUCK GOOSE EAGLE FINCH HERON STORK TERN RAVEN ALBATROSS VULTURE PIGEON'),
};
function realBoard() {
  const found = searchTheme(BIRDS, 'real', { attempts: 200, seconds: 20, eligible: BIRDS.answers, target: 6 });
  const { variant, steppingStones } = found.best;
  const puzzle = { id: 'seq-001', ...toPuzzle({ theme: BIRDS, chosen: { variant, steppingStones, score: found.best.score } }) };
  const sequence = { id: 'sequence', start: '2026-11-10', setSize: 6, puzzles: [puzzle] };
  const meta = { [puzzle.id]: metaFor(BIRDS, puzzle) };
  const ranks = new Map(BIRDS.answers.map((w) => [w, 1]));
  return { puzzle, sequence, meta, ranks };
}
const jobsFor = (r, theme, names = []) => rebuildJobs({
  sequence: r.sequence, meta: r.meta, themes: [theme], ranks: r.ranks, earlier: {}, names, attempts: 10, seconds: 5,
});

test('rebuildJobs keeps a board that still passes after a content change', () => {
  const r = realBoard();
  const letters = new Set(r.puzzle.grid);
  const absent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((c) => !letters.has(c));
  assert.ok(absent, 'the test board lacks some letter');
  const changed = { ...BIRDS, recognized: [...BIRDS.recognized, absent.repeat(6)] };
  const { jobs, refreshed, failures } = jobsFor(r, changed);
  assert.deepEqual(failures, []);
  assert.deepEqual(jobs, []);
  assert.deepEqual(refreshed, [{ id: 'seq-001', theme: changed }]);
});

test('rebuildJobs rebuilds a board that a new recognized word now invalidates', () => {
  const r = realBoard();
  const decoy = BIRDS.spangram.slice(0, 6);
  const changed = { ...BIRDS, recognized: [...BIRDS.recognized, decoy] };
  const { jobs, refreshed } = jobsFor(r, changed);
  assert.deepEqual(jobs.map((j) => j.id), ['seq-001']);
  assert.deepEqual(refreshed, []);
});

test('rebuildJobs rebuilds a board whose answer was dropped from the theme', () => {
  const r = realBoard();
  const word = r.puzzle.answers.find((a) => !a.isSpangram).word;
  const changed = { ...BIRDS, answers: BIRDS.answers.filter((w) => w !== word) };
  const { jobs, refreshed } = jobsFor(r, changed);
  assert.deepEqual(jobs.map((j) => j.id), ['seq-001']);
  assert.deepEqual(refreshed, []);
});

test('rebuildJobs always re-searches a named theme, even with unchanged content', () => {
  const r = realBoard();
  const { jobs, refreshed } = jobsFor(r, BIRDS, ['birds']);
  assert.deepEqual(jobs.map((j) => j.id), ['seq-001']);
  assert.deepEqual(refreshed, []);
});

test('refreshMeta updates the hash and checked words, keeps rebuilds, and leaves other ids alone', () => {
  const r = realBoard();
  const changed = { ...BIRDS, recognized: [...BIRDS.recognized, 'QQQQQQ'] };
  const meta = { ...r.meta, 'seq-001': { ...r.meta['seq-001'], rebuilds: 2 }, 'seq-002': { themeId: 'other', rebuilds: 1 } };
  const out = refreshMeta({ meta, sequence: r.sequence, refreshed: [{ id: 'seq-001', theme: changed }] });
  assert.equal(out['seq-001'].contentHash, contentHash(changed));
  assert.notEqual(out['seq-001'].contentHash, meta['seq-001'].contentHash);
  assert.ok(out['seq-001'].checkedLong.includes('QQQQQQ'));
  assert.equal(out['seq-001'].rebuilds, 2);
  assert.equal(out['seq-002'], meta['seq-002']);
  assert.equal(meta['seq-001'].contentHash, contentHash(BIRDS));
});

test('rebuildJobs rebuilds a board whose theme obscure flag changed', () => {
  const r = realBoard();
  const changed = { ...BIRDS, obscure: true };
  const { jobs, refreshed } = jobsFor(r, changed);
  assert.deepEqual(jobs.map((j) => j.id), ['seq-001']);
  assert.deepEqual(refreshed, []);
});

test('rebuildJobs reports a board with no meta entry instead of throwing', () => {
  const r = realBoard();
  const { jobs, failures } = rebuildJobs({
    sequence: r.sequence, meta: {}, themes: [BIRDS], ranks: r.ranks, earlier: {}, names: [], attempts: 10, seconds: 5,
  });
  assert.deepEqual(jobs, []);
  assert.deepEqual(failures, [{ id: 'seq-001', themeId: 'birds', reason: 'missing meta entry' }]);
});

test('refreshBoards updates the clue of refreshed boards and leaves the rest alone', () => {
  const r = realBoard();
  const other = { ...r.puzzle, id: 'seq-002', clue: 'keep me' };
  const sequence = { ...r.sequence, puzzles: [r.puzzle, other] };
  const changed = { ...BIRDS, clue: 'Birds of a feather' };
  const out = refreshBoards({ sequence, refreshed: [{ id: 'seq-001', theme: changed }] });
  assert.equal(out.puzzles[0].clue, 'Birds of a feather');
  assert.equal(out.puzzles[0].grid, r.puzzle.grid);
  assert.equal(out.puzzles[1], other);
  assert.equal(sequence.puzzles[0].clue, 'Feathered friends');
});
