# Implementation contract v1

The browser loads UMD files in order: `core/model.js`, `core/qif.js`,
`core/exporters.js`, `core/zip.js`, then `app.js`. Each module exports via
CommonJS in Node and a global in the browser:

- `PorterModel`: `parseMoney(value)` -> normalized decimal string,
  `toMinor(value)` -> BigInt, `fromMinor(value)` -> string,
  `parseDate(value, order)` -> ISO date; order is `mdy` or `dmy`.
  `validateBook(value)` -> validated book or throw Error.
- `PorterQif`: `parseQif(text, options)` -> book. Options: `sourceName`,
  `accountName` (fallback for a single-account export), `currency` (`USD`),
  `dateOrder` (`mdy` default). Maximum source size 25 MiB; maximum 100,000
  transactions; reject binary/null characters; unknown records preserved.
- `PorterExporters`: `targets` array of {id,name,description},
  `analyze(book)` -> {accounts:[{id,name,type,transactionCount,total}],
  transactionCount,unsupportedCount,duplicateGroups,issues},
  `planExport(book,target,options)` -> {target,files:[{name,content}],
  warnings:[{code,message,count?}],blocked:boolean,summary}.
  options: `{splitMode:'flatten'|'preserve', acknowledgements:true}`;
  default flatten emits one CSV row per split with sum equal to parent.
  Original structure remains in the archive. `acknowledgements` is managed by UI;
  input errors always block CSV outputs. Canonical archive remains available.
- `PorterZip`: `makeZip(files)` -> Uint8Array; entries {name,content}; safe fixed
  relative paths only; UTF-8; uncompressed ZIP, no external dependency.

## Canonical book shape

```json
{
  "schemaVersion":"1.0.0",
  "generator":{"name":"Sovereign Finance Porter","version":"0.1.0-alpha.1"},
  "currency":"USD",
  "dateOrder":"mdy",
  "sources":[{"id":"source-1","name":"fictional.qif","format":"qif","text":"original source","parseOptions":{"accountName":"Imported account","currency":"USD","dateOrder":"mdy"}}],
  "accounts":[{"id":"account-1","name":"Example Checking","type":"Bank","currency":"USD","rawFields":[]}],
  "categories":[{"name":"Food","rawFields":[]}],
  "securities":[],
  "transactions":[{
    "id":"tx-1","sourceId":"source-1","sourceRecord":1,"line":1,
    "accountId":"account-1","date":"2026-01-01","amount":"-20.00",
    "payee":"Example Market","memo":"","category":"Food","tags":[],
    "transferAccount":null,"cleared":"","checkNumber":"",
    "splits":[],"rawFields":[]
  }],
  "unsupportedRecords":[],
  "issues":[]
}
```

Split shape is `{amount,category,tags,memo,transferAccount}`. Amount is exact
signed two-decimal USD. QIF date year convention: apostrophe explicitly denotes
2000+; plain two-digit years use 00-69 -> 2000-2069, 70-99 -> 1970-1999 and report
the assumption. ISO four-digit dates are also accepted.

`rawFields` is an ordered array of strings (full original lines, without line
terminators), preserving repeated fields. Unsupported record shape:
`{sourceId,sourceRecord,line,type,rawFields,reason}`. Issue shape:
`{severity:'error'|'warning'|'info',code,message,sourceRecord?,line?,transactionId?}`.
No financial values or source text should appear in uncaught errors or console logs.
Canonical v1 accepts this exact preview generator version and revalidates by
reparsing its retained QIF; it is not an arbitrary editable-ledger JSON importer.

Only known cash transaction section types Bank, Cash, CCard, Oth A, Oth L are
normalized. Investments are archived as unsupported until a loss-aware securities
model is implemented. Accounts/lists and original decoded source text are retained. Malformed
transaction records are preserved as unsupported AND produce an error that
blocks all destination CSVs. Unknown sections produce explicit warnings.

## Resource and output contracts

The browser and CLI accept QIF up to 25 MiB and portable JSON up to 100 MiB.
JSON always decodes as strict UTF-8 regardless of the selected QIF encoding.
Generated JSON must fit the same reload ceiling. CSV expansion is checked before
copying parent fields into split rows: at most 200,000 projected rows and a
conservative 64 MiB estimate. ZIP output is limited to 128 MiB. Blocked CSV plans
still contain source-preservation and report files; oversized archives fail
explicitly and require a smaller source.

Export summary shape is `{sourceTransactions,exportedRows,unsupportedRecords,
sourceNet,exportNet,currency,accounts,text}`. Per-account entries contain
`{accountId,name,file,sourceTransactions,exportedRows,sourceNet,exportNet}`.
These totals cover normalized banking transactions only and are not balances.
