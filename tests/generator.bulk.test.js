import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPuzzle, verifyPuzzle } from '../js/generator.js';

const themes = JSON.parse(readFileSync(new URL('../data/themes.json', import.meta.url), 'utf8'));

test('5,000 seeds all produce verified puzzles quickly', () => {
  let total = 0;
  let max = 0;
  const themeCounts = new Map();
  for (let seed = 1; seed <= 5000; seed++) {
    const t0 = performance.now();
    const puzzle = buildPuzzle(themes, seed);
    const dt = performance.now() - t0;
    total += dt;
    max = Math.max(max, dt);
    assert.ok(verifyPuzzle(puzzle), `seed ${seed} failed verification`);
    themeCounts.set(puzzle.themeId, (themeCounts.get(puzzle.themeId) ?? 0) + 1);
  }
  const avg = total / 5000;
  console.log(`avg ${avg.toFixed(2)} ms, max ${max.toFixed(1)} ms, ${themeCounts.size} themes used`);
  assert.ok(avg < 25, `average generation ${avg.toFixed(2)} ms is too slow`);
  assert.ok(themeCounts.size >= themes.length * 0.9, 'some themes are never chosen');
});
