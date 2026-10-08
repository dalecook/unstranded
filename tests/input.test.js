import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepTap, stepDrag } from '../js/input.js';

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
