# Sovereign Finance Porter

Public repository: [quicken-migrate](https://github.com/scoobydont-666/quicken-migrate).

**Move your financial history. Keep the original. Choose your next app.**

An independent, offline tool for converting Quicken Classic QIF exports into
transaction import files for Quicken Simplifi, the separately documented Quicken
web compatibility profile, Monarch Money, YNAB, Actual Budget, and other software.
It also creates a destination-neutral archive and preserves the original QIF
text for native import into applications such as GnuCash.

**Status: development preview, 0.1.0-alpha.1.** Conversion, archive integrity,
CLI behavior and browser orchestration have automated tests. Scripted headless
checks pass in Windows Chrome, Windows Edge and Linux Chromium. Manual visual
and accessibility review, real Quicken fixtures and actual destination imports
remain release gates. See
[verification evidence](docs/VERIFICATION.md). Do not treat a locally generated
CSV as proof that a destination accepted it correctly.

## Try it locally

1. Extract the entire project folder.
2. Open **index.html** in desktop Chrome or Edge.
3. Select **Try a fictional example** to inspect the workflow.
4. For your own export, choose a QIF, confirm its date order, text encoding and
   USD currency, and select **Read export**.
5. Review accounts, amounts and warnings, choose a destination, then download
   the migration kit.

There is no install, server, cloud account, runtime dependency, telemetry or
bank connection. Keep all files together: `index.html` loads local scripts and
styles from the same folder. No source data is uploaded or stored in browser
persistent storage. Closing or clearing the tab releases its workspace; files
you deliberately downloaded remain on your computer.

Windows Chrome and Edge passed the scripted local-file and download workflow
on hosted Windows runners. These headless checks complement the Node browser-state
tests; they do not establish manual visual or accessibility acceptance.
Browser policies managed by an employer may restrict local HTML files.

## Export from Quicken Classic

Keep a backup of the original Quicken database. In **Quicken Classic for
Windows**, use **File → File Export → QIF file**. Select the account/date range
and include transactions and relevant account/category lists. For a file with
no named account header, supply the correct account name in Porter. An ambiguous
multi-account list blocks conversion rather than silently choosing an account.

Porter reads **QIF**, not **QDF** databases or **QXF** transfer files. QIF is a
text interchange format that Classic exports. Quicken's own [export guide](https://info.quicken.com/win/export-data-from-quicken)
describes the source workflow. A QIF export may omit data from your original
database; retaining QIF is not a substitute for retaining the QDF backup.

## What this preview does

- Parses banking, credit-card, cash, asset and liability QIF transactions.
- Uses exact integer minor units internally, with decimal strings in archives.
- Retains named accounts, categories, tags, notes, checks, source cleared state,
  split detail and transfer references in the archive.
- Rejects invalid dates, unsupported amount precision, inconsistent T/U amounts,
  malformed split totals, ambiguous account attribution and unterminated records.
- Keeps unsupported records, including investments, with their source fields.
- Flags duplicate candidates without removing legitimate identical purchases.
- Exports separate account files and reconciles each source/export net movement.
- Allows flattening splits or preserving each parent once with split detail in
  notes where the destination supports notes.
- Escapes spreadsheet formula text in CSV and reports that transformation.
- Offers a reusable UTF-8 JSON archive whose normalized contents are revalidated
  against the preserved QIF when reopened.

No transfer counterpart is invented. No destination login, automatic upload,
account deletion, subscription cancellation or transaction creation is performed.

### Destination profiles

| Profile | Output | Main preparation or limitation |
|---|---|---|
| Quicken Simplifi | Seven-column CSV per account | Pre-create categories; verify the current template and two-digit date centuries. |
| Quicken web Business & Personal / compatibility | Four-column CSV per account | Separate official help profile; no category, note or check columns. Confirm the live template. |
| Monarch Money | Documented transaction CSV per account | Review account/category/tag mapping and destructive overlap options. |
| YNAB | Date, Payee, Memo, Outflow, Inflow | Categories remain in Memo; native splits are not created. |
| Actual Budget | Mappable per-account CSV | Pre-create/map categories; review duplicate matching and transfers. |
| Portable CSV | date, payee, amount, category | ISO dates, signed amounts; richer metadata remains in JSON. |
| GnuCash / native QIF | Original QIF text and checklist | Use the destination's native QIF wizard; no reconstructed investment or tax-lot claims. |
| Portable archive | JSON, original QIF text, reports | Can be reopened by this exact preview version without editing. |

The current Quicken help pages disagree on four versus seven CSV columns and
date formatting. Porter deliberately exposes separate profiles and records the
discrepancy. [Source research and exact schemas](docs/COMPATIBILITY.md) explain
what was verified and what still requires destination testing.

**Quicken on the Web** is a Classic companion that uses synchronization. It is
not presented as an independent database-import destination. Quicken Simplifi
and Quicken Business & Personal web are separate products with documented CSV
paths. See Quicken's [Web FAQ](https://info.quicken.com/web).

## Your migration kit

The ZIP contains:

- `README-FIRST.txt`: destination-specific steps and limitations.
- `import/`: destination transaction CSVs, only when conversion is valid.
- `portable-book.json`: versioned interpretation plus original decoded QIF text.
- `original-source/`: original decoded QIF saved as UTF-8.
- `migration-report.json`: source/export counts, account net movements, warnings
  and duplicate candidates.
- `review/accounts.csv` and `review/categories.csv`: account and category setup aids.

**Net movement is not a verified account balance.** Opening balances, incomplete
history, liabilities, transfers, deleted records and destination behavior must
be checked against the source registers and statements. Balance-history import
is a separate capability and is not fabricated from transaction sums.

Output files are **unencrypted**. Use trusted encrypted storage. Do not attach
real exports, kits, logs or screenshots to public issues. Original text is
preserved; a Windows-1252 input is decoded and re-encoded as UTF-8, so the saved
QIF is not a byte-for-byte backup of that original encoding.

## Optional command line

Node.js 22 or 24 is needed only for the CLI and development checks. No npm
dependencies or installation step are required.

```bash
node cli.js examples/fictional-household.qif --inspect
node cli.js examples/fictional-household.qif --currency USD --target simplifi --out migration.zip --acknowledge-losses
node cli.js examples/fictional-household.qif --currency USD --target archive --out preservation.zip
node cli.js portable-book.json --target ynab --out ynab-migration.zip --acknowledge-losses
node cli.js --help
```

Use `--date-order dmy` for day-first QIF and `--encoding windows-1252` for an older
Windows text export. JSON always uses strict UTF-8. `--splits preserve` retains
one parent row; the default is `flatten`. Existing output files are never
overwritten. Inspection prints counts and issue codes, not payees or amounts.

## Current boundaries

This preview supports **USD only**, one reviewed QIF source at a time. QIF does
not reliably declare currency, so confirm it explicitly. Do not combine files
with different currencies or relabel their amounts.

Limits: QIF 25 MiB, JSON 100 MiB, 100,000 source transactions, 1,000 accounts,
20,000 categories/securities, 10,000 splits per transaction, 200,000 projected
CSV rows, a conservative 64 MiB CSV expansion budget and a 128 MiB ZIP ceiling.
The expansion guard runs before repeating long parent text for split rows.

Investment actions are preserved but not converted into banking transactions.
Tax lots, cost basis, attachments, budgets, scheduled bills, business invoices,
rules, online connections and verified balance snapshots require later adapters
or destination-specific reconstruction. Current Simplifi documentation permits
investment imports, but this project has not verified that investment schema.

## Development and public contribution

```bash
npm run check
```

This performs syntax/offline-surface checks and the nonempty, zero-skip test
suite. `npm test` runs the suite alone. CI uses disposable Windows/Linux runners,
read-only permissions and pinned external actions. A workflow file is not
evidence of a hosted run; the evidence record names actual results.

- [Plan and acceptance gates](docs/PLAN.md)
- [Architecture and portability contract](docs/ARCHITECTURE.md)
- [Implementation interfaces](docs/CONTRACT.md)
- [Compatibility evidence](docs/COMPATIBILITY.md)
- [Verification and publication handoff](docs/VERIFICATION.md)
- [Security policy](SECURITY.md)
- [Contribution guide](CONTRIBUTING.md)

Licensed under [Apache 2.0](LICENSE). This project is independent and is not affiliated with or endorsed
by Quicken, Monarch, YNAB, Actual Budget, GnuCash or any bank. Product names are
used to identify interoperability targets.
