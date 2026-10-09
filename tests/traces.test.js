import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPuzzle } from '../js/generator.js';
import { neighbors } from '../js/grid.js';
import { newGameState, submitWord, completedAnswer } from '../js/game.js';

const themes = JSON.parse(readFileSync(new URL('../data/themes.json', import.meta.url), 'utf8'));

// Every self-avoiding path through adjacent cells that spells `word` on this grid.
function allTraces(grid, word) {
  const traces = [];
  const walk = (path) => {
    if (path.length === word.length) {
      traces.push([...path]);
      return;
    }
    for (const n of neighbors(path[path.length - 1])) {
      if (!path.includes(n) && grid[n] === word[path.length]) {
        path.push(n);
        walk(path);
        path.pop();
      }
    }
  };
  grid.forEach((ch, i) => { if (ch === word[0]) walk([i]); });
  return traces;
}

test('every way of tracing every answer is accepted (200 boards)', () => {
  let alternates = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const puzzle = buildPuzzle(themes, seed);
    const start = newGameState(puzzle, `seed-${seed}`);
    for (const answer of puzzle.answers) {
      const traces = allTraces(puzzle.grid, answer.word);
      alternates += traces.length - 1;
      for (const trace of traces) {
        const { state, result } = submitWord(start, puzzle, trace, null);
        assert.equal(result.type, answer.isSpangram ? 'spangram' : 'theme', `seed ${seed} ${answer.word} via ${trace}`);
        assert.deepEqual(state.found, [{ word: answer.word, order: 1 }]);
      }
    }
  }
  assert.ok(alternates > 0, 'expected some boards to allow alternate traces');
});

test('every complete trace auto-registers unless it could still grow into a longer answer', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const puzzle = buildPuzzle(themes, seed);
    const state = newGameState(puzzle, `seed-${seed}`);
    for (const answer of puzzle.answers) {
      const longer = puzzle.answers.some((a) => a.word.length > answer.word.length && a.word.startsWith(answer.word));
      for (const trace of allTraces(puzzle.grid, answer.word)) {
        assert.equal(completedAnswer(state, puzzle, trace)?.word ?? null, longer ? null : answer.word);
      }
    }
  }
});
