'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cli = path.join(__dirname, '../cli.js');
const fixture = path.join(__dirname, '../examples/fictional-household.qif');
function run(args) { return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 }); }

test('CLI inspect provides counts without payees or raw data', () => {
  const result = run([fixture, '--inspect']);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.transactions, 9);
  assert.doesNotMatch(result.stdout + result.stderr, /Example Employer|2500.00|Example Checking/);
});
test('CLI exports a real ZIP, refuses overwrite, and never edits source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'porter-'));
  try {
    const out = path.join(dir, 'migration.zip'), before = fs.readFileSync(fixture);
    const args = [fixture, '--currency', 'USD', '--target', 'simplifi', '--out', out, '--acknowledge-losses'];
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(out).readUInt32LE(0), 0x04034b50);
    const first = fs.readFileSync(out);
    const repeat = run(args);
    assert.equal(repeat.status, 1);
    assert.match(repeat.stderr, /already exists/);
    assert.deepEqual(fs.readFileSync(out), first);
    assert.deepEqual(fs.readFileSync(fixture), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('CLI requires review acknowledgement and explicit USD currency', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'porter-'));
  try {
    const out = path.join(dir, 'migration.zip');
    const unacknowledged = run([fixture, '--currency', 'USD', '--target', 'simplifi', '--out', out]);
    assert.equal(unacknowledged.status, 1);
    assert.match(unacknowledged.stderr, /acknowledge-losses/);
    assert.equal(fs.existsSync(out), false);
    const noCurrency = run([fixture, '--out', out]);
    assert.equal(noCurrency.status, 1);
    assert.match(noCurrency.stderr, /currency USD/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('CLI rejects QDF and unknown options with actionable errors', () => {
  assert.match(run(['private.qdf', '--inspect']).stderr, /exported to QIF/);
  assert.equal(run([fixture, '--upload']).status, 1);
});

test('CLI inspect accepts one terminal DOS EOF with private counts in both QIF encodings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'porter-eof-'));
  try {
    const alpha1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/alpha1-archive.json'), 'utf8'));
    const source = alpha1.sources[0].text + '\t\u001a \r\n';
    const input = path.join(dir, 'fictional-eof.qif');
    for (const [encoding, bytes] of [['utf-8', Buffer.from(source, 'utf8')], ['windows-1252', Buffer.from(source, 'latin1')]]) {
      fs.writeFileSync(input, bytes);
      const result = run([input, '--inspect', '--encoding', encoding]);
      assert.equal(result.status, 0, result.stderr);
      const data = JSON.parse(result.stdout);
      assert.equal(data.transactions, 2);
      assert.equal(data.unsupportedRecords, 1);
      assert.equal(data.issues.filter(issue => issue.code === 'LEGACY_DOS_EOF').length, 1);
      assert.equal(data.issues.some(issue => issue.severity === 'error'), false);
      assert.doesNotMatch(result.stdout + result.stderr, /Fictional Archive|Fictional Fixture|120\.50|30\.00|fictional-eof/);
      assert.deepEqual(fs.readFileSync(input), bytes);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI rejects embedded controls with positions and no financial or filename disclosure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'porter-controls-'));
  try {
    const input = path.join(dir, 'private-filename.qif');
    for (const [control, code] of [['\u0000', '0000'], ['\u001a', '001A'], ['\u001b', '001B'], ['\u007f', '007F']]) {
      const source = '!Type:Bank\nD11/15/2026\nT-42.75\nPPrivate Fixture Payee\nM' + control + 'Private Fixture Memo\n^\n';
      fs.writeFileSync(input, source);
      const result = run([input, '--inspect']);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, new RegExp('U\\+' + code));
      assert.match(result.stderr, /line\s+5\b/i);
      assert.match(result.stderr, /column\s+2\b/i);
      assert.doesNotMatch(result.stderr, /Private Fixture|42\.75|11\/15\/2026|private-filename/);
      assert.equal(fs.readFileSync(input, 'utf8'), source);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI still reads the saved alpha1 archive after a generator upgrade', () => {
  const result = run([path.join(__dirname, 'fixtures/alpha1-archive.json'), '--inspect']);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.transactions, 2);
  assert.equal(data.unsupportedRecords, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /Fictional Archive|Fictional Fixture|120\.50|30\.00/);
});
