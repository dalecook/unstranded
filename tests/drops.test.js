import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyPuzzle } from '../tools/lib/layout.js';
import { checkPuzzle } from '../tools/lib/checks.js';
import { loadBoardBlocklist, offensiveWordsOn } from '../tools/lib/blocklist.js';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
}

async function loadIndex() {
  try {
    return await readJson('../drops/index.json');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

const index = await loadIndex();

// A published drop must always be fully validated: this file may never mark a test
// todo or skip, so a stale drop can't ship behind a pending test.
test('published drops are never marked todo or skip', async () => {
  const source = await readFile(new URL(import.meta.url), 'utf8');
  const flags = ['to' + 'do', 'sk' + 'ip'].join('|'); // split so this line doesn't match itself
  const flagged = source.match(new RegExp(String.raw`\b(${flags})\s*:|\.(${flags})\s*\(`, 'g')) ?? [];
  assert.deepEqual(flagged, [], 'drops.test.js must not mark tests todo/skip');
});

const blocklist = await loadBoardBlocklist();

if (!index) {
  test('drops: no drops published yet', () => {
    assert.ok(true, 'drops/index.json does not exist yet');
  });
} else {
  for (const dropId of index) {
    test(`drop ${dropId} is valid`, async () => {
      const drop = await readJson(`../drops/${dropId}.json`);
      const meta = await readJson(`../drops/${dropId}.meta.json`);
      assert.equal(drop.id, dropId);

      const ids = drop.puzzles.map((p) => p.id);
      assert.equal(new Set(ids).size, ids.length, 'puzzle ids are unique');
      const idPattern = new RegExp(`^${dropId}-p\\d{2}$`);
      for (const p of drop.puzzles) {
        assert.match(p.id, idPattern);
        assert.ok(!p.id.includes(p.themeId), `${p.id} reveals its theme`);
      }

      for (const p of drop.puzzles) {
        assert.ok(verifyPuzzle(p), `${p.id} fails verifyPuzzle`);
        const m = meta[p.id];
        assert.ok(m, `${p.id} has meta`);
        const result = checkPuzzle(p, {
          answers: [...p.answers.map((a) => a.word), ...m.checkedLong],
          recognized: m.recognizedShort,
        });
        assert.equal(result.ok, true, `${p.id}: ${result.reason}`);
        assert.deepEqual(result.steppingStones, p.steppingStones, `${p.id} stepping stones`);
        assert.deepEqual(offensiveWordsOn(p.grid, blocklist, p.answers), [], `${p.id} spells a blocked word`);
        for (const a of p.answers.filter((x) => !x.isSpangram)) {
          assert.ok(/^[A-Z]{6,10}$/.test(a.word), `${p.id}: ${a.word} must be 6-10 letters`);
        }
      }

      const dates = Object.keys(drop.schedule).sort();
      assert.equal(dates.length, 30, 'schedule has 30 dates');
      dates.forEach((date, i) => assert.equal(date, addDays(dates[0], i), 'dates are consecutive'));
      assert.equal(drop.library.length, 20, 'library has 20 puzzles');
      const placed = [...Object.values(drop.schedule), ...drop.library];
      assert.equal(new Set(placed).size, placed.length, 'no puzzle placed twice');
      assert.deepEqual([...placed].sort(), [...ids].sort(), 'schedule and library partition the puzzles');

      const obscure = new Map(drop.puzzles.map((p) => [p.id, p.obscure]));
      dates.forEach((date, i) => {
        if (!obscure.get(drop.schedule[date])) return;
        for (let j = i + 1; j < Math.min(i + 7, dates.length); j++) {
          assert.ok(!obscure.get(drop.schedule[dates[j]]), `obscure dailies ${date} and ${dates[j]} within 7 days`);
        }
      });
    });
  }
}
