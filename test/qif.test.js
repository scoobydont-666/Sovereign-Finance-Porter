"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Model = require("../core/model.js");
const { parseQif } = require("../core/qif.js");
const { planExport } = require("../core/exporters.js");

const basic = "!Type:Bank\nD1/2/2026\nT-42.75\nPExample Market\nLFood\n^\n";
const named = "!Account\nNExample Checking\nTBank\n^\n" + basic;
const options = { accountName: "Example Checking", sourceName: "fictional.qif" };
const clone = value => JSON.parse(JSON.stringify(value));
const errors = book => book.issues.filter(item => item.severity === "error");
// Frozen output of the alpha1 parser; every account and transaction is fictional.
const alpha1Archive = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/alpha1-archive.json"), "utf8"));

function privateControlError(action, code, line, column) {
  assert.throws(action, error => {
    assert.match(error.message, new RegExp("U\\+" + code));
    assert.match(error.message, new RegExp("line\\s+" + line + "\\b", "i"));
    assert.match(error.message, new RegExp("column\\s+" + (column === undefined ? "[1-9]\\d*" : column) + "\\b", "i"));
    assert.doesNotMatch(error.message, /Private Fixture|42\.75|11\/15\/2026|private-filename/);
    return true;
  });
}

test("exact money normalization never uses floating-point arithmetic", () => {
  assert.equal(Model.parseMoney("-1,234.5"), "-1234.50");
  assert.equal(Model.parseMoney("+0001.20"), "1.20");
  assert.equal(Model.parseMoney("(42.75)"), "-42.75");
  assert.equal(Model.parseMoney(".05"), "0.05");
  assert.equal(Model.parseMoney("-0"), "0.00");
  assert.equal(Model.parseMoney("9007199254740993.01"), "9007199254740993.01");
  assert.equal(Model.toMinor("0.10") + Model.toMinor("0.20"), 30n);
  assert.equal(Model.fromMinor(-1n), "-0.01");
});

test("invalid money syntax and excess precision fail without rounding", () => {
  for (const amount of ["", "1,23.45", "1.234,56", "NaN", "Infinity", "1e3", "1.001", "--1", "$1.00", "1.2.3", "1 234.50", "(1)-", "0x10", "1\n2", 1.23, null]) {
    assert.throws(() => Model.parseMoney(amount), /Amount/);
  }
  assert.throws(() => Model.fromMinor(100), /BigInt/);
});

test("dates use explicit locale and calendar validation", () => {
  assert.equal(Model.parseDate("2/3/2026", "mdy"), "2026-02-03");
  assert.equal(Model.parseDate("2/3/2026", "dmy"), "2026-03-02");
  assert.equal(Model.parseDate("2024-02-29", "dmy"), "2024-02-29");
  assert.equal(Model.parseDate("9/ 1'26"), "2026-09-01");
  assert.equal(Model.parseDate("12/31'00"), "2000-12-31");
  assert.equal(Model.parseDate("1/1/69"), "2069-01-01");
  assert.equal(Model.parseDate("1/1/70"), "1970-01-01");
  assert.equal(Model.parseDate("1/1/1999"), "1999-01-01");
  for (const date of ["2/29/2025", "13/1/2026", "0/1/2026", "4/31/2026", "2026-00-01", "0000-01-01", "1/1/6", "1/1'2026", "1/1/2026 junk", "1/1-2026", "2/29/1900"]) {
    assert.throws(() => Model.parseDate(date), /Date|date/);
  }
  assert.throws(() => Model.parseDate("1/1/2026", "auto"), /Date order/);
});

test("basic QIF retains source and has exact cash semantics", () => {
  const book = parseQif(named, options);
  assert.equal(book.sources[0].text, named);
  assert.equal(book.sources[0].name, "fictional.qif");
  assert.deepEqual(book.accounts.map(({ id, name, type, currency }) => ({ id, name, type, currency })), [{ id: "account-1", name: "Example Checking", type: "Bank", currency: "USD" }]);
  assert.equal(book.transactions.length, 1);
  assert.deepEqual(book.transactions[0], { id: "tx-2", sourceId: "source-1", sourceRecord: 2, line: 6, accountId: "account-1", date: "2026-01-02", amount: "-42.75", payee: "Example Market", memo: "", category: "Food", tags: [], transferAccount: null, cleared: "", checkNumber: "", splits: [], rawFields: ["D1/2/2026", "T-42.75", "PExample Market", "LFood"] });
  assert.equal(errors(book).length, 0);
  assert.deepEqual(Model.validateBook(clone(book)), book);
});

test("anonymous cash exports use and preserve the supplied account name", () => {
  const book = parseQif(basic, { accountName: "Fictional cash" });
  assert.equal(book.accounts[0].name, "Fictional cash");
  assert.ok(book.issues.some(item => item.code === "FALLBACK_ACCOUNT"));
  assert.deepEqual(Model.validateBook(clone(book)), book);
});

test("all supported cash account types normalize without changing amount signs", () => {
  for (const type of ["Bank", "Cash", "CCard", "Oth A", "Oth L"]) {
    const book = parseQif(basic.replace("Bank", type), options);
    assert.equal(book.accounts[0].type, type);
    assert.equal(book.transactions[0].amount, "-42.75");
  }
});

test("named multi-account files retain both transfer postings without synthesis", () => {
  const qif = "!Account\nNExample Checking\nTBank\n^\n!Type:Bank\nD1/2/2026\nT-100\nPTransfer\nL[Example Savings]/Household\n^\n!Account\nNExample Savings\nTBank\n^\n!Type:Bank\nD1/2/2026\nT100\nPTransfer\nL[Example Checking]\n^\n";
  const book = parseQif(qif);
  assert.equal(errors(book).length, 0);
  assert.equal(book.accounts.length, 2);
  assert.equal(book.transactions.length, 2);
  assert.deepEqual(book.transactions.map(item => [item.accountId, item.amount, item.transferAccount]), [["account-1", "-100.00", "Example Savings"], ["account-2", "100.00", "Example Checking"]]);
  assert.deepEqual(book.transactions[0].tags, ["Household"]);
  assert.equal(book.transactions[0].category, "");
  assert.deepEqual(Model.validateBook(clone(book)), book);
});

test("balanced split amounts preserve exact categories, memo, tags, and transfers", () => {
  const qif = "!Type:Bank\nD1/2/2026\nT-30.00\nPExample Store\nL--Split--\nSFood/Shared\nEFood portion\n$-20\nS[Example Wallet]\n$-10\n^\n";
  const book = parseQif(qif, options);
  assert.equal(errors(book).length, 0);
  assert.deepEqual(book.transactions[0].splits, [
    { amount: "-20.00", category: "Food", tags: ["Shared"], memo: "Food portion", transferAccount: null },
    { amount: "-10.00", category: "", tags: [], memo: "", transferAccount: "Example Wallet" },
  ]);
  assert.equal(book.transactions[0].amount, "-30.00");
  assert.deepEqual(Model.validateBook(clone(book)), book);
});

test("repeated amount fields agree exactly, including comma grouping", () => {
  const book = parseQif("!Type:Bank\nD1/2/2026\nT-1,000\nU-1000.00\n^\n");
  assert.equal(book.transactions[0].amount, "-1000.00");
  assert.equal(errors(book).length, 0);
  const alternate = parseQif("!Type:Bank\nD1/2/2026\nU100.25\n^\n");
  assert.equal(alternate.transactions[0].amount, "100.25");
});

test("conflicting T/U amounts are retained and block all target conversion", () => {
  const book = parseQif("!Type:Bank\nD1/2/2026\nT-100\nU100\n^\n");
  assert.equal(book.transactions.length, 0);
  assert.equal(book.unsupportedRecords.length, 1);
  assert.equal(errors(book).length, 1);
  assert.equal(errors(book)[0].sourceRecord, 1);
  assert.equal(errors(book)[0].line, 2);
  assert.deepEqual(Model.validateBook(clone(book)), book);
});

test("a two-digit year assumption is reported once without losing records", () => {
  const qif = "!Type:Bank\nD1/2/26\nT1\n^\nD1/3/26\nT2\n^\n";
  const book = parseQif(qif);
  assert.equal(book.transactions.length, 2);
  assert.equal(book.issues.filter(item => item.code === "TWO_DIGIT_YEAR").length, 1);
  assert.equal(book.transactions[0].date, "2026-01-02");
});

test("categories, securities, and unsupported source sections remain recoverable", () => {
  const qif = "!Type:Cat\nNFood:Groceries\nE\nT\n^\n!Type:Security\nNFictional Fund\nSZZTEST\nTMutual Fund\n^\n!Type:Class\nNShared\n^\n!Type:Invst\nD1/1/2026\nNBuy\nYFictional Fund\nQ1.234567\nT100\n^\n!Type:Prices\n\"ZZTEST\",100,\"1/1/2026\"\n^\n";
  const book = parseQif(qif);
  assert.equal(book.categories[0].name, "Food:Groceries");
  assert.equal(book.securities[0].name, "Fictional Fund");
  assert.deepEqual(book.unsupportedRecords.map(item => item.type), ["Class", "Invst", "Prices"]);
  assert.equal(book.sources[0].text, qif);
  assert.equal(book.transactions.length, 0);
  assert.ok(book.issues.some(item => item.code === "INVESTMENT_UNSUPPORTED"));
  assert.deepEqual(Model.validateBook(clone(book)), book);
});

test("unknown transaction fields and addresses are preserved and reported", () => {
  const book = parseQif(basic.replace("LFood", "LFood\nA123 Example Lane\nAExample City\nZcustom"));
  assert.equal(book.transactions.length, 1);
  assert.ok(book.transactions[0].rawFields.includes("Zcustom"));
  assert.ok(book.issues.some(item => item.code === "UNMODELED_FIELDS"));
});

test("malformed transaction fields block while preserving every original record", () => {
  const badFields = [
    "D2/29/2026\nT1", "D1/1/2026\nT1.001", "D1/1/2026\nT1,23",
    "D1/1/2026\nT1\nT1", "D1/1/2026\nD1/2/2026\nT1",
    "T1", "D1/1/2026", "D1/1/2026\nT1\nC?", "D1/1/2026\nT1\nCunknown",
    "D1/1/2026\nT1\nL[Unclosed", "D1/1/2026\nT1\nL[]",
    "D1/1/2026\nT1\nPFirst\nPSecond", "D1/1/2026\nT1\nMFirst\nMSecond",
  ];
  for (const fields of badFields) {
    const qif = "!Type:Bank\n" + fields + "\n^\n";
    const book = parseQif(qif);
    assert.equal(book.transactions.length, 0);
    assert.equal(book.unsupportedRecords.length, 1);
    assert.equal(errors(book).length, 1);
    assert.equal(book.sources[0].text, qif);
    assert.deepEqual(Model.validateBook(clone(book)), book);
  }
});

test("unbalanced, incomplete, orphaned, or repeated split fields are never flattened", () => {
  for (const fields of ["SFood\n$-9", "SFood", "$-10", "EOrphan", "SFood\n$-10\n$-10", "SFood\nEone\nEtwo\n$-10", "SFood\n%100"]) {
    const book = parseQif("!Type:Bank\nD1/1/2026\nT-10\n" + fields + "\n^\n");
    assert.equal(book.transactions.length, 0);
    assert.equal(book.unsupportedRecords.length, 1);
    assert.equal(errors(book).length, 1);
  }
});

test("investment numbers never leak into cash transaction amounts", () => {
  const qif = "!Type:Invst\nD1/1/2026\nNBuy\nYExample Fund\nT100\nQ1\n^\n";
  const book = parseQif(qif);
  assert.equal(book.transactions.length, 0);
  assert.equal(book.unsupportedRecords[0].reason, "INVESTMENT_UNSUPPORTED");
  assert.equal(book.unsupportedRecords[0].rawFields[3], "T100");
});

test("multi-entry account lists cannot silently assign transactions to the last account", () => {
  const qif = "!Account\nNFirst\nTBank\n^\nNSecond\nTBank\n^\n" + basic;
  const book = parseQif(qif);
  assert.equal(book.accounts.length, 2);
  assert.equal(book.transactions.length, 0);
  assert.equal(errors(book).length, 1);
  assert.deepEqual(Model.validateBook(clone(book)), book);
});

test("explicit account headers following an AutoSwitch list restore attribution", () => {
  const prefix = "!Option:AutoSwitch\n!Account\nNFirst\nTBank\n^\nNSecond\nTBank\n^\n!Clear:AutoSwitch\n";
  const ambiguous = parseQif(prefix + basic);
  assert.equal(ambiguous.transactions.length, 0);
  const book = parseQif(prefix + "!Account\nNFirst\nTBank\n^\n" + basic);
  assert.equal(errors(book).length, 0);
  assert.equal(book.transactions[0].accountId, book.accounts[0].id);
  assert.equal(book.accounts.length, 2);
  assert.deepEqual(Model.validateBook(clone(book)), book);
});

test("contradictory account types block instead of changing account meaning", () => {
  const book = parseQif("!Account\nNExample\nTCCard\n^\n" + basic);
  assert.equal(book.transactions.length, 0);
  assert.equal(errors(book).length, 1);
  const unnamed = parseQif(basic + "!Type:CCard\nD1/3/2026\nT-1\n^\n");
  assert.equal(unnamed.transactions.length, 1);
  assert.equal(unnamed.unsupportedRecords.length, 1);
  assert.equal(errors(unnamed).length, 1);
});

test("malformed account declarations cannot fall back to an unrelated account", () => {
  for (const declaration of ["TBank", "N\nTBank", "NFirst\nNSecond\nTBank"]) {
    const book = parseQif("!Account\n" + declaration + "\n^\n" + basic);
    assert.equal(book.transactions.length, 0);
    assert.ok(errors(book).length >= 1);
    assert.deepEqual(Model.validateBook(clone(book)), book);
  }
});

test("missing terminators preserve records and block a partial interpretation", () => {
  for (const qif of [basic.replace("^\n", ""), basic.replace("^\n", "!Type:Bank\nD1/3/2026\nT1\n^\n")]) {
    const book = parseQif(qif);
    assert.ok(errors(book).some(item => item.code === "UNTERMINATED_RECORD"));
    assert.ok(book.unsupportedRecords.length >= 1);
    assert.equal(book.sources[0].text, qif);
    assert.deepEqual(Model.validateBook(clone(book)), book);
  }
});

test("line endings and UTF-8 BOM are interpreted without changing retained source", () => {
  for (const qif of ["\ufeff" + named, named.replace(/\n/g, "\r\n"), named.replace(/\n/g, "\r")]) {
    const book = parseQif(qif, options);
    assert.equal(book.transactions.length, 1);
    assert.equal(book.sources[0].text, qif);
    assert.deepEqual(Model.validateBook(clone(book)), book);
  }
});

test("one terminal DOS EOF marker is disclosed without changing records or retained source", () => {
  const expected = parseQif(named, options);
  const sources = [
    named + "\u001a",
    named.trimEnd() + "\u001a",
    named.trimEnd() + " \t\u001a \t\r\n",
    named.replace(/\n/g, "\r\n") + " \t\r\n\u001a\t \r\n",
    named.replace(/\n/g, "\r") + "\u001a\r",
    "\ufeff" + named + "\u001a\n",
  ];
  for (const source of sources) {
    const book = parseQif(source, options);
    assert.equal(book.sources[0].text, source);
    assert.deepEqual(book.transactions, expected.transactions);
    assert.deepEqual(book.accounts, expected.accounts);
    assert.equal(book.unsupportedRecords.length, 0);
    assert.equal(errors(book).length, 0);
    const notes = book.issues.filter(issue => issue.code === "LEGACY_DOS_EOF");
    assert.equal(notes.length, 1);
    assert.ok(["info", "warning"].includes(notes[0].severity));
    assert.deepEqual(Model.validateBook(clone(book)), book);
  }
  assert.equal(expected.issues.some(issue => issue.code === "LEGACY_DOS_EOF"), false);
});

test("terminal DOS EOF survives archive reload and all CSV targets keep exact split totals", () => {
  const source = alpha1Archive.sources[0].text + "\t\u001a \r\n";
  const book = parseQif(source, { sourceName: "fictional-eof.qif", ...alpha1Archive.sources[0].parseOptions });
  const archivePlan = planExport(book, "archive");
  assert.equal(archivePlan.blocked, false);
  assert.equal(archivePlan.files.find(file => file.name === "original-source/source-1.qif").content, source);
  const reloaded = Model.validateBook(JSON.parse(archivePlan.files.find(file => file.name === "portable-book.json").content));
  assert.deepEqual(reloaded, book);
  for (const target of ["simplifi", "simplifi-compat", "monarch", "ynab", "actual", "generic"]) {
    const plan = planExport(reloaded, target);
    const original = planExport(clone(alpha1Archive), target);
    assert.equal(plan.blocked, false, target);
    assert.equal(plan.summary.sourceTransactions, 2, target);
    assert.equal(plan.summary.exportedRows, 3, target);
    assert.equal(plan.summary.sourceNet, "90.50", target);
    assert.equal(plan.summary.exportNet, "90.50", target);
    assert.deepEqual(plan.files.filter(file => file.name.startsWith("import/")), original.files.filter(file => file.name.startsWith("import/")), target);
  }
  const missingNote = clone(reloaded);
  missingNote.issues = missingNote.issues.filter(issue => issue.code !== "LEGACY_DOS_EOF");
  assert.throws(() => Model.validateBook(missingNote), /does not match/);
});

test("EOF handling stays responsive with long valid interior whitespace", () => {
  // Isolate a known regex backtracking case so a regression cannot hang the
  // suite. This is a generous hang guard, not a browser latency benchmark.
  const script = `
    const assert = require("node:assert/strict");
    const { parseQif } = require("./core/qif.js");
    const spaces = " ".repeat(64000);
    const source = "!Type:Bank\\nD1/1/2026\\nT-1.00\\nP" + spaces + "X\\nM" + spaces + "X\\n^\\n\\u001a";
    const book = parseQif(source);
    assert.equal(book.transactions.length, 1);
    assert.equal(book.transactions[0].amount, "-1.00");
    assert.equal(book.sources[0].text, source);
    assert.equal(book.issues.some(issue => issue.severity === "error"), false);
  `;
  const child = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."), timeout: 5000, killSignal: "SIGKILL", encoding: "utf8",
  });
  assert.equal(child.error, undefined, "Bounded QIF with interior whitespace must not stall the reader.");
  assert.equal(child.status, 0, child.stderr);
});

test("DOS EOF is rejected inside records, when repeated, and after unfinished fields", () => {
  const prefix = "!Account\nNPrivate Fixture Account\nTBank\n^\n!Type:Bank\nD11/15/2026\nT-42.75\nPPrivate Fixture Payee\n";
  const complete = prefix + "MPrivate Fixture Memo\n^\n";
  const cases = [
    { source: prefix + "M\u001aPrivate Fixture Memo\n^\n", line: 9, column: 2 },
    { source: complete + "\u001a\nD11/15/2026\nT1\n^\n", line: 11, column: 1 },
    { source: complete + "\u001a \t\u001a\n", line: 11 },
    { source: prefix + "M\u001a \r\n", line: 9, column: 2 },
    { source: prefix + "M^ \u001a\n", line: 9, column: 4 },
    { source: "!Type:Bank\n\u001a", line: 2, column: 1 },
    { source: complete + "\u001a\u00a0", line: 11, column: 1 },
  ];
  for (const { source, line, column } of cases) privateControlError(() => parseQif(source, options), "001A", line, column);
});

test("other C0 controls and DEL report code and position without financial fields", () => {
  const controls = [...Array.from({ length: 32 }, (_, code) => code).filter(code => ![9, 10, 13, 26].includes(code)), 127];
  for (const code of controls) {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const source = ["!Type:Bank", "D11/15/2026", "T-42.75", "PPrivate Fixture Payee", "M" + String.fromCharCode(code) + "Private Fixture Memo", "^", ""].join(newline);
      privateControlError(() => parseQif(source, options), code.toString(16).toUpperCase().padStart(4, "0"), 5, 2);
    }
  }
});

test("legacy EOF handling never loosens normal field validation", () => {
  assert.throws(() => Model.text("Private Fixture\u001a", "Payee"));
  assert.throws(() => parseQif(named, { accountName: "Private Fixture\u001a" }));
  const tampered = clone(alpha1Archive);
  tampered.transactions[0].memo += "\u001a";
  assert.throws(() => Model.validateBook(tampered));
});

test("identical legitimate transactions are retained rather than deduplicated", () => {
  const book = parseQif(basic + basic);
  assert.equal(book.transactions.length, 2);
  assert.notEqual(book.transactions[0].id, book.transactions[1].id);
  assert.equal(book.transactions[0].amount, book.transactions[1].amount);
});

test("QIF account names are data, including prototype-looking names and path separators", () => {
  const qif = "!Account\nN__proto__\nTBank\n^\n!Type:Bank\nD1/1/2026\nT-1\nL[Folder/Savings]\n^\n";
  const book = parseQif(qif);
  assert.equal(book.accounts[0].name, "__proto__");
  assert.equal(book.transactions[0].transferAccount, "Folder/Savings");
  assert.equal(errors(book).length, 0);
  assert.deepEqual(Model.validateBook(clone(book)), book);
});

test("source validation rejects binary, undecodable, unsupported currency, and invalid options", () => {
  for (const value of [null, undefined, 1, {}, new Uint8Array([65])]) assert.throws(() => parseQif(value), /must be a text string/);
  for (const qif of ["", " \n", basic + "\u0000", basic + "\u0007", basic + "\ufffd"]) assert.throws(() => parseQif(qif));
  assert.throws(() => parseQif(basic, { currency: "EUR" }), /USD/);
  assert.throws(() => parseQif(basic, { dateOrder: "auto" }), /Date order/);
  assert.throws(() => parseQif(basic, { accountName: " " }), /account name/);
  const book = parseQif("This is not a QIF file\n");
  assert.ok(errors(book).some(item => item.code === "NO_QIF_HEADER"));
});

test("source and field limits fail explicitly", () => {
  assert.throws(() => parseQif("x".repeat(Model.MAX_SOURCE_BYTES + 1)), /25 MiB/);
  assert.throws(() => parseQif("é".repeat(Model.MAX_SOURCE_BYTES / 2 + 1)), /25 MiB/);
  assert.throws(() => parseQif("!Type:Bank\nP" + "x".repeat(65536) + "\n^\n"), /65,536/);
});

test("account and list counts are bounded without discarding source records", () => {
  const accounts = "!Account\n" + Array.from({ length: 1001 }, (_, index) => "NFictional " + index + "\nTBank\n^\n").join("");
  const book = parseQif(accounts);
  assert.equal(book.accounts.length, 1000);
  assert.equal(book.unsupportedRecords.length, 1);
  assert.ok(errors(book).some(item => /1,000-account limit/.test(item.message)));
  assert.deepEqual(Model.validateBook(clone(book)), book);
  const categories = "!Type:Cat\n" + Array.from({ length: 20001 }, (_, index) => "NFictional " + index + "\n^\n").join("");
  const categoryBook = parseQif(categories);
  assert.equal(categoryBook.categories.length, 20000);
  assert.equal(categoryBook.unsupportedRecords.length, 1);
  assert.ok(categoryBook.issues.some(item => /20,000-entry limit/.test(item.message)));
});

test("transaction limit is enforced even when records cannot be normalized", () => {
  const large = "!Type:Bank\n" + "D1/1/2026\nTinvalid\n^\n".repeat(100001);
  assert.throws(() => parseQif(large), /100,000-transaction limit/);
});

test("record diagnostics explain invalid dates or amounts without echoing financial fields", () => {
  const qif = "!Type:Bank\nD2/31/2026\nT-42.75\nPPrivate Fixture Payee\n^\n";
  const diagnostic = errors(parseQif(qif))[0];
  assert.match(diagnostic.message, /valid calendar date/);
  assert.doesNotMatch(diagnostic.message, /Private Fixture|42\.75|2\/31/);
  assert.equal(diagnostic.sourceRecord, 1);
  assert.equal(diagnostic.line, 2);
});

test("canonical validation rejects missing references and monetary tampering", () => {
  const book = parseQif(named, options);
  for (const mutation of [
    value => { value.transactions[0].accountId = "account-999"; },
    value => { value.transactions[0].amount = "-1.00"; },
    value => { value.transactions[0].amount = -42.75; },
    value => { value.transactions[0].date = "2026-02-30"; },
    value => { value.transactions[0].sourceId = "other-source"; },
    value => { value.transactions.push(clone(value.transactions[0])); },
    value => { value.accounts.push(clone(value.accounts[0])); },
    value => { value.schemaVersion = "2.0.0"; },
    value => { value.currency = "EUR"; },
    value => { value.transactions = []; },
    value => { value.issues = []; },
    value => { value.securities = null; },
    value => { value.sources[0].parseOptions = {}; },
    value => { value.extra = "unversioned field"; },
  ]) {
    const changed = clone(book); mutation(changed);
    assert.throws(() => Model.validateBook(changed));
  }
});

test("canonical validation prevents deleting blocking errors or malformed records", () => {
  const source = "!Type:Bank\nD2/31/2026\nT10\n^\n";
  const book = parseQif(source);
  assert.equal(errors(book).length, 1);
  assert.deepEqual(Model.validateBook(clone(book)), book);
  const removedError = clone(book);
  removedError.issues = removedError.issues.filter(item => item.severity !== "error");
  assert.throws(() => Model.validateBook(removedError), /does not match/);
  const removedRecord = clone(book); removedRecord.unsupportedRecords = [];
  assert.throws(() => Model.validateBook(removedRecord), /does not match/);
});

test("canonical validation recomputes balanced splits even if issues were removed", () => {
  const book = parseQif("!Type:Bank\nD1/1/2026\nT-10\nSFood\n$-10\n^\n");
  book.transactions[0].splits[0].amount = "-9.00";
  assert.throws(() => Model.validateBook(book), /Split amounts/);
});

test("canonical JSON key order does not affect reproduction", () => {
  const book = parseQif(named);
  const reordered = Object.fromEntries(Object.entries(book).reverse());
  assert.deepEqual(Model.validateBook(clone(reordered)), book);
});

test("saved alpha1 archives upgrade only generator metadata", () => {
  assert.equal(alpha1Archive.generator.version, "0.1.0-alpha.1");
  const expected = clone(alpha1Archive);
  expected.generator.version = Model.VERSION;
  const validated = Model.validateBook(clone(alpha1Archive));
  assert.deepEqual(validated, expected);
  const exported = planExport(clone(alpha1Archive), "simplifi");
  assert.equal(exported.blocked, false);
  assert.equal(exported.summary.sourceTransactions, 2);
  assert.equal(exported.summary.exportedRows, 3);
  assert.equal(exported.summary.exportNet, "90.50");
  assert.deepEqual(JSON.parse(exported.files.find(file => file.name === "portable-book.json").content), expected);
});

test("alpha1 compatibility preserves source, split, record and issue integrity checks", () => {
  for (const mutate of [
    value => { value.transactions[1].amount = "999.99"; },
    value => { value.sources[0].text = value.sources[0].text.replace("T120.50", "T999.99"); },
    value => { value.transactions[0].splits[0].amount = "-21.00"; value.transactions[0].splits[1].amount = "-9.00"; },
    value => { value.transactions[0].rawFields[2] = "PChanged fixture payee"; },
    value => { value.unsupportedRecords = []; },
    value => { value.issues = []; },
    value => { value.generator.version = "0.1.0-alpha.0"; },
    value => { value.generator.version = "99.0.0"; },
  ]) {
    const changed = clone(alpha1Archive);
    mutate(changed);
    assert.throws(() => Model.validateBook(changed));
    assert.throws(() => planExport(changed, "simplifi"));
  }
});

test("browser UMD path loads without Node or network and verifies its own archive", () => {
  const context = vm.createContext({ TextEncoder });
  const core = path.resolve(__dirname, "../core");
  vm.runInContext(fs.readFileSync(path.join(core, "model.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(core, "qif.js"), "utf8"), context);
  context.fixture = basic;
  assert.equal(vm.runInContext("PorterQif.parseQif(fixture).transactions[0].amount", context), "-42.75");
  assert.equal(vm.runInContext("PorterModel.validateBook(PorterQif.parseQif(fixture)).transactions.length", context), 1);
});
