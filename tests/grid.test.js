import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLS, ROWS, CELLS, rowOf, colOf, isAdjacent, neighbors,
  isValidPath, touchesOppositeEdges, samePath,
} from '../js/grid.js';

test('grid dimensions', () => {
  assert.equal(COLS, 6);
  assert.equal(ROWS, 8);
  assert.equal(CELLS, 48);
});

test('rowOf / colOf', () => {
  assert.equal(rowOf(0), 0);
  assert.equal(colOf(0), 0);
  assert.equal(rowOf(7), 1);
  assert.equal(colOf(7), 1);
  assert.equal(rowOf(47), 7);
  assert.equal(colOf(47), 5);
});

test('neighbors of corner, edge and middle cells', () => {
  assert.deepEqual(neighbors(0), [1, 6, 7]);
  assert.deepEqual(neighbors(5), [4, 10, 11]);
  assert.equal(neighbors(7).length, 8);
  assert.deepEqual(neighbors(47), [40, 41, 46]);
});

test('isAdjacent does not wrap around rows', () => {
  assert.equal(isAdjacent(0, 7), true);
  assert.equal(isAdjacent(0, 2), false);
  assert.equal(isAdjacent(5, 6), false);
  assert.equal(isAdjacent(3, 3), false);
});

test('isValidPath', () => {
  assert.equal(isValidPath([0, 1, 2, 8]), true);
  assert.equal(isValidPath([]), false);
  assert.equal(isValidPath([0, 2]), false);
  assert.equal(isValidPath([0, 1, 0]), false);
  assert.equal(isValidPath([47, 48]), false);
});

test('touchesOppositeEdges', () => {
  assert.equal(touchesOppositeEdges([0, 1, 2, 3, 4, 5]), true);
  assert.equal(touchesOppositeEdges([0, 6, 12, 18, 24, 30, 36, 42]), true);
  assert.equal(touchesOppositeEdges([0, 1, 2]), false);
});

test('samePath', () => {
  assert.equal(samePath([1, 2, 3], [1, 2, 3]), true);
  assert.equal(samePath([1, 2, 3], [3, 2, 1]), false);
  assert.equal(samePath([1, 2], [1, 2, 3]), false);
});
