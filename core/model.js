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
  const VERSION = "0.1.0-alpha.3";

  function fail(message) {
    throw new Error(message);
  }

  function text(value, label, limit = MAX_FIELD_LENGTH) {
    if (typeof value !== "string" || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
      fail(label + " must be bounded plain text without binary control characters.");
    }
    return value;
  }

  // Preserve narrowly recognized legacy metadata without relaxing financial
  // fields: one terminal Windows EOF, or exactly T + SOH in an !Account section.
  // The latter has no assigned type meaning. The caller archives value unchanged;
  // only the EOF trailer is omitted from the view used to read records.
  function qifSource(value) {
    if (typeof value !== "string") fail("QIF source must be a text string.");
    if (value.length > MAX_SOURCE_BYTES || new TextEncoder().encode(value).byteLength > MAX_SOURCE_BYTES) {
      fail("QIF source exceeds the 25 MiB limit. Export a smaller account or date range.");
    }
    const eof = value.lastIndexOf("\u001a");
    const legacyEof = eof !== -1 && /^[ \t\r\n]*$/u.test(value.slice(eof + 1)) &&
      /(?:^|[\r\n])[ \t]*\^[ \t\r\n]*$/u.test(value.slice(0, eof));
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
      let accountSection = false, lineNumber = 0;
      // Iterate physical lines once, without building another full lines array.
      // AutoSwitch directives keep the current section, as in the QIF parser;
      // any other header ends the narrowly recognized !Account context.
      for (const match of value.matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/gu)) {
        lineNumber++;
        const rawLine = match[1];
        const line = match.index === 0 ? rawLine.replace(/^\ufeff/u, "") : rawLine;
        if (line.startsWith("!")) {
          const header = line.trim().toLowerCase();
          if (header === "!account") accountSection = true;
          else if (header !== "!option:autoswitch" && header !== "!clear:autoswitch") accountSection = false;
        }
        if (accountSection && rawLine === "T\u0001") continue;
        for (const control of rawLine.matchAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu)) {
          if (legacyEof && match.index + control.index === eof) continue;
          let column = 1;
          // CRLF is one newline; columns count original Unicode code points.
          for (let index = 0; index < control.index; index++) {
            column++;
            if (rawLine.codePointAt(index) > 0xffff) index++;
          }
          const code = control[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
          fail("QIF source contains unsupported control character U+" + code + " at line " + lineNumber + ", column " + column +
            ". Verify the text encoding or export plain-text QIF from Quicken Classic. The source has not been changed.");
        }
      }
    }
    let parseEnd = eof;
    if (legacyEof) {
      // Scan backwards once. An unanchored whitespace-plus-end regex can retry
      // at every space in an interior field and stall on otherwise valid QIF.
      while (parseEnd > 0) {
        const code = value.charCodeAt(parseEnd - 1);
        if (code !== 32 && code !== 9 && code !== 10 && code !== 13) break;
        parseEnd--;
      }
    }
    return { parseText: legacyEof ? value.slice(0, parseEnd) : value, legacyEof };
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

  function rawFields(value, accountContext = false) {
    array(value, "Original fields", 1500000).forEach(field => {
      // Only retained account evidence may contain this exact unknown type.
      // Normalized fields and every other record kind keep strict text checks.
      if (!(accountContext && field === "T\u0001")) text(field, "Original field");
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
    if (book.generator.name !== "Sovereign Finance Porter" || !["0.1.0-alpha.1", "0.1.0-alpha.2", VERSION].includes(book.generator.version)) fail("Unsupported archive generator version.");
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
      rawFields(account.rawFields, true);
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
      text(record.type, "Record type"); text(record.reason, "Record reason"); rawFields(record.rawFields, record.type === "Account");
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
    // Alpha3 has the same interpretation for sources accepted by alpha1/alpha2.
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
