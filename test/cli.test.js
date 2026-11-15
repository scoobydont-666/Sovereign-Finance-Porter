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
