'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeZip } = require('../core/zip.js');

test('ZIP is deterministic and contains correct local/header/central-directory bytes', () => {
  const files = [{ name: 'a.txt', content: '123456789' }, { name: 'folder/unicode.txt', content: 'Café 💰' }];
  const zip = makeZip(files);
  assert.deepEqual(zip, makeZip(files));
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), 0xcbf43926); // standard CRC32 test vector
  assert.equal(view.getUint16(6, true), 0x800);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(zip.length - 12, true), 2);
  const central = view.getUint32(zip.length - 6, true);
  assert.equal(view.getUint32(central, true), 0x02014b50);
  const encoded = new TextEncoder().encode('123456789');
  assert.deepEqual(zip.slice(35, 44), encoded);
});
test('ZIP rejects traversal, absolute paths, duplicate names and Windows reserved names', () => {
  for (const name of ['../file', '/file', 'a/../../file', 'C:/file', 'a\\file', 'a//file', 'a/./file', 'con.txt', 'folder/NUL', 'bad.', 'bad\0name']) {
    assert.throws(() => makeZip([{ name, content: 'x' }]), name);
  }
  assert.throws(() => makeZip([{ name: 'A.txt', content: 'a' }, { name: 'a.txt', content: 'b' }]));
  assert.throws(() => makeZip([]));
});
