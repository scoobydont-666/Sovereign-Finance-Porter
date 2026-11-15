(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./model.js') : root.PorterModel);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PorterExporters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  const targets = Object.freeze([
    { id: 'simplifi', name: 'Quicken Simplifi', description: 'Seven-column banking CSV, one file per account. Pre-create your categories.' },
    { id: 'simplifi-compat', name: 'Quicken web Business & Personal / compatibility', description: 'Four-column CSV from the shared Quicken help. Confirm the current in-app template.' },
    { id: 'monarch', name: 'Monarch Money', description: 'Account, merchant, category, tags and notes CSV.' },
    { id: 'ynab', name: 'YNAB', description: 'Per-account inflow/outflow CSV; categories are retained in the memo.' },
    { id: 'actual', name: 'Actual Budget', description: 'Per-account CSV with explicit column mapping in Actual.' },
    { id: 'generic', name: 'Portable transaction CSV', description: 'Per-account ISO dates, exact amounts and categories; full metadata in JSON.' },
    { id: 'gnucash', name: 'GnuCash / native QIF', description: 'Original QIF with a native-import checklist; retains original investment records.' },
    { id: 'archive', name: 'Portable archive', description: 'Versioned JSON, original decoded source text and a detailed review report.' }
  ]);

  function sum(rows) { return M.fromMinor(rows.reduce((s, t) => s + M.toMinor(t.amount), 0n)); }
  function warning(code, message, count) {
    return count === undefined ? { code, message } : { code, message, count };
  }
  function filename(index, name) {
    const slug = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'account';
    return String(index + 1).padStart(4, '0') + '-' + slug + '.csv';
  }
  function dangerousText(value) { return /^[\s\u0000-\u0020]*[=+\-@]/u.test(String(value)); }
  function csvCell(value, isMoney, onEscape) {
    let text = String(value ?? '');
    // Quoting alone does not stop spreadsheet formulas. Monetary columns contain
    // validated numeric strings and must preserve their minus sign unchanged.
    if (!isMoney && dangerousText(text)) { text = "'" + text; onEscape(); }
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function csv(headers, rows, monetary, onEscape) {
    return headers.join(',') + '\r\n' + rows.map(row => row.map((value, i) => csvCell(value, monetary.has(i), onEscape)).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
  }
  function dateUS(iso, shortYear) {
    const [year, month, day] = iso.split('-');
    return Number(month) + '/' + Number(day) + '/' + (shortYear ? year.slice(-2) : year);
  }
  function splitDescription(tx) {
    return tx.splits.map(s => s.amount + ' ' + (s.transferAccount ? '[Transfer: ' + s.transferAccount + ']' : s.category || 'Uncategorized') + (s.tags.length ? ' [Tags: ' + s.tags.join(', ') + ']' : '') + (s.memo ? ' (' + s.memo + ')' : '')).join('; ');
  }
  function importPayee(row) { return row.payee.trim() ? row.payee : 'Unspecified payee'; }

  // Bound expansion before allocating repeated parent text for flattened splits.
  // Six bytes per UTF-16 code unit conservatively covers UTF-8 and CSV quoting.
  function exceedsCSVExpansion(book, splitMode) {
    const names = new Map(book.accounts.map(a => [a.id, a.name.length]));
    let projectedBytes = 0, rows = 0;
    for (const tx of book.transactions) {
      const base = tx.payee.length + tx.memo.length + tx.checkNumber.length + names.get(tx.accountId) + tx.tags.join(', ').length;
      const parts = splitMode === 'flatten' && tx.splits.length ? tx.splits : [tx];
      rows += parts.length;
      if (rows > 200000) return true;
      for (const part of parts) {
        let textLength = base + part.category.length + (part.transferAccount || '').length;
        if (part !== tx) textLength += part.memo.length + part.tags.join(', ').length;
        if (part === tx && tx.splits.length) {
          for (const s of tx.splits) textLength += 64 + s.category.length + s.memo.length + (s.transferAccount || '').length + s.tags.join(', ').length;
        }
        projectedBytes += 256 + textLength * 6;
        if (projectedBytes > 64 * 1024 * 1024) return true;
      }
    }
    return false;
  }
  function effectiveRows(transactions, splitMode) {
    const rows = [];
    for (const tx of transactions) {
      if (tx.splits.length && splitMode === 'flatten') {
        tx.splits.forEach((part, index) => rows.push({ ...tx, ...part,
          id: tx.id + '-split-' + (index + 1), parentId: tx.id,
          tags: [...new Set([...tx.tags, ...part.tags])],
          memo: [tx.memo, part.memo, 'Split ' + (index + 1) + '/' + tx.splits.length + ' of ' + tx.id].filter(Boolean).join(' | '),
          splits: [] }));
      } else {
        rows.push({ ...tx, memo: [tx.memo, tx.splits.length ? 'Original splits: ' + splitDescription(tx) : ''].filter(Boolean).join(' | ') });
      }
    }
    return rows;
  }
  function transferNote(row) {
    if (!row.transferAccount) return '';
    return 'Transfer reference: ' + row.transferAccount + '. Review and link in destination; no counterpart was generated.';
  }
  function note(row, includeCategory) {
    return [row.memo, transferNote(row), includeCategory && row.category ? 'Category: ' + row.category : '',
      includeCategory && row.tags.length ? 'Tags: ' + row.tags.join(', ') : '',
      row.checkNumber ? 'Check: ' + row.checkNumber : '', row.cleared ? 'Source cleared flag: ' + row.cleared : '']
      .filter(Boolean).join(' | ');
  }
  function duplicateGroups(transactions) {
    const groups = new Map();
    for (const tx of transactions) {
      const key = JSON.stringify([tx.accountId, tx.date, tx.amount, tx.payee.trim().toLowerCase()]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tx.id);
    }
    return [...groups.values()].filter(g => g.length > 1);
  }
  function analyze(book) {
    const grouped = new Map(book.accounts.map(a => [a.id, []]));
    for (const tx of book.transactions) grouped.get(tx.accountId).push(tx);
    return {
      accounts: book.accounts.map(a => {
        const tx = grouped.get(a.id);
        return { id: a.id, name: a.name, type: a.type, transactionCount: tx.length, total: sum(tx) };
      }),
      transactionCount: book.transactions.length,
      unsupportedCount: book.unsupportedRecords.length,
      duplicateGroups: duplicateGroups(book.transactions),
      issues: book.issues.slice()
    };
  }
  function transferWarnings(book) {
    const accountById = new Map(book.accounts.map(a => [a.id, a]));
    const legs = [];
    for (const tx of book.transactions) {
      for (const part of (tx.splits.length ? tx.splits : [tx])) {
        if (part.transferAccount) legs.push({ tx, part, from: accountById.get(tx.accountId).name });
      }
    }
    if (!legs.length) return [];
    let unmatched = 0, self = 0, ambiguous = 0;
    const index = new Map();
    for (const leg of legs) {
      const key = JSON.stringify([leg.from, leg.part.transferAccount, leg.tx.date, leg.part.amount]);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(leg);
    }
    for (const leg of legs) {
      if (leg.from === leg.part.transferAccount) { self++; continue; }
      const key = JSON.stringify([leg.part.transferAccount, leg.from, leg.tx.date, M.fromMinor(-M.toMinor(leg.part.amount))]);
      const n = (index.get(key) || []).length;
      if (!n) unmatched++;
      else if (n > 1) ambiguous++;
    }
    const result = [warning('TRANSFERS_REQUIRE_REVIEW', 'Transfer references are preserved, but CSVs do not recreate linked transfers. Review both accounts and spending classification; no opposite posting is synthesized.', legs.length)];
    if (self) result.push(warning('SELF_REFERENCES', 'Self-referencing transfers may be opening balances. Review them explicitly; a transaction sum is not an account balance.', self));
    if (unmatched) result.push(warning('UNMATCHED_TRANSFERS', 'Some transfer legs have no exact opposite same-date leg in this export. Different posting dates or missing history can explain this; no match is assumed.', unmatched));
    if (ambiguous) result.push(warning('AMBIGUOUS_TRANSFERS', 'More than one possible transfer counterpart was found. All original rows remain.', ambiguous));
    return result;
  }
  function columns(target) {
    switch (target) {
      case 'simplifi': return { headers: ['Date', 'Payee', 'Amount', 'Category', 'Tags', 'Notes', 'Check_No'], money: new Set([2]), row: r => [dateUS(r.date, true), importPayee(r), r.amount, r.transferAccount ? '' : r.category, r.tags.join(', '), note(r, false), r.checkNumber] };
      case 'simplifi-compat': return { headers: ['Date', 'Payee', 'Amount', 'Tags'], money: new Set([2]), row: r => [dateUS(r.date, false), importPayee(r), r.amount, r.tags.join(', ')] };
      case 'monarch': return { headers: ['Date', 'Merchant Name', 'Data Provider Description', 'Amount', 'Category', 'Account', 'Tags', 'Notes'], money: new Set([3]), row: (r, a) => [r.date, importPayee(r), r.payee, r.amount, r.transferAccount ? '' : r.category, a.name, r.tags.join(', '), note(r, false)] };
      case 'ynab': return { headers: ['Date', 'Payee', 'Memo', 'Outflow', 'Inflow'], money: new Set([3, 4]), row: r => [dateUS(r.date, false), importPayee(r), note(r, true), M.toMinor(r.amount) < 0n ? M.fromMinor(-M.toMinor(r.amount)) : '', M.toMinor(r.amount) >= 0n ? r.amount : ''] };
      case 'actual': return { headers: ['Date', 'Payee', 'Notes', 'Category', 'Amount'], money: new Set([4]), row: r => [r.date, importPayee(r), note(r, false), r.transferAccount ? '' : r.category, r.amount] };
      case 'generic': return { headers: ['date', 'payee', 'amount', 'category'], money: new Set([2]), row: r => [r.date, importPayee(r), r.amount, r.transferAccount ? '' : r.category] };
      default: throw new Error('Unknown CSV target.');
    }
  }
  function checklist(target) {
    const common = [
      'This bundle contains private financial information in unencrypted files. Keep it on trusted storage.',
      'Keep your original QDF backup and the original QIF file. Source text here is decoded UTF-8, not a byte-for-byte backup of another encoding.',
      'Check date interpretation, account names, signs, opening balances, splits and transfer pairs before importing.',
      'Import a small fictional test into a disposable destination first. This converter does not log into or change any destination.',
      'Transaction net movements in the report are NOT verified account balances or net worth. Establish opening balances and compare statements.',
      'Do not reimport a batch blindly: destination matching and duplicate behavior differ. Stable source IDs do not guarantee exactly-once import.',
      'Original source and canonical archive retain unsupported data. Budgets, attachments, bank connections, rules and tax lots are not recreated.'
    ];
    if (target === 'simplifi') common.push('Simplifi: create matching parent categories and subcategories before importing. Select one target account and the generic CSV import option. Confirm its current template matches the seven columns.', 'Simplifi: the documented date format has a two-digit year. Check every date century. Deleted imported records cannot be restored by reimporting the same file into the same account.');
    if (target === 'simplifi-compat') common.push('Compatibility profile: the shared Simplifi / Business & Personal help documents four columns. Confirm the live template. Categories, notes and checks are available only in archive/review files for this profile.');
    if (target === 'monarch') common.push('Monarch: carefully choose overlap handling. Prioritize CSV deletes existing transactions inside the CSV date range; Import all may duplicate them. Review account, category and tag mapping.');
    if (target === 'ynab') common.push('YNAB: import each file into its matching account. CSV import does not create categories or split relationships; category details are in Memo. Review transfers and starting balances.');
    if (target === 'actual') common.push('Actual Budget: pre-create and map categories using review/categories.csv. Choose CSV import, map Date/Payee/Notes/Category/Amount, use YYYY-MM-DD, signed amounts, and do not reverse signs. Review Actual matching carefully. CSV does not supply native transfer/split identities.');
    if (target === 'generic') common.push('Portable CSV: columns date,payee,amount,category. Dates are ISO; expenses are negative. Memo, tags and other metadata remain in the archive. Transfer linking is destination-specific. Source-local record IDs are deliberately not exported as cross-file deduplication keys.');
    if (target === 'gnucash') common.push('GnuCash: import original-source/*.qif through File > Import > Import QIF. Use a new disposable book first. Match accounts, categories and securities in the native wizard; supply USD explicitly. This route passes through the original QIF, including unsupported records. It does not prove investment/tax-lot correctness.');
    return common;
  }
  function planExport(inputBook, target, options = {}) {
    if (!targets.some(t => t.id === target)) throw new Error('Choose a supported destination.');
    const book = M.validateBook(inputBook);
    const splitMode = options.splitMode || 'flatten';
    if (!['flatten', 'preserve'].includes(splitMode)) throw new Error('Choose flatten or preserve for split handling.');
    const isCSV = !['archive', 'gnucash'].includes(target);
    const report = analyze(book);
    const warnings = [];
    const files = [];
    let blocked = isCSV && book.issues.some(i => i.severity === 'error');
    const splitCount = book.transactions.filter(t => t.splits.length).length;
    if (book.issues.some(i => i.severity === 'error')) warnings.push(warning('SOURCE_ERRORS', 'Input has blocking parse or integrity errors. CSV output is disabled; repair a copy of the source and read it again. Original source remains archived.'));
    if (book.unsupportedRecords.length) warnings.push(warning('UNSUPPORTED_RECORDS', 'Some source records cannot be converted into banking CSV. They remain in the original source and portable archive, including investment activity where present.', book.unsupportedRecords.length));
    if (isCSV && splitCount) warnings.push(warning(splitMode === 'flatten' ? 'SPLITS_FLATTENED' : 'SPLITS_IN_NOTES', splitMode === 'flatten' ? 'Each split becomes an independent transaction. Amounts reconcile to the original parent; native split relationships are not recreated.' : 'Each split parent is exported once. Child detail remains in notes where supported and always in the archive; child categories are not separately imported.', splitCount));
    if (isCSV) warnings.push(...transferWarnings(book));
    if (report.duplicateGroups.length) warnings.push(warning('POSSIBLE_DUPLICATES', 'Same-account/date/amount/payee candidates were found. They may be legitimate repeated purchases. None were automatically removed.', report.duplicateGroups.length));
    const missingPayees = book.transactions.filter(t => !t.payee.trim()).length;
    if (isCSV && missingPayees) warnings.push(warning('PAYEE_PLACEHOLDER', 'Blank payees become "Unspecified payee" for destination compatibility; original blanks remain archived.', missingPayees));
    if (isCSV) warnings.push(warning('NO_COMPLETE_DATABASE_MIGRATION', 'These are transaction-history files. Bank connections, budget rules, attachments, securities holdings, cost basis, tax lots, and verified balance history require separate handling.'));
    if (target === 'simplifi') {
      warnings.push(warning('PRECREATE_CATEGORIES', 'Simplifi only assigns categories and subcategories that already exist. Use review/categories.csv before importing.'));
      warnings.push(warning('TEMPLATE_CONFLICT', 'Current Simplifi support documents seven columns and M/D/YY; shared Quicken help documents four columns and M/D/YYYY. This profile follows the seven-column article. Confirm the live template before import.'));
      warnings.push(warning('TWO_DIGIT_DESTINATION_YEAR', 'Simplifi documentation requires two-digit years. Source centuries stay in the archive; verify their interpretation in a disposable destination.'));
      const centuries = book.transactions.filter(t => Number(t.date.slice(0, 4)) < 1970 || Number(t.date.slice(0, 4)) > 2069);
      if (centuries.length) { blocked = true; warnings.push(warning('UNSAFE_DESTINATION_CENTURY', 'Some dates fall outside the explicit 1970–2069 window for the two-digit Simplifi profile. Select the four-digit compatibility profile only after confirming its live template.', centuries.length)); }
      if (book.transactions.some(t => t.tags.length > 1 || t.splits.some(s => s.tags.length > 1))) warnings.push(warning('VERIFY_MULTI_TAGS', 'Multiple tags use comma-separated text. The Simplifi article does not specify escaping for multiple tag names; verify a sample and preserve exact tag arrays in the archive.'));
    }
    if (target === 'simplifi-compat') warnings.push(warning('FOUR_COLUMN_LIMITS', 'This compatibility profile cannot carry categories, notes or check numbers. Those details remain in the archive and review files. Confirm the current web-product template.'));
    if (target === 'ynab') warnings.push(warning('YNAB_CATEGORY_LIMITS', 'YNAB file import does not support category or split import. Categories and tags are retained in Memo.'));
    if (target === 'monarch') warnings.push(warning('MONARCH_OVERLAP', 'Monarch Prioritize CSV deletes existing entries inside the import date interval. Import all may create duplicates. Choose intentionally in Monarch.'));
    if (target === 'actual') warnings.push(warning('ACTUAL_MAPPING', 'Pre-create and map categories; map CSV columns and use YYYY-MM-DD and signed amounts. Existing transaction matching may merge candidates; review the result. Native API integration is not implemented.'));
    if (target === 'generic') warnings.push(warning('GENERIC_METADATA_LIMITS', 'Portable CSV carries date, payee, amount and category only. Use the JSON archive for memo, tags, splits, transfers and raw fields. No cross-file deduplication IDs are invented.'));
    if (isCSV && book.transactions.length === 0) { blocked = true; warnings.push(warning('NO_BANKING_TRANSACTIONS', 'No supported banking transactions are available for CSV export. Preserve the archive and use a native import path where appropriate.')); }
    if (isCSV && exceedsCSVExpansion(book, splitMode)) {
      blocked = true;
      warnings.push(warning('EXPANDED_EXPORT_LIMIT', 'The proposed CSV exceeds the conservative 64 MiB expansion budget or 200,000-row limit. Preserve split parents or use a smaller source history. The archive remains available.'));
    }
    const summary = { sourceTransactions: book.transactions.length, exportedRows: 0, unsupportedRecords: book.unsupportedRecords.length,
      sourceNet: sum(book.transactions), exportNet: '0.00', currency: book.currency, accounts: [], text: '' };
    let escaped = 0;
    const onEscape = () => { escaped++; };
    if (isCSV && !blocked) {
      const spec = columns(target);
      let total = 0n;
      const grouped = new Map(book.accounts.map(a => [a.id, []]));
      for (const tx of book.transactions) grouped.get(tx.accountId).push(tx);
      book.accounts.forEach((account, index) => {
        const tx = grouped.get(account.id);
        if (!tx.length) return;
        const rows = effectiveRows(tx, splitMode);
        const sourceNet = sum(tx), exportNet = sum(rows);
        if (sourceNet !== exportNet) throw new Error('Internal reconciliation failed; no export is safe.');
        const name = 'import/' + filename(index, account.name);
        files.push({ name, content: csv(spec.headers, rows.map(r => spec.row(r, account)), spec.money, onEscape) });
        summary.accounts.push({ accountId: account.id, name: account.name, file: name, sourceTransactions: tx.length, exportedRows: rows.length, sourceNet, exportNet });
        summary.exportedRows += rows.length;
        total += M.toMinor(exportNet);
      });
      summary.exportNet = M.fromMinor(total);
    }
    const categories = new Set(book.categories.map(c => c.name));
    for (const tx of book.transactions) {
      if (tx.category && !tx.transferAccount) categories.add(tx.category);
      tx.splits.forEach(s => { if (s.category && !s.transferAccount) categories.add(s.category); });
    }
    files.push({ name: 'review/categories.csv', content: csv(['Category'], [...categories].sort().map(c => [c]), new Set(), onEscape) });
    files.push({ name: 'review/accounts.csv', content: csv(['Account', 'Type', 'Currency', 'Transaction count', 'Net movement (NOT balance)'], report.accounts.map(a => [a.name, a.type, book.currency, a.transactionCount, a.total]), new Set([3, 4]), onEscape) });
    if (escaped) warnings.push(warning('SPREADSHEET_TEXT_ESCAPED', 'Text beginning with a spreadsheet formula marker was prefixed with an apostrophe in CSV. This may change its displayed/imported name. Original text remains unchanged in JSON and QIF.', escaped));
    book.sources.forEach((source, index) => {
      if (source.format === 'qif') files.push({ name: 'original-source/source-' + (index + 1) + '.qif', content: source.text });
    });
    if (target === 'gnucash' && !files.some(f => f.name.endsWith('.qif'))) {
      blocked = true; warnings.push(warning('NO_ORIGINAL_QIF', 'No original QIF is retained in this archive. No native-QIF import file can be supplied.'));
    }
    summary.text = isCSV
      ? (blocked ? 'CSV export is blocked. Archive and review files remain available.' : summary.sourceTransactions + ' source transactions → ' + summary.exportedRows + ' CSV rows. Source and exported net movement: ' + summary.sourceNet + ' ' + book.currency + '. This is not an account balance.')
      : 'Original source, canonical data and review report retained. No transaction conversion is claimed for the native QIF route.';
    const reportJSON = { schemaVersion: '1.0.0', target, splitMode, status: blocked ? 'blocked' : 'ready-for-user-review', summary,
      warnings, sourceIssues: book.issues, possibleDuplicates: report.duplicateGroups,
      checklist: checklist(target), evidence: 'Format conformance tested locally; live destination acceptance is not verified.' };
    const archiveJSON = JSON.stringify(book, null, 2) + '\n';
    if (new TextEncoder().encode(archiveJSON).length > 100 * 1024 * 1024) throw new Error('Portable JSON would exceed its 100 MiB reload limit. Use a smaller source history; no migration kit was produced.');
    files.push({ name: 'portable-book.json', content: archiveJSON });
    files.push({ name: 'migration-report.json', content: JSON.stringify(reportJSON, null, 2) + '\n' });
    files.unshift({ name: 'README-FIRST.txt', content: 'SOVEREIGN FINANCE PORTER — REVIEW BEFORE IMPORT\n\nTarget: ' + targets.find(t => t.id === target).name + '\n' + summary.text + '\n\n' + checklist(target).map((s, i) => (i + 1) + '. ' + s).join('\n\n') + '\n\nFidelity warnings\n' + warnings.map(w => '- [' + w.code + '] ' + w.message + (w.count === undefined ? '' : ' Count: ' + w.count)).join('\n') + '\n\nAccount files\n' + summary.accounts.map(a => a.file + ' → ' + a.name + ' (' + a.exportedRows + ' rows, net ' + a.exportNet + ')').join('\n') + '\n' });
    return { target, files, warnings, blocked, summary };
  }
  return Object.freeze({ targets, analyze, planExport });
});
