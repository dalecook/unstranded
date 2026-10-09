import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRanks, isFamiliar, eligibleAnswers, FAMILIAR_RANK, OBSCURE_RANK } from '../tools/lib/familiarity.js';

const ranks = new Map([
  ['EDGE', 120000],
  ['PAST', 120001],
  ['RARE', 300000],
  ['RARER', 300001],
]);

test('constants', () => {
  assert.equal(FAMILIAR_RANK, 120000);
  assert.equal(OBSCURE_RANK, 300000);
});

test('familiar cutoff boundary', () => {
  assert.equal(isFamiliar('EDGE', ranks), true);
  assert.equal(isFamiliar('PAST', ranks), false);
});

test('obscure cutoff boundary', () => {
  assert.equal(isFamiliar('RARE', ranks, { obscure: true }), true);
  assert.equal(isFamiliar('RARER', ranks, { obscure: true }), false);
  assert.equal(isFamiliar('RARE', ranks), false);
});

test('overrides win and missing words are unfamiliar', () => {
  assert.equal(isFamiliar('PINOTNOIR', ranks), false);
  assert.equal(isFamiliar('PINOTNOIR', ranks, { overrides: ['PINOTNOIR'] }), true);
  assert.equal(isFamiliar('PAST', ranks, { overrides: ['PAST'] }), true);
});

test('eligibleAnswers splits answers', () => {
  const theme = { answers: ['EDGE', 'PAST', 'PINOTNOIR'], familiar: ['PINOTNOIR'] };
  const { eligible, rejected } = eligibleAnswers(theme, ranks);
  assert.deepEqual(eligible, ['EDGE', 'PINOTNOIR']);
  assert.deepEqual(rejected, ['PAST']);
  const obs = eligibleAnswers({ answers: ['RARE', 'RARER'], obscure: true }, ranks);
  assert.deepEqual(obs.eligible, ['RARE']);
  assert.deepEqual(obs.rejected, ['RARER']);
});

test('loadRanks downloads, parses, caches', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'fam-'));
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, status: 200, text: async () => 'the\t300\nof\t200\nand\t100\n' };
  };
  const r = await loadRanks({ cacheDir, fetchImpl });
  assert.equal(r.get('THE'), 1);
  assert.equal(r.get('AND'), 3);
  assert.equal(await readFile(join(cacheDir, 'count_1w.txt'), 'utf8'), 'the\t300\nof\t200\nand\t100\n');
  const r2 = await loadRanks({ cacheDir, fetchImpl });
  assert.equal(calls, 1);
  assert.equal(r2.get('OF'), 2);
});

test('loadRanks throws clearly when download fails with no cache', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'fam-'));
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => '' });
  await assert.rejects(loadRanks({ cacheDir, fetchImpl }), /frequency/i);
  const thrower = async () => { throw new Error('offline'); };
  await assert.rejects(loadRanks({ cacheDir, fetchImpl: thrower }), /frequency/i);
});
