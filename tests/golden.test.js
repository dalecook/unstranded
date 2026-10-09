import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, dailySeed } from '../js/rng.js';
import { buildPuzzle } from '../js/generator.js';

const UTENSILS = {
  id: 'utensils',
  clue: 'Drawer full of tools',
  spangram: 'UTENSILS',
  words: ['WHISK', 'LADLE', 'TONGS', 'SPATULA', 'GRATER', 'PEELER', 'SCOOP', 'MASHER', 'SKEWER', 'STRAINER', 'ZESTER', 'SPOON'],
};
const PLANETS = {
  id: 'solarsystem',
  clue: 'Space neighbours',
  spangram: 'SOLARSYSTEM',
  words: ['MERCURY', 'VENUS', 'EARTH', 'MARS', 'JUPITER', 'SATURN', 'URANUS', 'NEPTUNE', 'PLUTO', 'MOON', 'COMET'],
};

// Pins the daily puzzle so code changes can't silently change everyone's board.
test('daily puzzle for a fixed date is stable', () => {
  assert.equal(mulberry32(42)(), 0.6011037519201636);
  const seed = dailySeed(new Date(2026, 9, 8));
  assert.equal(seed, 1859475678);
  const puzzle = buildPuzzle([UTENSILS, PLANETS], seed);
  assert.equal(puzzle.themeId, 'utensils');
  assert.equal(puzzle.grid.join(''), 'ZESTMASWREESEKERHRSCSNEUSIOOTRLLEPELALPEEGDRETAR');
});
