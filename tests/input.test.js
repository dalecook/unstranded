import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepTap, stepDrag } from '../js/input.js';
import { linkSquares } from '../js/grid.js';

const all = () => true;
const not = (blocked) => (i) => !blocked.includes(i);

test('stepTap starts, extends, truncates and restarts', () => {
  assert.deepEqual(stepTap([], 0, all), [0]);
  assert.deepEqual(stepTap([0], 7, all), [0, 7]);
  assert.deepEqual(stepTap([0, 7, 14], 7, all), [0, 7]);
  assert.deepEqual(stepTap([0, 7], 20, all), [20]);
  assert.deepEqual(stepTap([0, 7], 8, not([8])), []);
});

test('stepDrag extends only to adjacent selectable cells', () => {
  assert.deepEqual(stepDrag([0], 1, all), [0, 1]);
  const path = [0, 1];
  assert.equal(stepDrag(path, 3, all), path);        // not adjacent: unchanged
  assert.equal(stepDrag(path, 2, not([2])), path);   // blocked: unchanged
  assert.equal(stepDrag(path, 1, all), path);        // already last: unchanged
});

test('stepDrag backtracks onto the previous cell', () => {
  assert.deepEqual(stepDrag([0, 1, 2], 1, all), [0, 1]);
});

test('stepDrag ignores cells earlier in the path', () => {
  const path = [0, 1, 7, 6];
  assert.equal(stepDrag(path, 0, all), path);
});

test('stepDrag lets the selection cross its own diagonal', () => {
  // 0-7 is the down-right diagonal of square 0; 6-1 is the other diagonal.
  assert.deepEqual(stepDrag([0, 7, 6], 1, all), [0, 7, 6, 1]);
  assert.deepEqual(stepDrag([0, 7, 8], 14, all), [0, 7, 8, 14]);
});

test('stepTap extends across the own path instead of restarting', () => {
  assert.deepEqual(stepTap([0, 7, 6], 1, all), [0, 7, 6, 1]);
});

test('steps crossing found-word links are refused', () => {
  const blocked = linkSquares([[0, 7]]); // a found word uses 0-7
  const path = [6];
  assert.equal(stepDrag(path, 1, all, blocked), path);
  assert.deepEqual(stepTap(path, 1, all, blocked), [1]);
  assert.deepEqual(stepDrag(path, 12, all, blocked), [6, 12]);
});

test('orthogonal steps are unaffected by blocked links', () => {
  const blocked = linkSquares([[0, 7]]);
  assert.deepEqual(stepDrag([6], 7, all, blocked), [6, 7]);
  assert.deepEqual(stepTap([1], 7, all, blocked), [1, 7]);
  assert.deepEqual(stepDrag([0], 7, all, blocked), [0, 7]); // same diagonal, not crossing
});

test('backtracking still works with blocked links', () => {
  const blocked = linkSquares([[0, 7]]);
  assert.deepEqual(stepDrag([0, 7, 6], 7, all, blocked), [0, 7]);
  assert.deepEqual(stepTap([0, 7, 6], 7, all, blocked), [0, 7]);
});

test('a self-crossing selection still may not cross a found word', () => {
  const blocked = linkSquares([[2, 9]]); // a found word uses 2-9
  const path = [0, 7, 6, 1, 2, 3]; // crosses itself in square 0
  assert.equal(stepDrag(path, 8, all, blocked), path); // 3-8 would cross 2-9
  assert.deepEqual(stepTap(path, 8, all, blocked), [8]);
  assert.deepEqual(stepDrag(path, 4, all, blocked), [...path, 4]);
  assert.deepEqual(stepDrag([0, 7, 6, 1], 6, all, blocked), [0, 7, 6]); // backtracking over the crossing
  assert.deepEqual(stepTap([0, 7, 6, 1], 7, all, blocked), [0, 7]);
});
