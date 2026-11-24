'use strict';
// This is an orchestration test with a DOM double, NOT browser-rendering evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { parseQif } = require('../core/qif.js');
const { VERSION } = require('../core/model.js');

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

// Read the stored entries actually downloaded by the UI. ZIP format/CRC has its
// own tests; this oracle checks source/archive contents through orchestration.
async function downloadedEntries(blob) {
  const bytes = Buffer.from(await blob.arrayBuffer()), files = new Map();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    assert.ok(start + size <= bytes.length);
    files.set(name, bytes.subarray(start, start + size).toString('utf8'));
    offset = start + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  return files;
}

async function downloadReviewed(h) {
  h.get('export-confirm').checked = true;
  await h.get('export-confirm').fire('change');
  assert.equal(h.get('download-button').disabled, false);
  await h.get('download-button').fire('click');
  return downloadedEntries(h.blobs.at(-1));
}

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

test('browser imports terminal DOS EOF and downloads an archive that reloads with exact totals', async () => {
  const h = harness(), source = nonASCII + '\t\u001a \r\n';
  await h.load(new File([source], 'fictional-eof.qif'));
  assert.equal(h.get('app-error').hidden, true, h.get('app-error').textContent);
  assert.equal(h.get('review-content').hidden, false);
  assert.equal(h.get('stat-transactions').textContent, '1');
  assert.equal(h.get('summary-rows').textContent, '1');
  const first = await downloadReviewed(h);
  assert.equal(first.get('original-source/source-1.qif'), source);
  const canonical = JSON.parse(first.get('portable-book.json'));
  assert.equal(canonical.sources[0].text, source);
  assert.equal(canonical.transactions[0].amount, '-1.25');
  assert.equal(canonical.issues.filter(issue => issue.code === 'LEGACY_DOS_EOF').length, 1);
  const report = JSON.parse(first.get('migration-report.json'));
  assert.equal(report.summary.sourceTransactions, 1);
  assert.equal(report.summary.exportedRows, 1);
  assert.equal(report.summary.sourceNet, '-1.25');
  assert.equal(report.summary.exportNet, '-1.25');
  assert.match([...first.entries()].find(([name]) => name.startsWith('import/'))[1], /-1\.25/);

  await h.get('clear-button').fire('click');
  await h.load(new File([first.get('portable-book.json')], 'portable-book.json'));
  assert.equal(h.get('app-error').hidden, true, h.get('app-error').textContent);
  assert.equal(h.get('stat-transactions').textContent, '1');
  assert.equal(h.get('download-button').disabled, true);
  h.get('target-select').value = 'generic';
  await h.get('target-select').fire('change');
  const second = await downloadReviewed(h);
  assert.equal(h.blobs.length, 2);
  assert.equal(second.get('original-source/source-1.qif'), source);
  assert.deepEqual(JSON.parse(second.get('portable-book.json')), canonical);
  const secondReport = JSON.parse(second.get('migration-report.json'));
  assert.equal(secondReport.summary.sourceTransactions, 1);
  assert.equal(secondReport.summary.exportedRows, 1);
  assert.equal(secondReport.summary.exportNet, '-1.25');
});

test('browser control diagnostics show safe positions and cannot download rejected input', async () => {
  for (const [control, code] of [['\u0000', '0000'], ['\u001a', '001A'], ['\u001b', '001B'], ['\u007f', '007F']]) {
    const h = harness();
    const source = '!Type:Bank\r\nD11/15/2026\r\nT-42.75\r\nPPrivate Fixture Payee\r\nM' + control + 'Private Fixture Memo\r\n^\r\n';
    await h.load(new File([source], 'private-filename.qif'));
    assert.equal(h.get('app-error').hidden, false);
    const message = h.get('app-error').textContent;
    assert.match(message, new RegExp('U\\+' + code));
    assert.match(message, /line\s+5\b/i);
    assert.match(message, /column\s+2\b/i);
    assert.doesNotMatch(message, /Private Fixture|42\.75|11\/15\/2026|private-filename/);
    assert.equal(h.get('review-content').hidden, true);
    assert.equal(h.get('transactions-body').children.length, 0);
    assert.equal(h.get('download-button').disabled, true);
    h.get('export-confirm').checked = true;
    await h.get('export-confirm').fire('change');
    await h.get('download-button').fire('click');
    assert.equal(h.blobs.length, 0);
  }
});

test('browser reloads the saved alpha1 archive and upgrades only generator metadata', async () => {
  const h = harness();
  const original = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/alpha1-archive.json'), 'utf8'));
  assert.equal(original.generator.version, '0.1.0-alpha.1');
  await h.load(new File([JSON.stringify(original)], 'portable-book.json'));
  assert.equal(h.get('app-error').hidden, true, h.get('app-error').textContent);
  assert.equal(h.get('stat-transactions').textContent, '2');
  assert.equal(h.get('summary-rows').textContent, '3');
  const files = await downloadReviewed(h);
  const expected = structuredClone(original);
  expected.generator.version = VERSION;
  assert.deepEqual(JSON.parse(files.get('portable-book.json')), expected);
  assert.equal(files.get('original-source/source-1.qif'), original.sources[0].text);
  const report = JSON.parse(files.get('migration-report.json'));
  assert.equal(report.summary.sourceTransactions, 2);
  assert.equal(report.summary.exportedRows, 3);
  assert.equal(report.summary.exportNet, '90.50');
});

test('browser reads SOH catalogue metadata and reopens a reviewed ZIP archive without altering account assignment', async () => {
  const { source } = require('./fixtures/account-type-source.json');
  const h = harness();
  await h.load(new File([source], 'fictional-account-type.qif'));
  assert.equal(h.get('app-error').hidden, true, h.get('app-error').textContent);
  assert.equal(h.get('review-content').hidden, false);
  assert.equal(h.get('stat-transactions').textContent, '2');
  assert.equal(h.get('summary-rows').textContent, '3');
  assert.equal(h.get('download-button').disabled, true);
  const first = await downloadReviewed(h);
  assert.equal(first.get('original-source/source-1.qif'), source);
  const canonical = JSON.parse(first.get('portable-book.json'));
  assert.equal(canonical.accounts[1].type, '');
  assert.equal(canonical.accounts[1].rawFields[1], 'T\u0001');
  assert.deepEqual(canonical.transactions.map(t => [t.accountId, t.amount]), [['account-1', '120.50'], ['account-1', '-30.00']]);
  assert.equal(canonical.issues.filter(i => i.code === 'ACCOUNT_TYPE_UNSPECIFIED').length, 1);
  for (const [name, content] of first) if (name.endsWith('.csv')) assert.doesNotMatch(content, /\u0001/u);
  for (const row of h.get('accounts-body').children) for (const cell of row.children) assert.doesNotMatch(cell.textContent, /\u0001/u);
  const report = JSON.parse(first.get('migration-report.json'));
  assert.equal(report.summary.sourceTransactions, 2);
  assert.equal(report.summary.exportedRows, 3);
  assert.equal(report.summary.exportNet, '90.50');
  await h.get('clear-button').fire('click');
  h.get('encoding').value = 'windows-1252';
  await h.load(new File([first.get('portable-book.json')], 'portable-book.json'));
  assert.equal(h.get('app-error').hidden, true, h.get('app-error').textContent);
  assert.equal(h.get('stat-transactions').textContent, '2');
  const reopened = await downloadReviewed(h);
  assert.deepEqual(JSON.parse(reopened.get('portable-book.json')), canonical);
  assert.equal(reopened.get('original-source/source-1.qif'), source);
});

test('browser reopens the frozen alpha2 archive with generator-only upgrade', async () => {
  const original = require('./fixtures/alpha2-archive.json');
  const h = harness();
  await h.load(new File([JSON.stringify(original)], 'portable-book.json'));
  assert.equal(h.get('app-error').hidden, true, h.get('app-error').textContent);
  const files = await downloadReviewed(h);
  const expected = structuredClone(original);
  expected.generator.version = VERSION;
  assert.deepEqual(JSON.parse(files.get('portable-book.json')), expected);
  assert.equal(files.get('original-source/source-1.qif'), original.sources[0].text);
  assert.equal(JSON.parse(files.get('migration-report.json')).summary.exportNet, '90.50');
});
