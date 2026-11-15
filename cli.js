#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseQif } = require('./core/qif.js');
const { validateBook } = require('./core/model.js');
const { analyze, planExport, targets } = require('./core/exporters.js');
const { makeZip } = require('./core/zip.js');

function help() {
  return `Sovereign Finance Porter 0.1.0-alpha.1 — offline financial data conversion

Usage: node cli.js SOURCE.qif [options]
       node cli.js portable-book.json [options]

  --target NAME          ${targets.map(t => t.id).join(', ')}
  --out PATH.zip         New output file (existing files are never overwritten)
  --inspect              Print counts and issue codes only; no output file
  --account NAME         Account name for a single-account QIF with no account header
  --date-order mdy|dmy    Explicit source date interpretation (default: mdy)
  --encoding utf-8|windows-1252  QIF text encoding (default: strict utf-8)
  --currency USD         Required confirmation for converting QIF into a ZIP
  --splits flatten|preserve     Flatten splits, or parent with detail in notes
  --acknowledge-losses    Confirm you reviewed target limitations and input warnings
  --help                 Show this help

USD only in this alpha. QIF does not identify currency; confirm your source is USD.
QDF and QXF are not supported. Export QIF from Quicken Classic first.
No data is uploaded. Output ZIPs are unencrypted and contain financial records.
`;
}
function main(args) {
  if (args.includes('--help') || args.length === 0) { process.stdout.write(help()); return 0; }
  const options = { target: 'archive', dateOrder: 'mdy', encoding: 'utf-8', splitMode: 'flatten' };
  const fields = new Map([['--target', 'target'], ['--out', 'out'], ['--account', 'accountName'], ['--date-order', 'dateOrder'], ['--encoding', 'encoding'], ['--splits', 'splitMode'], ['--currency', 'currency']]);
  let source;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (fields.has(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('A command-line option is missing its value. Use --help.');
      options[fields.get(arg)] = args[++i];
    } else if (arg === '--inspect') options.inspect = true;
    else if (arg === '--acknowledge-losses') options.acknowledged = true;
    else if (arg.startsWith('--')) throw new Error('Unknown command-line option. Use --help.');
    else if (source) throw new Error('Provide exactly one source file.');
    else source = arg;
  }
  if (!source) throw new Error('Provide a QIF or portable-book JSON source.');
  if (!['mdy', 'dmy'].includes(options.dateOrder)) throw new Error('Date order must be mdy or dmy.');
  if (!['utf-8', 'windows-1252'].includes(options.encoding)) throw new Error('Choose utf-8 or windows-1252 encoding.');
  if (!['flatten', 'preserve'].includes(options.splitMode)) throw new Error('Split handling must be flatten or preserve.');
  if (!targets.some(t => t.id === options.target)) throw new Error('Choose a supported target. Use --help.');
  if (options.currency && options.currency !== 'USD') throw new Error('This alpha supports USD only. Do not combine currencies.');
  const ext = path.extname(source).toLowerCase();
  if (!['.qif', '.json'].includes(ext)) throw new Error('Unsupported source. QDF/QXF must be exported to QIF inside Quicken Classic.');
  const stat = fs.statSync(source);
  if (!stat.isFile() || stat.size > (ext === '.qif' ? 25 : 100) * 1024 * 1024) throw new Error('Source must be a regular QIF up to 25 MiB or archive JSON up to 100 MiB.');
  let text;
  try { text = new TextDecoder(ext === '.json' ? 'utf-8' : options.encoding, { fatal: true }).decode(fs.readFileSync(source)); }
  catch { throw new Error('Cannot decode source with the selected encoding. QIF may require --encoding windows-1252.'); }
  let book;
  if (ext === '.json') {
    let value;
    try { value = JSON.parse(text); } catch { throw new Error('Invalid JSON archive.'); }
    book = validateBook(value);
  } else book = parseQif(text, { sourceName: path.basename(source), accountName: options.accountName || 'Imported account', dateOrder: options.dateOrder, currency: 'USD' });
  const analysis = analyze(book);
  if (options.inspect) {
    process.stdout.write(JSON.stringify({ accounts: analysis.accounts.length, transactions: analysis.transactionCount, unsupportedRecords: analysis.unsupportedCount,
      possibleDuplicateGroups: analysis.duplicateGroups.length, issues: book.issues.map(i => ({ severity: i.severity, code: i.code, sourceRecord: i.sourceRecord, line: i.line })) }, null, 2) + '\n');
    return book.issues.some(i => i.severity === 'error') ? 2 : 0;
  }
  if (!options.out || path.extname(options.out).toLowerCase() !== '.zip') throw new Error('Choose a new --out PATH.zip, or use --inspect.');
  if (ext === '.qif' && options.currency !== 'USD') throw new Error('QIF omits currency. Confirm this source is entirely USD with --currency USD.');
  const plan = planExport(book, options.target, { splitMode: options.splitMode });
  for (const w of plan.warnings) process.stderr.write('[' + w.code + '] ' + w.message + '\n');
  if (plan.blocked) throw new Error('Destination export is blocked. Repair the source or use --target archive to retain its evidence.');
  if (options.target !== 'archive' && !options.acknowledged) throw new Error('Review the reported limitations, then add --acknowledge-losses. No file was written.');
  const bytes = makeZip(plan.files);
  // wx fails atomically if the output exists, including a symlink. No --force.
  let fd;
  try {
    fd = fs.openSync(options.out, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) { fs.closeSync(fd); fd = undefined; fs.unlinkSync(options.out); }
    if (error.code === 'EEXIST') throw new Error('Output already exists. Choose a new output filename; nothing was overwritten.');
    throw new Error('Cannot write the output file. Check directory access and free space.');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
  process.stdout.write('Created migration ZIP: ' + plan.files.length + ' files; ' + plan.summary.sourceTransactions + ' source transactions; ' + plan.summary.exportedRows + ' target CSV rows.\n');
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) {
    // Node filesystem errors can contain private filenames. Known OS failures
    // are replaced; parser messages contain only record positions and reasons.
    process.stderr.write('Error: ' + (error.code ? 'Cannot access the requested local file.' : error.message) + '\n');
    process.exitCode = 1;
  }
}
module.exports = { main };
