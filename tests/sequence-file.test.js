import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { passOrder, SEAM_DAYS } from '../js/sequence.js';
import { verifyPuzzle } from '../tools/lib/layout.js';
import { checkPuzzle } from '../tools/lib/checks.js';
import { loadBoardBlocklist, offensiveWordsOn } from '../tools/lib/blocklist.js';
import { HOLIDAY_THEMES, SEQUENCE_LENGTH, SET_SIZE, sequenceId, contentHash } from '../tools/build-sequence.mjs';

async function readJson(path) {
  try {
    return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// The shipped sequence must always be fully validated: this file may never mark a test todo or
// skip, so a stale sequence can't ship behind a pending test.
test('the sequence test is never marked todo or skip', async () => {
  const source = await readFile(new URL(import.meta.url), 'utf8');
  const flags = ['to' + 'do', 'sk' + 'ip'].join('|');
  const flagged = source.match(new RegExp(String.raw`\b(${flags})\s*:|\.(${flags})\s*\(`, 'g')) ?? [];
  assert.deepEqual(flagged, []);
});

const seq = await readJson('../drops/sequence.json');
const meta = await readJson('../drops/sequence.meta.json');
const blocklist = await loadBoardBlocklist();

if (!seq) {
  test('sequence: not built yet', () => assert.ok(true));
} else {
  test('the sequence file is valid', () => {
    assert.equal(seq.setSize, SET_SIZE);
    assert.match(seq.start, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(seq.puzzles.length, SEQUENCE_LENGTH);
    assert.deepEqual(seq.puzzles.map((p) => p.id), seq.puzzles.map((_, i) => sequenceId(i)));
    const themes = seq.puzzles.map((p) => p.themeId);
    assert.equal(new Set(themes).size, themes.length, 'one board per theme');
    for (const h of HOLIDAY_THEMES) assert.ok(!themes.includes(h), `${h} is a holiday theme`);
    for (let d = 0; d < seq.puzzles.length / SET_SIZE; d++) {
      const day = seq.puzzles.slice(d * SET_SIZE, (d + 1) * SET_SIZE);
      assert.ok(day.filter((p) => p.obscure).length <= 1, `day ${d + 1} has more than one obscure board`);
    }
  });

  test('every sequence board passes the board checks', () => {
    for (const p of seq.puzzles) {
      assert.ok(!p.id.includes(p.themeId), `${p.id} reveals its theme`);
      assert.ok(verifyPuzzle(p), `${p.id} fails verifyPuzzle`);
      const m = meta[p.id];
      assert.ok(m, `${p.id} has meta`);
      assert.equal(m.themeId, p.themeId);
      const result = checkPuzzle(p, {
        answers: [...p.answers.map((a) => a.word), ...m.checkedLong],
        recognized: m.stoneCandidates,
      });
      assert.equal(result.ok, true, `${p.id}: ${result.reason}`);
      assert.deepEqual(result.steppingStones, p.steppingStones, `${p.id} stepping stones`);
      assert.deepEqual(offensiveWordsOn(p.grid, blocklist, p.answers), [], `${p.id} spells a blocked word`);
      for (const a of p.answers.filter((x) => !x.isSpangram)) {
        assert.ok(/^[A-Z]{5,10}$/.test(a.word), `${p.id}: ${a.word} must be 5-10 letters`);
      }
    }
  });

  // A board whose theme changed without a successful rebuild keeps its old hash, so this fails
  // until the builder has rebuilt (or revalidated) it.
  test('every sequence board matches its current theme file', async () => {
    const dir = new URL('../content/themes/', import.meta.url);
    const themes = new Map();
    for (const name of (await readdir(dir)).filter((n) => n.endsWith('.json'))) {
      const theme = JSON.parse(await readFile(new URL(name, dir), 'utf8'));
      themes.set(theme.id, theme);
    }
    for (const p of seq.puzzles) {
      const theme = themes.get(p.themeId);
      assert.ok(theme, `${p.id}: theme file ${p.themeId} is missing`);
      assert.equal(meta[p.id].contentHash, contentHash(theme), `${p.id} (${p.themeId}) is stale: rebuild it`);
      assert.equal(p.clue, theme.clue, `${p.id} clue differs from its theme`);
      assert.equal(p.obscure, !!theme.obscure, `${p.id} obscure flag differs from its theme`);
    }
  });

  test('passes 1 to 10 are permutations with one obscure board a day and no seam repeats', () => {
    const sorted = (list) => list.map((p) => p.id).sort();
    let prev = passOrder(seq, 0);
    for (let n = 1; n <= 10; n++) {
      const order = passOrder(seq, n);
      assert.deepEqual(sorted(order), sorted(seq.puzzles), `pass ${n} is not a permutation`);
      for (let d = 0; d < order.length / SET_SIZE; d++) {
        const day = order.slice(d * SET_SIZE, (d + 1) * SET_SIZE);
        assert.ok(day.filter((p) => p.obscure).length <= 1, `pass ${n} day ${d + 1} has two obscure boards`);
      }
      const tail = new Set(prev.slice(-SEAM_DAYS * SET_SIZE).map((p) => p.id));
      for (const p of order.slice(0, SEAM_DAYS * SET_SIZE)) assert.ok(!tail.has(p.id), `pass ${n} seam: ${p.id}`);
      prev = order;
    }
  });
}
