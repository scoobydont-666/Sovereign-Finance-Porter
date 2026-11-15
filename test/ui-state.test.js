'use strict';
// This is an orchestration test with a DOM double, NOT browser-rendering evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { parseQif } = require('../core/qif.js');

function harness() {
  class Element {
    constructor() { this.value = ''; this.checked = false; this.hidden = false; this.disabled = false; this.textContent = ''; this.children = []; this.files = []; this.events = new Map(); this.classList = { add() {}, remove() {}, toggle() {} }; }
    addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(fn); }
    async fire(type, event = {}) { for (const fn of this.events.get(type) || []) await fn(event); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    removeAttribute() {}
    scrollIntoView() {}
    focus() {}
    remove() {}
    click() { return this.fire('click'); }
  }
  const nodes = new Map(), get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  get('date-order').value = 'mdy'; get('encoding').value = 'utf-8'; get('account-name').value = 'Imported account'; get('split-mode').value = 'flatten';
  get('app-error').hidden = true; get('export-blocked').hidden = true;
  const blobs = [], revoked = [];
  const context = vm.createContext({
    document: { getElementById: get, createElement: () => new Element(), body: new Element() },
    window: { addEventListener() {} }, TextDecoder, TextEncoder, File, Blob,
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:fictional-' + blobs.length; }, revokeObjectURL(url) { revoked.push(url); } },
    setTimeout() { return 1; }, clearTimeout() {}, console,
  });
  for (const file of ['core/model.js', 'core/qif.js', 'core/exporters.js', 'core/zip.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  return { get, context, blobs, revoked, async load(file) { get('source-file').files = [file]; await get('source-file').fire('change'); get('currency-confirm').checked = true; await get('currency-confirm').fire('change'); await get('read-button').fire('click'); } };
}
const nonASCII = '!Account\nNCompte été\nTBank\n^\n!Type:Bank\nD1/1/2026\nT-1.25\nPCafé\n^\n';

test('browser orchestration loads real UMD modules and prepares ZIP after explicit review', async () => {
  const h = harness();
  await h.get('demo-button').fire('click');
  assert.equal(h.get('stat-transactions').textContent, '7');
  assert.equal(h.get('summary-rows').textContent, '8');
  assert.equal(h.get('download-button').disabled, true);
  h.get('export-confirm').checked = true; await h.get('export-confirm').fire('change');
  assert.equal(h.get('download-button').disabled, false);
  await h.get('download-button').fire('click');
  assert.equal(h.blobs.length, 1);
  const bytes = Buffer.from(await h.blobs[0].arrayBuffer());
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
});
test('archive decoding is always strict UTF-8 even after Windows-1252 QIF selection', async () => {
  const h = harness(); h.get('encoding').value = 'windows-1252';
  const canonical = JSON.stringify(parseQif(nonASCII, { currency: 'USD' }));
  await h.load(new File([canonical], 'portable-book.json'));
  assert.equal(h.get('app-error').hidden, true, h.get('app-error').textContent);
  assert.equal(h.get('accounts-body').children[0].children[0].textContent, 'Compte été');
  assert.equal(h.get('transactions-body').children[0].children[1].textContent, 'Café');
});
test('archive files above QIF source cap can be selected, up to 100 MiB', async () => {
  const h = harness();
  // Selection-only boundary: no huge allocation or parsing needed.
  h.get('source-file').files = [{ name: 'portable-book.json', size: 33 * 1024 * 1024 }];
  await h.get('source-file').fire('change');
  assert.equal(h.get('app-error').hidden, true, h.get('app-error').textContent);
  assert.equal(h.get('file-title').textContent, 'portable-book.json');
});
test('changing destination resets review, changing source settings invalidates old plan', async () => {
  const h = harness(); await h.get('demo-button').fire('click');
  h.get('export-confirm').checked = true; await h.get('export-confirm').fire('change');
  h.get('target-select').value = 'ynab'; await h.get('target-select').fire('change');
  assert.equal(h.get('export-confirm').checked, false);
  assert.equal(h.get('download-button').disabled, true);
  h.get('date-order').value = 'dmy'; await h.get('date-order').fire('change');
  assert.equal(h.get('review-content').hidden, true);
  assert.equal(h.get('destination-controls').disabled, true);
  await h.get('download-button').fire('click'); assert.equal(h.blobs.length, 0);
});
test('clear releases download and all displayed financial rows', async () => {
  const h = harness(); await h.get('demo-button').fire('click');
  h.get('export-confirm').checked = true; await h.get('export-confirm').fire('change');
  await h.get('download-button').fire('click');
  await h.get('clear-button').fire('click');
  assert.equal(h.get('transactions-body').children.length, 0);
  assert.equal(h.get('accounts-body').children.length, 0);
  assert.equal(h.get('currency-confirm').checked, false);
  assert.equal(h.get('download-button').disabled, true);
  assert.equal(h.revoked.length, 1);
});
test('source parse errors prevent CSV download but allow preservation archive', async () => {
  const h = harness();
  await h.load(new File(['!Type:Bank\nD2/30/2026\nT10\nPX\n^\n'], 'broken.qif'));
  assert.equal(h.get('export-blocked').hidden, false);
  h.get('export-confirm').checked = true; await h.get('export-confirm').fire('change');
  assert.equal(h.get('download-button').disabled, true);
  h.get('target-select').value = 'archive'; await h.get('target-select').fire('change');
  h.get('export-confirm').checked = true; await h.get('export-confirm').fire('change');
  assert.equal(h.get('download-button').disabled, false);
});
test('late asynchronous file reads cannot repopulate a cleared workspace', async () => {
  const h = harness(); let release;
  const pending = new Promise(resolve => { release = resolve; });
  h.get('source-file').files = [{ name: 'slow.qif', size: 100, arrayBuffer: () => pending }];
  await h.get('source-file').fire('change'); h.get('currency-confirm').checked = true;
  const read = h.get('read-button').fire('click');
  await h.get('clear-button').fire('click');
  release(new TextEncoder().encode(nonASCII).buffer); await read;
  assert.equal(h.get('review-content').hidden, true);
  assert.equal(h.get('transactions-body').children.length, 0);
  assert.equal(h.get('download-button').disabled, true);
});
