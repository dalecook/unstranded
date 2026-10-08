import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShareText, shareText } from '../js/share.js';

const puzzle = { clue: 'Drawer full of tools' };

test('daily share text', () => {
  const state = { log: ['T', 'T', 'H', 'T', 'S', 'T', 'T'] };
  assert.equal(
    buildShareText({ state, puzzle, label: '2026-10-08', url: null }),
    'UnStranded #2026-10-08\n"Drawer full of tools"\n🔵🔵💡🔵\n🟡🔵🔵',
  );
});

test('random share text includes the link', () => {
  const state = { log: ['S', 'T'] };
  assert.equal(
    buildShareText({ state, puzzle, label: '12345', url: 'https://x.test/?p=12345' }),
    'UnStranded #12345\n"Drawer full of tools"\n🟡🔵\nhttps://x.test/?p=12345',
  );
});

test('shareText prefers the native share sheet', async () => {
  let shared = null;
  const nav = { share: async (data) => { shared = data; }, clipboard: { writeText: async () => {} } };
  assert.equal(await shareText('hi', nav), 'shared');
  assert.deepEqual(shared, { text: 'hi' });
});

test('shareText falls back to the clipboard', async () => {
  let copied = null;
  const nav = { clipboard: { writeText: async (t) => { copied = t; } } };
  assert.equal(await shareText('hi', nav), 'copied');
  assert.equal(copied, 'hi');
});

test('shareText reports a cancelled share sheet', async () => {
  const nav = { share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } };
  assert.equal(await shareText('hi', nav), 'cancelled');
});

test('shareText falls back to clipboard when share fails, else reports failure', async () => {
  const failingShare = async () => { throw new Error('nope'); };
  let copied = null;
  assert.equal(await shareText('hi', { share: failingShare, clipboard: { writeText: async (t) => { copied = t; } } }), 'copied');
  assert.equal(copied, 'hi');
  assert.equal(await shareText('hi', { share: failingShare }), 'failed');
});
