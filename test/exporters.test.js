'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseQif } = require('../core/qif.js');
const { validateBook } = require('../core/model.js');
const E = require('../core/exporters.js');

const fixture = fs.readFileSync(path.join(__dirname, '../examples/fictional-household.qif'), 'utf8');
function book(text = fixture) { return parseQif(text, { sourceName: 'fictional.qif', currency: 'USD', dateOrder: 'mdy', accountName: 'Example' }); }
function dataFiles(plan) { return plan.files.filter(f => f.name.startsWith('import/')); }
function simple(records) { return '!Account\nNExample\nTBank\n^\n!Type:Bank\n' + records; }
// Independent small RFC4180 reader used only as a test oracle.
function readCSV(text) {
  const rows = [], row = [];
  let value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && ch === ',') { row.push(value); value = ''; }
    else if (!quoted && ch === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row.splice(0)); value = ''; }
    else value += ch;
  }
  assert.equal(quoted, false);
  return rows;
}

test('fictional checking, savings and card history reconcile independently', () => {
  const analysis = E.analyze(book());
  assert.equal(analysis.transactionCount, 9);
  assert.deepEqual(analysis.accounts.filter(a => a.transactionCount).map(a => [a.name, a.transactionCount, a.total]), [
    ['Example Checking', 5, '2766.53'], ['Example Savings', 1, '500.00'], ['Example Card', 3, '113.15']
  ]);
});
test('Simplifi exact seven-column profile, one file/account, split amount preservation', () => {
  const plan = E.planExport(book(), 'simplifi');
  assert.equal(plan.blocked, false);
  assert.equal(plan.summary.sourceTransactions, 9);
  assert.equal(plan.summary.exportedRows, 10);
  assert.equal(plan.summary.sourceNet, '3379.68');
  assert.equal(plan.summary.exportNet, '3379.68');
  const files = dataFiles(plan);
  assert.equal(files.length, 3);
  const rows = readCSV(files[0].content);
  assert.deepEqual(rows[0], ['Date', 'Payee', 'Amount', 'Category', 'Tags', 'Notes', 'Check_No']);
  assert.equal(rows[1][0], '1/1/26');
  assert.deepEqual(rows.filter(r => r[1] === 'Example Market').map(r => r[2]), ['-63.47', '-20.00']);
  assert.ok(plan.warnings.some(w => w.code === 'SPLITS_FLATTENED'));
  assert.ok(plan.warnings.some(w => w.code === 'UNSUPPORTED_RECORDS'));
});
test('all CSV profiles conserve signed net amounts, refunds and transfer legs', () => {
  for (const target of ['simplifi', 'simplifi-compat', 'monarch', 'ynab', 'actual', 'generic']) {
    const plan = E.planExport(book(), target);
    let minor = 0;
    for (const file of dataFiles(plan)) {
      const [headers, ...rows] = readCSV(file.content);
      for (const r of rows) {
        const amount = target === 'ynab' ? Number(r[4] || 0) - Number(r[3] || 0) : Number(r[headers.findIndex(h => h.toLowerCase() === 'amount')]);
        minor += Math.round(amount * 100);
      }
    }
    assert.equal(minor, 337968, target);
  }
});
test('preserve split parents exports each parent once and retains children in notes', () => {
  const plan = E.planExport(book(), 'simplifi', { splitMode: 'preserve' });
  assert.equal(plan.summary.exportedRows, 9);
  const rows = readCSV(dataFiles(plan)[0].content).filter(r => r[1] === 'Example Market');
  assert.equal(rows.length, 1);
  assert.equal(rows[0][2], '-83.47');
  assert.match(rows[0][5], /-63.47/);
  assert.match(rows[0][5], /-20.00/);
});
test('YNAB uses positive separate inflow/outflow and carries categories in memo', () => {
  const rows = readCSV(dataFiles(E.planExport(book(), 'ynab'))[0].content);
  assert.deepEqual(rows[0], ['Date', 'Payee', 'Memo', 'Outflow', 'Inflow']);
  const expense = rows.find(r => r[1] === 'Example Market');
  assert.equal(expense[3], '63.47'); assert.equal(expense[4], '');
  assert.match(expense[2], /Category: Food:Groceries/);
  const income = rows.find(r => r[1] === 'Example Employer');
  assert.equal(income[3], ''); assert.equal(income[4], '2500.00');
});
test('compatibility and Monarch columns are kept separate', () => {
  assert.deepEqual(readCSV(dataFiles(E.planExport(book(), 'simplifi-compat'))[0].content)[0], ['Date', 'Payee', 'Amount', 'Tags']);
  const monarch = readCSV(dataFiles(E.planExport(book(), 'monarch'))[0].content);
  assert.deepEqual(monarch[0], ['Date', 'Merchant Name', 'Data Provider Description', 'Amount', 'Category', 'Account', 'Tags', 'Notes']);
  assert.equal(monarch[1][0], '2026-01-01');
  assert.equal(monarch[1][5], 'Example Checking');
});
test('malformed transaction blocks every CSV while original evidence remains exportable', () => {
  const source = simple('D2/30/2026\nT-10.00\nPExample\n^\n');
  for (const target of ['simplifi', 'simplifi-compat', 'monarch', 'ynab', 'actual', 'generic']) {
    const plan = E.planExport(book(source), target);
    assert.equal(plan.blocked, true);
    assert.equal(dataFiles(plan).length, 0);
  }
  const archive = E.planExport(book(source), 'archive');
  assert.equal(archive.blocked, false);
  assert.equal(archive.files.find(f => f.name.endsWith('.qif')).content, source);
});
test('archive JSON round trip revalidates integrity including unsupported source', () => {
  const plan = E.planExport(book(), 'archive');
  const canonical = JSON.parse(plan.files.find(f => f.name === 'portable-book.json').content);
  assert.deepEqual(validateBook(canonical), book());
  const tampered = structuredClone(canonical);
  tampered.transactions[0].amount = '999999.99';
  assert.throws(() => E.planExport(tampered, 'simplifi'));
});
test('possible duplicates are reported but both legitimate copies survive', () => {
  const source = simple('D1/1/2026\nT-4.25\nPCoffee\n^\nD1/1/2026\nT-4.25\nPCoffee\n^\n');
  const plan = E.planExport(book(source), 'generic');
  assert.equal(plan.summary.exportedRows, 2);
  assert.equal(plan.summary.exportNet, '-8.50');
  assert.ok(plan.warnings.some(w => w.code === 'POSSIBLE_DUPLICATES'));
});
test('missing transfer side is flagged without adding invented postings', () => {
  const source = simple('D1/1/2026\nT-100.00\nPTransfer\nL[Other account]\n^\n');
  const plan = E.planExport(book(source), 'simplifi');
  assert.equal(plan.summary.exportedRows, 1);
  assert.ok(plan.warnings.some(w => w.code === 'UNMATCHED_TRANSFERS'));
  assert.equal(readCSV(dataFiles(plan)[0].content)[1][3], '');
});
test('text formulas are escaped but signed amounts and canonical text remain intact', () => {
  const source = simple('D1/1/2026\nT-12.50\nP=HYPERLINK("https://invalid.example","x")\nL@Category\n^\n');
  const parsed = book(source), plan = E.planExport(parsed, 'simplifi');
  const row = readCSV(dataFiles(plan)[0].content)[1];
  assert.ok(row[1].startsWith("'=")); assert.ok(row[3].startsWith("'@"));
  assert.equal(row[2], '-12.50');
  assert.ok(parsed.transactions[0].payee.startsWith('='));
  assert.ok(plan.warnings.some(w => w.code === 'SPREADSHEET_TEXT_ESCAPED'));
});
test('Simplifi century guard blocks unsafe two-digit conversion while ISO export works', () => {
  const parsed = book(simple('D1/1/1926\nT1.00\nPHistory\n^\n'));
  assert.equal(E.planExport(parsed, 'simplifi').blocked, true);
  assert.equal(E.planExport(parsed, 'generic').blocked, false);
  assert.match(dataFiles(E.planExport(parsed, 'generic'))[0].content, /1926-01-01/);
});
test('original QIF path preserves investment records instead of reconstructing them', () => {
  const plan = E.planExport(book(), 'gnucash');
  assert.equal(dataFiles(plan).length, 0);
  assert.equal(plan.files.find(f => f.name.endsWith('.qif')).content, fixture);
  assert.match(plan.files[0].content, /tax-lot correctness/);
});
test('unknown destination and split policy fail explicitly', () => {
  assert.throws(() => E.planExport(book(), 'quicken-online'));
  assert.throws(() => E.planExport(book(), 'simplifi', { splitMode: 'discard' }));
});
test('whitespace-only payees get a disclosed placeholder in every CSV profile', () => {
  const parsed = book(simple('D1/1/2026\nT-1.00\nP   \n^\n'));
  for (const target of ['simplifi', 'simplifi-compat', 'monarch', 'ynab', 'actual', 'generic']) {
    const plan = E.planExport(parsed, target);
    assert.ok(plan.warnings.some(w => w.code === 'PAYEE_PLACEHOLDER'), target);
    assert.match(dataFiles(plan)[0].content, /Unspecified payee/, target);
  }
  assert.equal(parsed.transactions[0].payee, '   ');
});
test('split marker is structural, not a destination category; child tags stay in notes', () => {
  const parsed = book(simple('D1/1/2026\nT-10.00\nPShop\nL--Split--\nSFood/Family\n$-10.00\n^\n'));
  const plan = E.planExport(parsed, 'simplifi', { splitMode: 'preserve' });
  const row = readCSV(dataFiles(plan)[0].content)[1];
  assert.equal(row[3], '');
  assert.match(row[5], /Tags: Family/);
  assert.doesNotMatch(plan.files.find(f => f.name === 'review/categories.csv').content, /--Split--/);
});
test('split expansion is bounded before repeated text is materialized', () => {
  const source = simple('D1/1/2026\nT0.00\nPTest\nM' + 'm'.repeat(16000) + '\n' + 'SExample\n$0.00\n'.repeat(1000) + '^\n');
  const parsed = book(source), plan = E.planExport(parsed, 'simplifi');
  assert.equal(plan.blocked, true);
  assert.equal(dataFiles(plan).length, 0);
  assert.ok(plan.warnings.some(w => w.code === 'EXPANDED_EXPORT_LIMIT'));
  assert.ok(plan.files.find(f => f.name === 'portable-book.json'));
  assert.equal(E.planExport(parsed, 'simplifi', { splitMode: 'preserve' }).blocked, false);
});
