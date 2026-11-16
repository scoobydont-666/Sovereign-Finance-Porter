(function (root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PorterModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
  const MAX_TRANSACTIONS = 100000;
  const MAX_RECORDS = 200000;
  const MAX_ACCOUNTS = 1000;
  const MAX_LIST_ENTRIES = 20000;
  const MAX_FIELD_LENGTH = 65536;
  const VERSION = "0.1.0-alpha.2";

  function fail(message) {
    throw new Error(message);
  }

  function text(value, label, limit = MAX_FIELD_LENGTH) {
    if (typeof value !== "string" || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
      fail(label + " must be bounded plain text without binary control characters.");
    }
    return value;
  }

  // QIF exports can end with the Windows text-mode EOF marker. Recognize one
  // marker only after a complete caret record; never truncate at an embedded
  // marker or relax validation of financial fields. The caller archives value,
  // while parseText is the view used to read records.
  function qifSource(value) {
    if (typeof value !== "string") fail("QIF source must be a text string.");
    if (value.length > MAX_SOURCE_BYTES || new TextEncoder().encode(value).byteLength > MAX_SOURCE_BYTES) {
      fail("QIF source exceeds the 25 MiB limit. Export a smaller account or date range.");
    }
    const eof = value.lastIndexOf("\u001a");
    const legacyEof = eof !== -1 && /^[ \t\r\n]*$/u.test(value.slice(eof + 1)) &&
      /(?:^|[\r\n])[ \t]*\^[ \t\r\n]*$/u.test(value.slice(0, eof));
    const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.exec(value);
    if (control && (!legacyEof || control.index !== eof)) {
      let line = 1, column = 1;
      // Positions refer to original decoded text: CRLF is one newline and an
      // astral Unicode character is one column. Do not echo financial content.
      for (let index = 0; index < control.index; index++) {
        if (value[index] === "\r") {
          line++; column = 1;
          if (value[index + 1] === "\n") index++;
        } else if (value[index] === "\n") { line++; column = 1; }
        else {
          column++;
          if (value.codePointAt(index) > 0xffff) index++;
        }
      }
      const code = control[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
      fail("QIF source contains unsupported control character U+" + code + " at line " + line + ", column " + column +
        ". Verify the text encoding or export plain-text QIF from Quicken Classic. The source has not been changed.");
    }
    return { parseText: legacyEof ? value.slice(0, eof).replace(/[ \t\r\n]+$/u, "") : value, legacyEof };
  }

  // Only the explicitly supported USD decimal syntax is accepted. Never infer a
  // decimal separator or round a value with more than two fractional digits.
  function parseMoney(value) {
    if (typeof value !== "string" || value.length > 64) fail("Amount must be a decimal string.");
    let amount = value.trim();
    if (/^\([^()]+\)$/.test(amount)) amount = "-" + amount.slice(1, -1);
    if (!/^[+-]?(?:(?:\d{1,30}|\d{1,3}(?:,\d{3}){1,9})(?:\.\d{1,2})?|\.\d{1,2})$/.test(amount)) {
      fail("Amount must use USD decimal notation with at most two decimal places and valid comma grouping.");
    }
    const negative = amount[0] === "-";
    const unsigned = amount.replace(/^[+-]/, "").replace(/,/g, "");
    const [whole, fraction = ""] = unsigned.split(".");
    const minor = BigInt(whole || "0") * 100n + BigInt(fraction.padEnd(2, "0"));
    return fromMinor(negative ? -minor : minor);
  }

  function toMinor(value) {
    const normalized = parseMoney(value);
    const negative = normalized[0] === "-";
    const digits = normalized.replace("-", "").replace(".", "");
    const minor = BigInt(digits);
    return negative ? -minor : minor;
  }

  function fromMinor(value) {
    if (typeof value !== "bigint") fail("Minor units must be an exact BigInt.");
    const negative = value < 0n;
    const digits = (negative ? -value : value).toString().padStart(3, "0");
    return (negative ? "-" : "") + digits.slice(0, -2) + "." + digits.slice(-2);
  }

  function dateParts(value, order) {
    if (order !== "mdy" && order !== "dmy") fail("Date order must be mdy or dmy.");
    if (typeof value !== "string" || value.length > 32) fail("Date must be a supported calendar date.");
    const input = value.trim();
    let year, month, day, assumedCentury = false;
    let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
    if (match) {
      year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
    } else {
      match = /^(\d{1,2})\s*([/.\-])\s*(\d{1,2})\s*(\2|')\s*(\d{1,4})$/.exec(input);
      if (!match) fail("Date must be ISO YYYY-MM-DD or a date in the selected order.");
      month = Number(order === "mdy" ? match[1] : match[3]);
      day = Number(order === "mdy" ? match[3] : match[1]);
      const rawYear = match[5];
      if (match[4] === "'") {
        if (rawYear.length > 2) fail("Apostrophe dates must use a one- or two-digit year.");
        year = 2000 + Number(rawYear);
      } else if (rawYear.length === 2) {
        const shortYear = Number(rawYear);
        year = shortYear < 70 ? 2000 + shortYear : 1900 + shortYear;
        assumedCentury = true;
      } else if (rawYear.length === 4) year = Number(rawYear);
      else fail("Dates without an apostrophe require a two- or four-digit year.");
    }
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
      fail("Date is not a valid calendar date in the selected order.");
    }
    return {
      iso: String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0"),
      assumedCentury,
    };
  }

  function parseDate(value, order = "mdy") {
    return dateParts(value, order).iso;
  }

  function object(value, keys, label) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
      fail(label + " must be an ordinary object.");
    }
    const actual = Object.keys(value).sort();
    const expected = keys.slice().sort();
    if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) {
      fail(label + " contains missing or unsupported fields.");
    }
  }

  function array(value, label, max = MAX_RECORDS) {
    if (!Array.isArray(value) || value.length > max) fail(label + " must be a bounded array.");
    return value;
  }

  function rawFields(value) {
    array(value, "Original fields", 1500000).forEach(field => {
      text(field, "Original field");
      if (/[\r\n]/.test(field)) fail("Original field contains a line terminator.");
    });
  }

  function id(value, label) {
    text(value, label, 128);
    if (!/^[a-z][a-z0-9-]*$/.test(value)) fail(label + " is invalid.");
  }

  function unique(items, key, label) {
    const ids = new Set();
    for (const item of items) {
      if (ids.has(item[key])) fail(label + " contains duplicate identifiers.");
      ids.add(item[key]);
    }
    return ids;
  }

  function normalizedAmount(value) {
    if (parseMoney(value) !== value) fail("Archive amounts must use normalized decimal strings.");
  }

  function positiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 1) fail(label + " must be a positive integer.");
  }

  function categoryFields(value) {
    text(value.category, "Category");
    array(value.tags, "Tags", 1000).forEach(tag => text(tag, "Tag"));
    if (value.transferAccount !== null) {
      text(value.transferAccount, "Transfer account");
      if (!value.transferAccount.trim() || value.category !== "") fail("Transfer category metadata is inconsistent.");
    }
  }

  // This canonical archive is a reproducible interpretation of its retained QIF,
  // not an edit format. A fresh parse prevents a modified issue list or omitted
  // record from turning a blocked conversion into an apparently clean export.
  // The dependency is lazy: parseQif never calls validateBook.
  function validateBook(book) {
    object(book, ["schemaVersion", "generator", "currency", "dateOrder", "sources", "accounts", "categories", "securities", "transactions", "unsupportedRecords", "issues"], "Archive");
    if (book.schemaVersion !== "1.0.0") fail("Unsupported archive schema version.");
    object(book.generator, ["name", "version"], "Generator");
    if (book.generator.name !== "Sovereign Finance Porter" || !["0.1.0-alpha.1", VERSION].includes(book.generator.version)) fail("Unsupported archive generator version.");
    if (book.currency !== "USD") fail("This version accepts USD only; do not relabel another currency as USD.");
    if (!["mdy", "dmy"].includes(book.dateOrder)) fail("Archive date order is invalid.");
    array(book.sources, "Sources", 1);
    if (book.sources.length !== 1) fail("A v1 archive must contain exactly one QIF source.");
    const source = book.sources[0];
    object(source, ["id", "name", "format", "text", "parseOptions"], "Source");
    if (source.id !== "source-1" || source.format !== "qif") fail("Unsupported source identity or format.");
    text(source.name, "Source name", 1024);
    qifSource(source.text);
    object(source.parseOptions, ["accountName", "currency", "dateOrder"], "Source options");
    text(source.parseOptions.accountName, "Fallback account name", 1024);
    if (source.parseOptions.currency !== book.currency || source.parseOptions.dateOrder !== book.dateOrder) fail("Archive source options are inconsistent.");

    array(book.accounts, "Accounts", MAX_ACCOUNTS);
    for (const account of book.accounts) {
      object(account, ["id", "name", "type", "currency", "rawFields"], "Account");
      id(account.id, "Account identifier"); text(account.name, "Account name"); text(account.type, "Account type");
      if (!account.name.trim() || account.currency !== "USD") fail("Account name or currency is invalid.");
      rawFields(account.rawFields);
    }
    const accounts = unique(book.accounts, "id", "Accounts");
    unique(book.accounts, "name", "Accounts");
    for (const key of ["categories", "securities"]) {
      array(book[key], key, MAX_LIST_ENTRIES);
      for (const entry of book[key]) {
        object(entry, ["name", "rawFields"], key + " entry");
        text(entry.name, key + " name"); rawFields(entry.rawFields);
      }
    }
    array(book.transactions, "Transactions", MAX_TRANSACTIONS);
    for (const transaction of book.transactions) {
      object(transaction, ["id", "sourceId", "sourceRecord", "line", "accountId", "date", "amount", "payee", "memo", "category", "tags", "transferAccount", "cleared", "checkNumber", "splits", "rawFields"], "Transaction");
      id(transaction.id, "Transaction identifier");
      if (transaction.sourceId !== source.id || !accounts.has(transaction.accountId)) fail("Transaction references an unknown source or account.");
      positiveInteger(transaction.sourceRecord, "Source record"); positiveInteger(transaction.line, "Source line");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(transaction.date) || parseDate(transaction.date) !== transaction.date) fail("Transaction date is not canonical.");
      normalizedAmount(transaction.amount);
      text(transaction.payee, "Payee"); text(transaction.memo, "Memo"); text(transaction.checkNumber, "Check number");
      categoryFields(transaction);
      if (!["", "cleared", "reconciled"].includes(transaction.cleared)) fail("Transaction cleared state is unsupported.");
      array(transaction.splits, "Splits", 10000);
      let sum = 0n;
      for (const split of transaction.splits) {
        object(split, ["amount", "category", "tags", "memo", "transferAccount"], "Split");
        normalizedAmount(split.amount); categoryFields(split); text(split.memo, "Split memo");
        sum += toMinor(split.amount);
      }
      if (transaction.splits.length && sum !== toMinor(transaction.amount)) fail("Split amounts do not equal their transaction total.");
      rawFields(transaction.rawFields);
    }
    unique(book.transactions, "id", "Transactions");
    unique(book.transactions, "sourceRecord", "Transactions");
    array(book.unsupportedRecords, "Unsupported records");
    for (const record of book.unsupportedRecords) {
      object(record, ["sourceId", "sourceRecord", "line", "type", "rawFields", "reason"], "Unsupported record");
      if (record.sourceId !== source.id) fail("Unsupported record references an unknown source.");
      positiveInteger(record.sourceRecord, "Source record"); positiveInteger(record.line, "Source line");
      text(record.type, "Record type"); text(record.reason, "Record reason"); rawFields(record.rawFields);
    }
    unique(book.unsupportedRecords, "sourceRecord", "Unsupported records");
    const transactionRecords = new Set(book.transactions.map(item => item.sourceRecord));
    if (book.unsupportedRecords.some(item => transactionRecords.has(item.sourceRecord))) fail("Source record is represented twice.");
    array(book.issues, "Issues", MAX_RECORDS + 1000);
    for (const issue of book.issues) {
      if (!issue || typeof issue !== "object" || Array.isArray(issue)) fail("Issue must be an object.");
      const allowed = new Set(["severity", "code", "message", "sourceRecord", "line", "transactionId"]);
      if (Object.keys(issue).some(key => !allowed.has(key))) fail("Issue contains unsupported fields.");
      if (!["error", "warning", "info"].includes(issue.severity)) fail("Issue severity is invalid.");
      text(issue.code, "Issue code", 128); text(issue.message, "Issue message");
      if (issue.sourceRecord !== undefined) positiveInteger(issue.sourceRecord, "Issue record");
      if (issue.line !== undefined) positiveInteger(issue.line, "Issue line");
      if (issue.transactionId !== undefined) id(issue.transactionId, "Issue transaction");
    }
    const parser = typeof module === "object" && module.exports ? require("./qif.js") : root.PorterQif;
    if (!parser || typeof parser.parseQif !== "function") fail("QIF parser is required to verify this archive.");
    const reproduced = parser.parseQif(source.text, { sourceName: source.name, ...source.parseOptions });
    // Alpha2 has the same interpretation for every source accepted by alpha1.
    // Permit only the generator metadata upgrade; all source/data/issues must
    // still reproduce exactly. Unknown generator versions remain unsupported.
    const comparable = { ...book, generator: { ...book.generator, version: VERSION } };
    if (stableStringify(comparable) !== stableStringify(reproduced)) {
      fail("Archive does not match its preserved QIF source. Reimport the original QIF instead of editing the archive.");
    }
    return reproduced;
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
    return JSON.stringify(value);
  }

  return { parseMoney, toMinor, fromMinor, parseDate, dateParts, validateBook, text, qifSource, MAX_SOURCE_BYTES, MAX_TRANSACTIONS, MAX_RECORDS, MAX_ACCOUNTS, MAX_LIST_ENTRIES, MAX_FIELD_LENGTH, VERSION };
});
