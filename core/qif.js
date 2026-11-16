(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./model.js"));
  else root.PorterQif = factory(root.PorterModel);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Model) {
  "use strict";

  const CASH_TYPES = new Map([["bank", "Bank"], ["cash", "Cash"], ["ccard", "CCard"], ["oth a", "Oth A"], ["oth l", "Oth L"]]);

  function parseQif(text, options = {}) {
    if (!Model) throw new Error("The canonical model must load before the QIF parser.");
    const source = Model.qifSource(text);
    if (!text.trim()) throw new Error("The QIF source is empty.");
    if (text.includes("\ufffd")) throw new Error("QIF source contains undecodable text. Select the original file encoding and try again.");
    let lineCount = 1;
    for (let index = 0; index < text.length; index++) {
      if (text[index] === "\n" || (text[index] === "\r" && text[index + 1] !== "\n")) lineCount++;
      if (lineCount > 1500000) throw new Error("QIF source exceeds the 1,500,000-line limit.");
    }
    const currency = options.currency === undefined ? "USD" : options.currency;
    const dateOrder = options.dateOrder === undefined ? "mdy" : options.dateOrder;
    const accountName = options.accountName === undefined ? "Imported account" : options.accountName;
    const sourceName = options.sourceName === undefined ? "import.qif" : options.sourceName;
    if (currency !== "USD") throw new Error("This version supports USD only. Do not relabel another currency as USD.");
    if (!["mdy", "dmy"].includes(dateOrder)) throw new Error("Date order must be mdy or dmy.");
    Model.text(accountName, "Fallback account name", 1024);
    Model.text(sourceName, "Source name", 1024);
    if (!accountName.trim()) throw new Error("Provide a non-empty fallback account name.");

    const book = {
      schemaVersion: "1.0.0",
      generator: { name: "Sovereign Finance Porter", version: Model.VERSION },
      currency,
      dateOrder,
      sources: [{ id: "source-1", name: sourceName, format: "qif", text, parseOptions: { accountName, currency, dateOrder } }],
      accounts: [], categories: [], securities: [], transactions: [], unsupportedRecords: [], issues: [],
    };
    const accountByName = new Map();
    const once = new Set();
    let section = "", currentAccount = null, accountCandidates = [];
    let record = [], recordLine = 1, recordNumber = 0, cashRecordCount = 0;
    let accountContextInvalid = false, accountContextSeen = false, anonymousAccount = null;
    let sawHeader = false, accountListMode = false;

    function issue(severity, code, message, location, onlyOnce = false) {
      if (onlyOnce && once.has(code)) return;
      once.add(code);
      const item = { severity, code, message };
      if (location) { item.sourceRecord = location.sourceRecord; item.line = location.line; }
      book.issues.push(item);
    }

    issue("warning", "CURRENCY_ASSUMED", "QIF does not reliably identify account currency. This conversion explicitly treats all amounts as USD; confirm every account uses USD.");
    issue("info", "DATE_ORDER", "Dates are interpreted using the selected " + dateOrder.toUpperCase() + " order. Review an unambiguous date before exporting.");
    if (source.legacyEof) issue("info", "LEGACY_DOS_EOF", "A terminal Windows Ctrl-Z end-of-file marker was ignored while reading records. The complete original text, including the marker, remains in the archive.");

    function archive(raw, location, type, reason) {
      book.unsupportedRecords.push({ sourceId: "source-1", sourceRecord: location.sourceRecord, line: location.line, type, rawFields: raw.slice(), reason });
    }

    function recordError(raw, location, type, code, message) {
      archive(raw, location, type, code);
      issue("error", code, message, location);
    }

    function one(fields, key, required = false) {
      const values = fields.filter(line => line.startsWith(key)).map(line => line.slice(1));
      if (values.length > 1) throw new Error("A record repeats a field that must be unique.");
      if (required && !values.length) throw new Error("A record is missing a required field.");
      return values.length ? values[0] : "";
    }

    function getAccount(name, type, raw) {
      const existing = accountByName.get(name);
      if (existing) {
        if (existing.type && type && existing.type !== type) throw new Error("An account is declared with conflicting types.");
        if (!existing.type) existing.type = type;
        existing.rawFields.push(...raw);
        return existing;
      }
      if (book.accounts.length >= Model.MAX_ACCOUNTS) throw new Error("The source exceeds the 1,000-account limit. Export fewer accounts per file.");
      const account = { id: "account-" + (book.accounts.length + 1), name, type, currency, rawFields: raw.slice() };
      book.accounts.push(account);
      accountByName.set(name, account);
      return account;
    }

    function accountRecord(raw, location) {
      try {
        const name = one(raw, "N", true);
        if (!name.trim()) throw new Error("An account declaration has an empty name.");
        const rawType = one(raw, "T");
        const type = CASH_TYPES.get(rawType.trim().toLowerCase()) || rawType.trim();
        const account = getAccount(name, type, raw);
        accountCandidates.push(account);
        accountContextSeen = true;
      } catch (error) {
        accountContextInvalid = true;
        recordError(raw, location, "Account", "INVALID_ACCOUNT", "Account declaration could not be interpreted: " + error.message);
      }
    }

    function parseCategory(value) {
      if (!value) return { category: "", tags: [], transferAccount: null };
      if (value.startsWith("[")) {
        const close = value.indexOf("]");
        if (close <= 1 || value.slice(1, close).includes("[") || (value.length > close + 1 && value[close + 1] !== "/")) {
          throw new Error("A transfer category has unmatched brackets or an unsupported suffix.");
        }
        const suffix = value.slice(close + 1);
        return { category: "", tags: suffix.length > 1 ? [suffix.slice(1)] : [], transferAccount: value.slice(1, close) };
      }
      if (value.includes("[") || value.includes("]")) throw new Error("A category contains ambiguous transfer brackets.");
      const slash = value.indexOf("/");
      return { category: slash < 0 ? value : value.slice(0, slash), tags: slash >= 0 && slash < value.length - 1 ? [value.slice(slash + 1)] : [], transferAccount: null };
    }

    function targetAccount(type) {
      if (accountContextInvalid) throw new Error("Account context is malformed or ambiguous.");
      if (currentAccount) {
        if (!currentAccount.type) currentAccount.type = type;
        if (currentAccount.type !== type) throw new Error("Transaction section conflicts with its account type.");
        return currentAccount;
      }
      if (accountContextSeen || accountListMode) throw new Error("Select the transaction account explicitly after exporting the account list.");
      if (anonymousAccount && anonymousAccount.type !== type) throw new Error("An unnamed file contains multiple account types.");
      if (!anonymousAccount) {
        anonymousAccount = getAccount(accountName, type, []);
        issue("warning", "FALLBACK_ACCOUNT", "No explicit account accompanies these transactions. The supplied fallback account name is used; confirm this file contains only that account.", null, true);
      }
      return anonymousAccount;
    }

    function cashRecord(raw, location, type) {
      cashRecordCount++;
      if (cashRecordCount > Model.MAX_TRANSACTIONS) throw new Error("QIF exceeds the 100,000-transaction limit.");
      try {
        const fields = raw.filter(line => line !== "");
        const rawDate = one(fields, "D", true);
        const parsedDate = Model.dateParts(rawDate, dateOrder);
        const rawAmount = one(fields, "T");
        const rawAlternate = one(fields, "U");
        if (!rawAmount && !rawAlternate) throw new Error("Transaction amount is missing.");
        const amount = Model.parseMoney(rawAmount || rawAlternate);
        if (rawAmount && rawAlternate && Model.parseMoney(rawAlternate) !== amount) throw new Error("T and U amounts disagree.");
        const payee = one(fields, "P");
        const memo = one(fields, "M");
        const checkNumber = one(fields, "N");
        const category = parseCategory(one(fields, "L"));
        const rawCleared = one(fields, "C").trim().toLowerCase();
        const statuses = new Map([["", ""], ["*", "cleared"], ["c", "cleared"], ["x", "reconciled"], ["r", "reconciled"]]);
        if (!statuses.has(rawCleared)) throw new Error("Budgeted or unknown cleared states require manual review.");
        const splits = [];
        let pending = null;
        function finishSplit() {
          if (!pending) return;
          if (pending.amount === null) throw new Error("Split is missing its explicit amount.");
          splits.push({ amount: pending.amount, category: pending.category, tags: pending.tags, memo: pending.memo, transferAccount: pending.transferAccount });
          if (splits.length > 10000) throw new Error("Transaction exceeds the 10,000-split limit.");
        }
        for (const field of fields) {
          const tag = field[0], value = field.slice(1);
          if (tag === "S") {
            finishSplit();
            pending = { ...parseCategory(value), amount: null, memo: "", hasMemo: false };
          } else if (tag === "E") {
            if (!pending || pending.hasMemo) throw new Error("Split memo is repeated or has no preceding split.");
            pending.memo = value; pending.hasMemo = true;
          } else if (tag === "$") {
            if (!pending || pending.amount !== null) throw new Error("Split amount is repeated or has no preceding split.");
            pending.amount = Model.parseMoney(value);
          } else if (tag === "%" && !pending) throw new Error("Split percentage has no preceding split.");
        }
        finishSplit();
        if (category.category === "--Split--") {
          if (!splits.length) throw new Error("A split marker has no split detail records.");
          category.category = "";
        }
        if (splits.length && splits.reduce((sum, split) => sum + Model.toMinor(split.amount), 0n) !== Model.toMinor(amount)) {
          throw new Error("Split amounts do not equal the parent amount.");
        }
        const account = targetAccount(type);
        const transaction = { id: "tx-" + location.sourceRecord, sourceId: "source-1", sourceRecord: location.sourceRecord, line: location.line,
          accountId: account.id, date: parsedDate.iso, amount, payee, memo, ...category,
          cleared: statuses.get(rawCleared), checkNumber, splits, rawFields: raw.slice() };
        book.transactions.push(transaction);
        if (parsedDate.assumedCentury) issue("warning", "TWO_DIGIT_YEAR", "Some source dates omit their century. Years 00–69 are interpreted as 2000–2069; 70–99 as 1970–1999. Check the interpreted dates.", location, true);
        if (!payee.trim()) issue("warning", "MISSING_PAYEE", "Some transactions have no payee. Destination adapters may need to add an explicit placeholder.", location, true);
        if (fields.some(field => !"DTUCPMLNSE$%".includes(field[0]))) issue("warning", "UNMODELED_FIELDS", "Additional transaction fields are retained in the archive but are not represented by destination CSV columns.", location, true);
        if (fields.some(field => field[0] === "%")) issue("warning", "SPLIT_PERCENTAGE", "Percentage split metadata is retained in the archive; only explicit, balanced split amounts are exported.", location, true);
      } catch (error) {
        recordError(raw, location, type, "INVALID_TRANSACTION", "Transaction could not be safely interpreted: " + error.message + " Review this source record before converting.");
      }
    }

    function listRecord(raw, location, kind) {
      try {
        const name = one(raw, "N", true);
        if (!name.trim()) throw new Error("List entry has no name.");
        if (book[kind].length >= Model.MAX_LIST_ENTRIES) throw new Error("The source exceeds the 20,000-entry limit for this list. Additional entries remain in the source archive.");
        book[kind].push({ name, rawFields: raw.slice() });
      } catch (error) {
        archive(raw, location, section, "INVALID_LIST_RECORD");
        issue("warning", "INVALID_LIST_RECORD", "A list record is retained only in the archive: " + error.message, location, true);
      }
    }

    function flush(terminated) {
      if (!record.length) return;
      recordNumber++;
      if (recordNumber > Model.MAX_RECORDS) throw new Error("QIF exceeds the 200,000-record limit.");
      const raw = record;
      const location = { sourceRecord: recordNumber, line: recordLine };
      record = [];
      const cashType = CASH_TYPES.get(section.toLowerCase());
      if (!terminated) {
        recordError(raw, location, section || "Unknown", "UNTERMINATED_RECORD", "A record is missing its ^ terminator. The record is retained; destination conversion is blocked.");
        if (section === "Account") accountContextInvalid = true;
      } else if (section === "Account") accountRecord(raw, location);
      else if (cashType) cashRecord(raw, location, cashType);
      else if (section.toLowerCase() === "cat") listRecord(raw, location, "categories");
      else if (section.toLowerCase() === "security") listRecord(raw, location, "securities");
      else {
        const isInvestment = section.toLowerCase() === "invst";
        if (isInvestment) {
          cashRecordCount++;
          if (cashRecordCount > Model.MAX_TRANSACTIONS) throw new Error("QIF exceeds the 100,000-transaction limit.");
        }
        archive(raw, location, section || "Unknown", isInvestment ? "INVESTMENT_UNSUPPORTED" : "SECTION_UNSUPPORTED");
        issue(section ? "warning" : "error", isInvestment ? "INVESTMENT_UNSUPPORTED" : "SECTION_UNSUPPORTED",
          isInvestment ? "Investment activity is archived intact but is not converted to cash-transaction CSVs. Holdings, prices, and tax lots need a separate migration." : "A source section is retained in the archive without a destination interpretation.", location, true);
      }
    }

    const lines = source.parseText.replace(/^\ufeff/, "").split(/\r\n|\r|\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (line.length > Model.MAX_FIELD_LENGTH) throw new Error("QIF contains a field exceeding 65,536 characters.");
      if (line.startsWith("!")) {
        flush(false);
        sawHeader = true;
        const header = line.trim();
        if (header.toLowerCase() === "!account") {
          section = "Account"; currentAccount = null; accountCandidates = []; accountContextInvalid = false;
        } else if (/^!type:/i.test(header)) {
          if (section === "Account") {
            if (!accountContextInvalid && accountCandidates.length === 1 && !accountListMode) currentAccount = accountCandidates[0];
            else { currentAccount = null; accountContextInvalid = true; }
          }
          section = header.slice(6).trim();
          if (!section) { section = ""; issue("error", "EMPTY_SECTION", "A QIF section header has no type."); }
        } else if (/^!option:autoswitch$/i.test(header)) {
          accountListMode = true; currentAccount = null;
        } else if (/^!clear:autoswitch$/i.test(header)) {
          accountListMode = false; currentAccount = null; accountContextInvalid = true;
        } else {
          section = header.slice(1);
          issue("warning", "UNKNOWN_HEADER", "An unknown QIF header is retained in the original source. Following records are archived without interpretation.", null, true);
        }
      } else if (line.trim() === "^") flush(true);
      else if (line !== "" || record.length) {
        if (!record.length) recordLine = index + 1;
        record.push(line);
        if (record.length > 50000) throw new Error("A QIF record exceeds the 50,000-field limit.");
      }
    }
    // A trailing line break creates an empty entry after a correctly terminated
    // record; it is intentionally ignored by the loop above.
    flush(false);
    if (!sawHeader) issue("error", "NO_QIF_HEADER", "No QIF section header was found. Use a QIF export, not a QDF/QXF file or a report.");
    if (!book.transactions.length) issue("warning", "NO_CASH_TRANSACTIONS", "No supported cash transactions were normalized. Review the source sections and archived records.");
    return book;
  }

  return { parseQif };
});
