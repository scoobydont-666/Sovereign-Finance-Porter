'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../core/model.js');
const { parseQif } = require('../core/qif.js');
const { planExport } = require('../core/exporters.js');
const { source } = require('./fixtures/account-type-source.json');
const alpha2 = require('./fixtures/alpha2-archive.json');
const clone = value => JSON.parse(JSON.stringify(value));
const errors = book => book.issues.filter(issue => issue.severity === 'error');
const unknownAccount = '!Account\nNFictional Legacy\nT\u0001\n^\n';
const cash = '!Type:Cash\nD11/22/2026\nT-9.25\nPExample Shop\n^\n';

test('SOH account catalogue type stays unspecified while explicit account receives every transaction', () => {
  const book = parseQif(source);
  assert.deepEqual(book.accounts.map(a => [a.name, a.type]), [['Fictional Checking', 'Bank'], ['Fictional Legacy', '']]);
  assert.deepEqual(book.transactions.map(t => [t.accountId, t.amount]), [['account-1', '120.50'], ['account-1', '-30.00']]);
  assert.deepEqual(book.transactions[1].splits.map(s => s.amount), ['-20.00', '-10.00']);
  assert.equal(book.categories.length, 1);
  assert.equal(book.unsupportedRecords.length, 1);
  assert.equal(book.unsupportedRecords[0].type, 'Class');
  assert.equal(book.accounts[1].rawFields[1], 'T\u0001');
  assert.equal(book.sources[0].text, source);
  const notes = book.issues.filter(issue => issue.code === 'ACCOUNT_TYPE_UNSPECIFIED');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].severity, 'warning');
  assert.equal(notes[0].sourceRecord, 4);
  assert.doesNotMatch(notes[0].message, /Fictional|120\.50|30\.00|\u0001/u);
  assert.equal(errors(book).length, 0);
  assert.deepEqual(Model.validateBook(clone(book)), book);
});

test('SOH account type derives only from explicit declarations or selected transaction section', () => {
  const alone = parseQif(unknownAccount);
  assert.equal(alone.accounts[0].type, '');
  assert.equal(alone.transactions.length, 0);
  assert.deepEqual(Model.validateBook(clone(alone)), alone);
  for (const type of ['Cash', 'Bank', 'CCard', 'Oth A', 'Oth L']) {
    const book = parseQif('\ufeff' + unknownAccount.replace('!Account', '!AcCoUnT \t') + cash.replace('Cash', type));
    assert.equal(book.accounts[0].type, type);
    assert.equal(book.transactions.length, 1);
    assert.equal(book.transactions[0].amount, '-9.25');
    assert.deepEqual(Model.validateBook(clone(book)), book);
  }
  const declared = parseQif(unknownAccount + '!Account\nNFictional Legacy\nTCCard\n^\n' + cash.replace('Cash', 'CCard'));
  assert.equal(declared.accounts.length, 1);
  assert.equal(declared.accounts[0].type, 'CCard');
  assert.ok(declared.accounts[0].rawFields.includes('T\u0001'));
  assert.equal(errors(declared).length, 0);
  assert.deepEqual(Model.validateBook(clone(declared)), declared);
});

test('SOH handling preserves ambiguous, conflicting and malformed account blocking', () => {
  const sources = [
    '!Option:AutoSwitch\n' + unknownAccount + '!Clear:AutoSwitch\n' + cash,
    unknownAccount.replace('^\n', 'NFictional Second\nTCash\n^\n') + cash,
    unknownAccount.replace('NFictional Legacy\n', '') + cash,
    unknownAccount.replace('T\u0001', 'T\u0001\nTCash') + cash,
    unknownAccount.replace('^\n', '') + cash,
    unknownAccount + '!Account\nNFictional Legacy\nTBank\n^\n' + cash,
  ];
  for (const input of sources) {
    const book = parseQif(input);
    assert.ok(errors(book).length > 0);
    assert.equal(book.transactions.length, 0);
    assert.equal(book.sources[0].text, input);
    assert.deepEqual(Model.validateBook(clone(book)), book);
    assert.equal(planExport(book, 'simplifi').blocked, true);
    assert.equal(planExport(book, 'archive').blocked, false);
  }
});

test('SOH exception is exact and cannot spread into financial fields or other sections', () => {
  const rejected = [
    '!Type:Bank\nT\u0001\n^\n',
    '!Type:Account\nNFictional Legacy\nT\u0001\n^\n',
    '!Type:Cat\nNFictional Legacy\nT\u0001\n^\n',
    '!AccountExtra\nNFictional Legacy\nT\u0001\n^\n',
    '!Account\n!Unknown\nT\u0001\n^\n',
    unknownAccount.replace('T\u0001', 'T\u0001Bank'),
    unknownAccount.replace('T\u0001', 'T \u0001'),
    unknownAccount.replace('T\u0001', 'T\u0001 '),
    unknownAccount.replace('T\u0001', 'T\u0001\u0001'),
    unknownAccount.replace('T\u0001', 'N\u0001'),
    unknownAccount.replace('T\u0001', 'D\u0001'),
    unknownAccount.replace('T\u0001', 'T\u0002'),
    unknownAccount.replace('T\u0001', 'T\u0000'),
  ];
  for (const input of rejected) assert.throws(() => parseQif(input), /unsupported control character U\+/);
  assert.throws(() => Model.text('\u0001', 'Normalized value'), /control/);
});

test('allowed SOH does not hide a later rejected control and positions stay private', () => {
  for (const separator of ['\n', '\r\n', '\r']) {
    const input = (unknownAccount + '!Type:Cash\nD11/22/2026\nT-9.25\nPExample Shop\nM\u001bPrivate Fixture\n^\n').replace(/\n/g, separator);
    assert.throws(() => parseQif(input), error => {
      assert.match(error.message, /U\+001B/);
      assert.match(error.message, /line 9, column 2/);
      assert.doesNotMatch(error.message, /Fictional|Private Fixture|9\.25|11\/22/);
      return true;
    });
  }
});

test('SOH source and account raw evidence survive every target without leaking into CSV', () => {
  const book = parseQif(source + '\t\u001a \r\n');
  assert.equal(book.issues.filter(i => i.code === 'LEGACY_DOS_EOF').length, 1);
  for (const target of ['simplifi', 'simplifi-compat', 'monarch', 'ynab', 'actual', 'generic', 'archive', 'gnucash']) {
    const plan = planExport(book, target);
    assert.equal(plan.blocked, false, target);
    assert.equal(plan.files.find(f => f.name === 'original-source/source-1.qif').content, source + '\t\u001a \r\n');
    const archive = JSON.parse(plan.files.find(f => f.name === 'portable-book.json').content);
    assert.deepEqual(Model.validateBook(archive), book);
    for (const file of plan.files.filter(f => f.name.endsWith('.csv'))) assert.doesNotMatch(file.content, /\u0001/u, file.name);
    if (target !== 'archive' && target !== 'gnucash') {
      assert.equal(plan.summary.sourceTransactions, 2, target);
      assert.equal(plan.summary.exportedRows, 3, target);
      assert.equal(plan.summary.sourceNet, '90.50', target);
      assert.equal(plan.summary.exportNet, '90.50', target);
      assert.equal(plan.files.filter(f => f.name.startsWith('import/')).length, 1, target);
    }
  }
});

test('SOH archives reject changed type, stripped evidence, removed warnings and controls outside account raw fields', () => {
  const book = parseQif(source);
  for (const mutate of [
    b => { b.accounts[1].type = 'Bank'; },
    b => { b.accounts[1].type = '\u0001'; },
    b => { b.accounts[1].rawFields[1] = 'T'; },
    b => { b.sources[0].text = b.sources[0].text.replace('T\u0001', 'T'); },
    b => { b.issues = b.issues.filter(i => i.code !== 'ACCOUNT_TYPE_UNSPECIFIED'); },
    b => { b.transactions[0].rawFields.push('T\u0001'); },
    b => { b.categories[0].rawFields.push('T\u0001'); },
    b => { b.unsupportedRecords[0].rawFields.push('T\u0001'); },
    b => { b.transactions[0].accountId = 'account-2'; },
    b => { b.transactions[1].splits[0].amount = '-21.00'; b.transactions[1].splits[1].amount = '-9.00'; },
  ]) {
    const changed = clone(book);
    mutate(changed);
    assert.throws(() => Model.validateBook(changed));
    assert.throws(() => planExport(changed, 'archive'));
  }
});

test('frozen alpha2 archive upgrades only generator metadata and retains EOF and integrity checks', () => {
  assert.equal(alpha2.generator.version, '0.1.0-alpha.2');
  const expected = clone(alpha2);
  expected.generator.version = Model.VERSION;
  assert.deepEqual(Model.validateBook(clone(alpha2)), expected);
  const plan = planExport(clone(alpha2), 'simplifi');
  assert.equal(plan.blocked, false);
  assert.equal(plan.summary.exportNet, '90.50');
  assert.equal(plan.summary.exportedRows, 3);
  assert.deepEqual(JSON.parse(plan.files.find(f => f.name === 'portable-book.json').content), expected);
  for (const mutate of [
    b => { b.issues = b.issues.filter(i => i.code !== 'LEGACY_DOS_EOF'); },
    b => { b.sources[0].text = b.sources[0].text.replace('\u001a', ''); },
    b => { b.transactions[0].amount = '0.00'; },
    b => { b.unsupportedRecords = []; },
  ]) {
    const changed = clone(alpha2); mutate(changed);
    assert.throws(() => Model.validateBook(changed));
  }
});
