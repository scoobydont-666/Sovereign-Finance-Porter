/* Browser-only orchestration. Financial parsing and exporting live in core/. */
(() => {
  'use strict';

  const MAX_QIF_BYTES = 25 * 1024 * 1024;
  const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
  const PAGE_SIZE = 50;
  const byId = (id) => document.getElementById(id);
  const ui = {};
  [
    'source-file', 'drop-zone', 'file-title', 'file-description', 'date-order',
    'encoding', 'account-name', 'currency-confirm', 'read-button', 'demo-button',
    'clear-button', 'app-status', 'app-error', 'demo-banner', 'review-content',
    'review-empty', 'review-tag', 'review-heading', 'stat-accounts',
    'stat-transactions', 'stat-unsupported', 'accounts-body', 'issues-section',
    'issues-list', 'transactions-body', 'preview-range', 'previous-page',
    'next-page', 'destination-controls', 'target-select', 'split-mode',
    'target-description', 'export-summary', 'summary-source', 'summary-rows',
    'summary-net', 'summary-text', 'export-blocked', 'warnings-section',
    'warnings-list', 'files-details', 'files-heading', 'files-list',
    'export-confirm', 'download-button', 'nav-source', 'nav-review',
    'nav-destination',
  ].forEach((id) => { ui[id] = byId(id); });

  let selectedFile = null;
  let demoSource = false;
  let book = null;
  let analysis = null;
  let plan = null;
  let page = 0;
  let busy = false;
  let generation = 0;
  let objectUrl = null;
  let revokeTimer = null;

  const DEMO = [
    '!Account', 'NExample Checking', 'TBank', '^', '!Type:Bank',
    'D10/01/2026', 'T2500.00', 'PExample Payroll', 'LSalary', 'CX', '^',
    'D10/02/2026', 'T-82.40', 'PExample Market', 'MWeekly groceries and household supplies',
    'SFood:Groceries', '$-62.40', 'SHousehold', '$-20.00', '^',
    'D10/03/2026', 'T-300.00', 'PTransfer to savings', 'L[Example Savings]', '^',
    'D10/04/2026', 'T-24.95', 'PExample Books', 'LEducation', 'N1042', '^',
    'D10/05/2026', 'T12.50', 'PExample Market', 'MRefund', 'LFood:Groceries', '^',
    '!Account', 'NExample Savings', 'TBank', '^', '!Type:Bank',
    'D10/03/2026', 'T300.00', 'PTransfer from checking', 'L[Example Checking]', '^',
    'D10/31/2026', 'T3.42', 'PExample Bank', 'LInterest', '^',
    '!Type:Cat', 'NFood:Groceries', 'E', '^', 'NSalary', 'I', '^',
  ].join('\n') + '\n';

  function setText(node, value) { node.textContent = String(value ?? ''); }
  function status(message) { setText(ui['app-status'], message); }
  function hideError() { ui['app-error'].hidden = true; setText(ui['app-error'], ''); }
  function showError(message) { setText(ui['app-error'], message); ui['app-error'].hidden = false; }
  function clearChildren(node) { node.replaceChildren(); }
  function releaseDownload() {
    if (revokeTimer !== null) { clearTimeout(revokeTimer); revokeTimer = null; }
    if (objectUrl !== null) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  }

  function money(value) {
    const text = String(value ?? '0.00');
    if (!/^-?\d+\.\d{2}$/.test(text)) return text;
    const negative = text.startsWith('-');
    const [whole, fraction] = (negative ? text.slice(1) : text).split('.');
    return (negative ? '−' : '') + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fraction;
  }

  function makeCell(value, numeric = false) {
    const cell = document.createElement('td');
    setText(cell, value);
    if (numeric) cell.className = 'numeric';
    return cell;
  }

  function setStep(step) {
    ['source', 'review', 'destination'].forEach((name, index) => {
      const node = ui['nav-' + name];
      node.classList.toggle('current', index === step - 1);
      node.classList.toggle('completed', index < step - 1);
      if (index === step - 1) node.setAttribute('aria-current', 'step');
      else node.removeAttribute('aria-current');
    });
  }

  function updateButtons() {
    ui['read-button'].disabled = busy || !selectedFile || !ui['currency-confirm'].checked;
    ui['demo-button'].disabled = busy;
    ui['clear-button'].disabled = !selectedFile && !book && !busy;
    ui['source-file'].disabled = busy;
    ['date-order', 'encoding', 'account-name', 'currency-confirm'].forEach((id) => { ui[id].disabled = busy; });
    ui['destination-controls'].disabled = busy || !book;
    ui['download-button'].disabled = busy || !plan || plan.blocked || !ui['export-confirm'].checked;
    ui['previous-page'].disabled = busy || page === 0;
    ui['next-page'].disabled = busy || !book || (page + 1) * PAGE_SIZE >= book.transactions.length;
    document.body.classList.toggle('busy', busy);
    ui['read-button'].setAttribute('aria-busy', String(busy));
  }

  function clearReview() {
    book = null;
    analysis = null;
    plan = null;
    page = 0;
    releaseDownload();
    ui['review-content'].hidden = true;
    ui['review-empty'].hidden = false;
    ui['review-tag'].textContent = 'Waiting for a file';
    ui['export-confirm'].checked = false;
    ui['export-summary'].hidden = true;
    ui['export-blocked'].hidden = true;
    ui['warnings-section'].hidden = true;
    ui['files-details'].hidden = true;
    clearChildren(ui['accounts-body']);
    clearChildren(ui['transactions-body']);
    clearChildren(ui['issues-list']);
    clearChildren(ui['warnings-list']);
    clearChildren(ui['files-list']);
    setText(ui['target-description'], '');
    setStep(1);
    updateButtons();
  }

  function invalidateSource() {
    generation += 1;
    clearReview();
    hideError();
    if (selectedFile) status('Source options changed. Read the export again to refresh the preview.');
  }

  function selectFile(file, demo = false) {
    if (busy) return;
    generation += 1;
    clearReview();
    hideError();
    selectedFile = null;
    demoSource = false;
    ui['currency-confirm'].checked = demo;
    ui['demo-banner'].hidden = true;
    ui['drop-zone'].classList.remove('has-file');
    setText(ui['file-title'], 'Choose your Quicken export');
    setText(ui['file-description'], 'Drop a .qif file here, or select one from your computer.');
    if (!file) { updateButtons(); return; }
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['qif', 'json'].includes(extension)) {
      showError(['qdf', 'qxf'].includes(extension)
        ? 'That is a Quicken database or transfer file, not a QIF export. In Quicken Classic, use File → File Export → QIF file, then select the .qif file here.'
        : 'Choose a .qif export or a .json archive previously produced by Porter. Other formats are not supported.');
      ui['source-file'].value = '';
      updateButtons();
      return;
    }
    const limit = extension === 'json' ? MAX_ARCHIVE_BYTES : MAX_QIF_BYTES;
    if (file.size > limit || file.size === 0) {
      showError(file.size === 0 ? 'This file is empty. Choose an export containing your records.' : 'This file exceeds the ' + (extension === 'json' ? '100' : '25') + ' MiB limit for this format. Use a smaller source history.');
      ui['source-file'].value = '';
      updateButtons();
      return;
    }
    selectedFile = file;
    demoSource = demo;
    ui['demo-banner'].hidden = !demo;
    ui['drop-zone'].classList.add('has-file');
    setText(ui['file-title'], file.name);
    setText(ui['file-description'], (file.size < 1024 ? file.size + ' bytes' : (file.size / 1024).toFixed(1) + ' KiB') + ' · Selected locally. Nothing has been uploaded.');
    status(extension === 'json'
      ? 'Archive selected. Its saved account and date settings will be preserved. Confirm USD, then read the archive.'
      : 'Export selected. Check the date order, encoding, and USD confirmation, then read the export.');
    updateButtons();
  }

  function renderIssues() {
    clearChildren(ui['issues-list']);
    const issues = analysis.issues || book.issues || [];
    ui['issues-section'].hidden = issues.length === 0;
    issues.slice(0, 100).forEach((issue) => {
      const row = document.createElement('li');
      row.className = issue.severity === 'error' ? 'error' : issue.severity === 'info' ? 'info' : '';
      const label = document.createElement('span');
      label.className = 'issue-label';
      setText(label, issue.severity === 'error' ? 'Needs correction.' : issue.severity === 'info' ? 'Note.' : 'Review.');
      const text = document.createElement('span');
      setText(text, issue.message + (issue.line ? ' (Source line ' + issue.line + ')' : ''));
      row.append(label, text);
      ui['issues-list'].append(row);
    });
    if (issues.length > 100) {
      const row = document.createElement('li');
      setText(row, 'Showing the first 100 of ' + issues.length + ' notes. The migration report includes all notes.');
      ui['issues-list'].append(row);
    }
  }

  function renderTransactions() {
    if (!book) return;
    clearChildren(ui['transactions-body']);
    const names = new Map(book.accounts.map((account) => [account.id, account.name]));
    const start = page * PAGE_SIZE;
    const slice = book.transactions.slice(start, start + PAGE_SIZE);
    slice.forEach((transaction) => {
      const row = document.createElement('tr');
      const category = transaction.transferAccount ? 'Transfer → ' + transaction.transferAccount
        : transaction.splits.length ? transaction.splits.length + ' splits' : transaction.category || 'Uncategorized';
      row.append(makeCell(transaction.date), makeCell(transaction.payee || '(No payee)'),
        makeCell(names.get(transaction.accountId) || transaction.accountId), makeCell(category));
      const amount = makeCell(money(transaction.amount), true);
      if (transaction.amount.startsWith('-')) amount.classList.add('negative');
      row.append(amount);
      ui['transactions-body'].append(row);
    });
    setText(ui['preview-range'], slice.length ? (start + 1) + '–' + (start + slice.length) + ' of ' + book.transactions.length : 'No supported transactions');
    updateButtons();
  }

  function renderBook() {
    analysis = PorterExporters.analyze(book);
    ui['review-empty'].hidden = true;
    ui['review-content'].hidden = false;
    setText(ui['review-tag'], demoSource ? 'Fictional example' : 'Local preview');
    setText(ui['stat-accounts'], analysis.accounts.length);
    setText(ui['stat-transactions'], analysis.transactionCount);
    setText(ui['stat-unsupported'], analysis.unsupportedCount);
    clearChildren(ui['accounts-body']);
    analysis.accounts.forEach((account) => {
      const row = document.createElement('tr');
      row.append(makeCell(account.name), makeCell(account.type), makeCell(account.transactionCount, true), makeCell(money(account.total), true));
      ui['accounts-body'].append(row);
    });
    renderIssues();
    renderTransactions();
    setStep(2);
    refreshPlan();
  }

  async function readSource() {
    if (busy || !selectedFile || !ui['currency-confirm'].checked) return;
    const token = ++generation;
    const file = selectedFile;
    const options = {sourceName:file.name, accountName:ui['account-name'].value.trim() || 'Imported account', currency:'USD', dateOrder:ui['date-order'].value};
    // Archives are always generated as UTF-8. A previous QIF setting must not
    // reinterpret both the preserved source and its normalized fields together.
    const encoding = file.name.toLowerCase().endsWith('.json') ? 'utf-8' : ui.encoding.value;
    clearReview();
    hideError();
    busy = true;
    updateButtons();
    status('Reading your file locally…');
    try {
      const buffer = await file.arrayBuffer();
      if (token !== generation) return;
      let text;
      try { text = new TextDecoder(encoding, {fatal:true}).decode(buffer); }
      catch { throw new Error('The file could not be decoded as UTF-8. For an older Windows QIF export, choose Windows-1252 and read it again.'); }
      if (file.name.toLowerCase().endsWith('.json')) {
        let parsed;
        try { parsed = JSON.parse(text); }
        catch { throw new Error('This is not valid JSON. Choose the complete portable archive generated by Porter.'); }
        book = PorterModel.validateBook(parsed);
      } else {
        book = PorterQif.parseQif(text, options);
      }
      if (token !== generation) { book = null; return; }
      renderBook();
      status('Your local preview is ready. Review the accounts and notes before choosing a destination.');
      ui['review-heading'].focus({preventScroll:true});
      byId('review').scrollIntoView({behavior:'smooth', block:'start'});
    } catch (error) {
      if (token !== generation) return;
      clearReview();
      showError(error instanceof Error ? error.message : 'This file could not be read. No data has been changed.');
      status('The file needs attention. Check its format and source options, then try again.');
    } finally {
      if (token === generation) { busy = false; updateButtons(); }
    }
  }

  function refreshPlan() {
    releaseDownload();
    plan = null;
    ui['export-confirm'].checked = false;
    clearChildren(ui['warnings-list']);
    clearChildren(ui['files-list']);
    ui['export-summary'].hidden = true;
    ui['export-blocked'].hidden = true;
    ui['warnings-section'].hidden = true;
    ui['files-details'].hidden = true;
    if (!book) { updateButtons(); return; }
    const targetId = ui['target-select'].value;
    const target = PorterExporters.targets.find((entry) => entry.id === targetId);
    setText(ui['target-description'], target ? target.description : '');
    try {
      plan = PorterExporters.planExport(book, targetId, {splitMode:ui['split-mode'].value, acknowledgements:true});
      const summary = plan.summary;
      if (summary) {
        ui['export-summary'].hidden = false;
        setText(ui['summary-source'], summary.sourceTransactions ?? book.transactions.length);
        setText(ui['summary-rows'], summary.exportedRows ?? 0);
        setText(ui['summary-net'], money(summary.exportNet ?? summary.sourceNet ?? '0.00'));
        setText(ui['summary-text'], summary.text || 'Check each account’s source and exported totals in the migration report. Net activity is not an account balance.');
      }
      const warnings = plan.warnings || [];
      ui['warnings-section'].hidden = warnings.length === 0;
      warnings.slice(0,100).forEach((warning) => {
        const row = document.createElement('li');
        setText(row, warning.message + (warning.count ? ' (' + warning.count + ' affected)' : ''));
        ui['warnings-list'].append(row);
      });
      if (warnings.length > 100) {
        const row = document.createElement('li');
        setText(row, 'Showing 100 of ' + warnings.length + ' warnings. Read the full migration report in the archive.');
        ui['warnings-list'].append(row);
      }
      if (plan.blocked) {
        ui['export-blocked'].hidden = false;
        setText(ui['export-blocked'], 'This destination cannot be exported with the current source and settings. Review the reasons below. Correct any source errors and read the file again, or choose another compatible destination. The portable archive retains your source and diagnostic report.');
      }
      ui['files-details'].hidden = false;
      setText(ui['files-heading'], 'Files in your migration kit (' + plan.files.length + ')');
      plan.files.forEach((file) => {
        const row = document.createElement('li');
        setText(row, file.name);
        ui['files-list'].append(row);
      });
      setText(ui['download-button'], targetId === 'archive' ? 'Download preservation archive ↓' : 'Download migration kit ↓');
    } catch (error) {
      plan = null;
      ui['export-blocked'].hidden = false;
      setText(ui['export-blocked'], error instanceof Error ? error.message : 'The destination export could not be prepared. No data has been changed.');
    }
    updateButtons();
  }

  function download() {
    if (busy || !plan || plan.blocked || !ui['export-confirm'].checked || !book) return;
    const token = generation;
    const currentPlan = plan;
    busy = true;
    hideError();
    updateButtons();
    status('Preparing the migration kit on your computer…');
    try {
      const bytes = PorterZip.makeZip(currentPlan.files);
      if (token !== generation || currentPlan !== plan) return;
      releaseDownload();
      objectUrl = URL.createObjectURL(new Blob([bytes], {type:'application/zip'}));
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = 'finance-porter-' + ui['target-select'].value + (demoSource ? '-fictional-demo' : '') + '.zip';
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      revokeTimer = setTimeout(releaseDownload, 30000);
      setStep(3);
      status('Migration kit prepared and sent to your browser’s downloads. Nothing was imported into another app. Follow the included checklist and verify the results there.');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'The migration kit could not be prepared. Your source file is unchanged.');
      status('Download could not be prepared. Your source file is unchanged.');
    } finally {
      busy = false;
      updateButtons();
    }
  }

  function reset() {
    generation += 1;
    busy = false;
    selectedFile = null;
    demoSource = false;
    ui['source-file'].value = '';
    ui['currency-confirm'].checked = false;
    ui['account-name'].value = 'Imported account';
    ui['date-order'].value = 'mdy';
    ui.encoding.value = 'utf-8';
    ui['split-mode'].value = 'flatten';
    ui['demo-banner'].hidden = true;
    ui['drop-zone'].classList.remove('has-file', 'drag-over');
    setText(ui['file-title'], 'Choose your Quicken export');
    setText(ui['file-description'], 'Drop a .qif file here, or select one from your computer.');
    clearReview();
    hideError();
    status('Workspace cleared. Files already downloaded remain on your computer.');
    ui['source-file'].focus();
  }

  function initialize() {
    if (typeof PorterModel === 'undefined' || typeof PorterQif === 'undefined' || typeof PorterExporters === 'undefined' || typeof PorterZip === 'undefined') {
      showError('Application files are missing or could not be loaded. Extract the entire Porter ZIP into one folder, then open index.html from that folder.');
      ui['demo-button'].disabled = true;
      return;
    }
    PorterExporters.targets.forEach((target) => {
      const option = document.createElement('option');
      option.value = target.id;
      setText(option, target.name);
      ui['target-select'].append(option);
    });
    ui['target-select'].value = 'simplifi';
    ui['source-file'].addEventListener('change', () => selectFile(ui['source-file'].files[0]));
    ui['read-button'].addEventListener('click', readSource);
    ui['clear-button'].addEventListener('click', reset);
    ui['demo-button'].addEventListener('click', () => {
      if (busy) return;
      ui['date-order'].value = 'mdy';
      ui.encoding.value = 'utf-8';
      ui['account-name'].value = 'Imported account';
      ui['currency-confirm'].checked = true;
      ui['source-file'].value = '';
      selectFile(new File([DEMO], 'fictional-household.qif', {type:'text/plain'}), true);
      return readSource();
    });
    ['date-order','encoding'].forEach((id) => ui[id].addEventListener('change', invalidateSource));
    ui['account-name'].addEventListener('input', invalidateSource);
    ui['currency-confirm'].addEventListener('change', () => { if (!ui['currency-confirm'].checked) invalidateSource(); updateButtons(); });
    ['target-select','split-mode'].forEach((id) => ui[id].addEventListener('change', refreshPlan));
    ui['export-confirm'].addEventListener('change', updateButtons);
    ui['download-button'].addEventListener('click', download);
    ui['previous-page'].addEventListener('click', () => { if (page > 0) { page -= 1; renderTransactions(); } });
    ui['next-page'].addEventListener('click', () => { if (book && (page + 1) * PAGE_SIZE < book.transactions.length) { page += 1; renderTransactions(); } });
    ui['drop-zone'].addEventListener('dragover', (event) => { event.preventDefault(); if (!busy) ui['drop-zone'].classList.add('drag-over'); });
    ui['drop-zone'].addEventListener('dragleave', () => ui['drop-zone'].classList.remove('drag-over'));
    ui['drop-zone'].addEventListener('drop', (event) => {
      event.preventDefault();
      ui['drop-zone'].classList.remove('drag-over');
      if (busy) return;
      if (!event.dataTransfer || event.dataTransfer.files.length !== 1) {
        ui['source-file'].value = '';
        selectFile(null);
        showError('Choose one file at a time. Each migration kit corresponds to one reviewed source export.');
        return;
      }
      ui['source-file'].value = '';
      selectFile(event.dataTransfer.files[0]);
    });
    window.addEventListener('pagehide', releaseDownload);
    updateButtons();
  }

  initialize();
})();
