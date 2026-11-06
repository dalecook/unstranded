import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { repairJobs, parseRepairArgs } from '../tools/repair-drop.mjs';
import { verifyPuzzle } from '../tools/lib/layout.js';

const sequence = JSON.parse(await readFile(new URL('../drops/sequence.json', import.meta.url), 'utf8'));
// Two boards that pass, used as a small drop.
const [good, other] = sequence.puzzles.filter((p) => verifyPuzzle(p)).slice(0, 2)
  .map((p, i) => ({ ...p, id: `2026-10-p0${i + 1}` }));
// The same board with one letter changed no longer verifies.
const broken = { ...other, grid: other.grid.map((ch, i) => (i === 0 ? (ch === 'Q' ? 'Z' : 'Q') : ch)) };
const themeFor = (p) => ({
  id: p.themeId, clue: p.clue, obscure: p.obscure,
  spangram: p.answers.find((a) => a.isSpangram).word,
  answers: p.answers.filter((a) => !a.isSpangram).map((a) => a.word),
  recognized: [],
});
const ranks = new Map([good, other].flatMap((p) => p.answers.map((a) => [a.word, 1])));
const boardOf = (p) => ({ words: p.answers.filter((a) => !a.isSpangram).map((a) => a.word), grid: p.grid.join('') });

test('repairJobs rebuilds only the boards that fail verifyPuzzle, keeping word and stone counts', () => {
  const drop = { id: '2026-10', puzzles: [good, broken] };
  const meta = { [good.id]: {}, [broken.id]: { rebuilds: 1 } };
  const earlierBoard = { words: ['ELSEWHERE'], grid: 'X'.repeat(48) };
  const { jobs, failures } = repairJobs({
    drop, meta, themes: [themeFor(good), themeFor(other)], ranks,
    boards: { [other.themeId]: [earlierBoard, boardOf(broken)] }, attempts: 10, seconds: 5,
  });
  assert.deepEqual(failures, []);
  assert.deepEqual(jobs.map((j) => j.id), [broken.id]);
  const [job] = jobs;
  assert.equal(job.theme.id, other.themeId);
  assert.equal(job.target, broken.answers.length - 1);
  assert.equal(job.stones, broken.steppingStones.length);
  assert.equal(job.dropId, '2026-10-r2');
  assert.deepEqual(job.avoid, [earlierBoard, boardOf(broken)]);
  assert.equal(job.attempts, 10);
  assert.equal(job.seconds, 5);
});

test('repairJobs also rebuilds named boards and reports a missing theme', () => {
  const drop = { id: '2026-10', puzzles: [good, broken] };
  const { jobs, failures } = repairJobs({
    drop, meta: { [good.id]: {}, [broken.id]: {} }, themes: [themeFor(good)], ranks, ids: [good.id],
  });
  assert.deepEqual(jobs.map((j) => j.id), [good.id]);
  assert.equal(jobs[0].dropId, '2026-10-r1');
  assert.deepEqual(failures, [{ id: broken.id, themeId: other.themeId, reason: 'theme file missing' }]);
});

test('parseRepairArgs reads drop ids and board ids', () => {
  const args = parseRepairArgs(['--drops', '2026-10,2026-11', '--ids', '2026-10-p01', '--attempts', '9000']);
  assert.deepEqual(args.drops, ['2026-10', '2026-11']);
  assert.deepEqual(args.ids, ['2026-10-p01']);
  assert.equal(args.attempts, 9000);
  assert.throws(() => parseRepairArgs(['--bogus', 'x']), /Unknown/);
});
