import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readZip } from '../tools/lib/zip.js';

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, method } of entries) {
    const nameBuf = Buffer.from(name);
    const comp = method === 8 ? deflateRawSync(data) : data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test('reads stored and deflated entries', () => {
  const zip = buildZip([
    { name: 'a.txt', data: Buffer.from('stored content'), method: 0 },
    { name: 'dir/b.txt', data: Buffer.from('deflate me '.repeat(50)), method: 8 },
  ]);
  const files = readZip(zip);
  assert.deepEqual([...files.keys()], ['a.txt', 'dir/b.txt']);
  assert.equal(files.get('a.txt').toString(), 'stored content');
  assert.equal(files.get('dir/b.txt').toString(), 'deflate me '.repeat(50));
});

test('rejects non-zip data', () => {
  assert.throws(() => readZip(Buffer.alloc(40)), /Not a ZIP/);
});
