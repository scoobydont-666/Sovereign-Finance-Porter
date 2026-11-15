(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PorterZip = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  function crc32(bytes) {
    let c = 0xffffffff;
    for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function safeName(name) {
    if (typeof name !== 'string' || !name || name.length > 200 || !/^[A-Za-z0-9._/-]+$/.test(name)) throw new Error('Invalid archive path.');
    const segments = name.split('/');
    if (segments.some(s => !s || s === '.' || s === '..' || s.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) throw new Error('Unsafe archive path.');
    return name;
  }
  function makeZip(files) {
    if (!Array.isArray(files) || !files.length || files.length > 10000) throw new Error('Invalid archive entry count.');
    const encoder = new TextEncoder();
    let total = 22, offset = 0;
    const seen = new Set();
    const entries = files.map(file => {
      const name = safeName(file.name), key = name.toLowerCase();
      if (seen.has(key)) throw new Error('Duplicate archive path.');
      seen.add(key);
      if (typeof file.content !== 'string') throw new Error('Archive entries must be UTF-8 text.');
      const n = encoder.encode(name), data = encoder.encode(file.content);
      total += 30 + 46 + n.length * 2 + data.length;
      if (total > 128 * 1024 * 1024) throw new Error('Archive exceeds the 128 MiB limit.');
      return { name: n, data, crc: crc32(data) };
    });
    const output = new Uint8Array(total), view = new DataView(output.buffer);
    const u16 = (p, v) => view.setUint16(p, v, true), u32 = (p, v) => view.setUint32(p, v, true);
    for (const e of entries) {
      e.offset = offset;
      u32(offset, 0x04034b50); u16(offset + 4, 20); u16(offset + 6, 0x800);
      u16(offset + 8, 0); u16(offset + 10, 0); u16(offset + 12, 33); // 1980-01-01, deterministic
      u32(offset + 14, e.crc); u32(offset + 18, e.data.length); u32(offset + 22, e.data.length);
      u16(offset + 26, e.name.length); u16(offset + 28, 0);
      output.set(e.name, offset + 30); output.set(e.data, offset + 30 + e.name.length);
      offset += 30 + e.name.length + e.data.length;
    }
    const centralStart = offset;
    for (const e of entries) {
      u32(offset, 0x02014b50); u16(offset + 4, 20); u16(offset + 6, 20);
      u16(offset + 8, 0x800); u16(offset + 10, 0); u16(offset + 12, 0); u16(offset + 14, 33);
      u32(offset + 16, e.crc); u32(offset + 20, e.data.length); u32(offset + 24, e.data.length);
      u16(offset + 28, e.name.length); u16(offset + 30, 0); u16(offset + 32, 0);
      u16(offset + 34, 0); u16(offset + 36, 0); u32(offset + 38, 0); u32(offset + 42, e.offset);
      output.set(e.name, offset + 46); offset += 46 + e.name.length;
    }
    const centralLength = offset - centralStart;
    u32(offset, 0x06054b50); u16(offset + 4, 0); u16(offset + 6, 0);
    u16(offset + 8, entries.length); u16(offset + 10, entries.length);
    u32(offset + 12, centralLength); u32(offset + 16, centralStart); u16(offset + 20, 0);
    return output;
  }
  return Object.freeze({ makeZip });
});
