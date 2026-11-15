# Architecture and portability

## Decision

Use a small, dependency-free browser application with a shared JavaScript core
and optional Node CLI. The primary task is local file transformation; it does
not require a database, web service, cloud account, bank connector or AI model.
A local-server implementation would add installation and transport boundaries.
A hosted converter would add unnecessary financial-data handling. The browser
file application keeps the first workflow simple and auditable.

The public project owns open interchange formats and conversion. Household
finance systems remain consumers; their data, code and deployment arrangements
do not belong in this repository.

## Modules and trust boundaries

| Module | Responsibility | Failure behavior |
|---|---|---|
| `core/model.js` | Exact money, explicit dates, canonical validation | Reject invalid structure, unsupported schema or changed source interpretations. |
| `core/qif.js` | Stateful QIF records and account attribution | Preserve malformed/unknown records; blocking errors disable CSV. |
| `core/exporters.js` | Target profiles, loss report, reconciliation, resource preflight | Block unsafe conversions; never invent financial postings. |
| `core/zip.js` | Deterministic uncompressed ZIP | Reject unsafe paths, collisions and oversized bundles. |
| `app.js` | Local file reading, preview, review acknowledgement, download | Invalidate stale plans and release in-memory data on clear. |
| `cli.js` | Local batch invocation | Exclusive output creation; no overwrite flag; explicit USD and loss acknowledgement. |

Source files are untrusted text. The browser renders strings through text nodes;
it never evaluates source content. The Content Security Policy disables network
connections and external content. No persistent browser data store is used.
The optional CLI uses standard filesystem operations and has no HTTP client.

An archive is a preservation artifact, not evidence that a financial institution
or exporter is truthful. Reparse validation detects inconsistencies between its
stored source and interpretation; it does not authenticate the original source
or resist an attacker rewriting both consistently. Signing/source provenance is
a future feature and must not be implied by the word "validation".

## Data semantics

Amounts are signed decimal strings, normalized to two fractional digits. BigInt
minor units provide arithmetic without binary floating-point rounding. Positive
means money entering that account; negative means money leaving. A credit-card
purchase stays negative and a payment into the card stays positive.

QIF dates use an explicit month/day or day/month selection. Four-digit ISO dates
retain their year. Plain two-digit years use an explicit 1970–2069 window with a
warning; apostrophe year notation means 2000 onward. The seven-column Simplifi
adapter discloses its two-digit output and blocks dates outside that window.

All original decoded source text remains in the canonical archive. Raw field
order and unsupported sections are retained. A malformed transaction is not
accepted as a partial success: it is archived and records an error that blocks
all generated CSV files. Nontransaction/investment limitations are warnings
requiring review. The original QDF may contain additional information that QIF
never exported.

Split rows must sum exactly to the parent. Flatten mode exports the children
only; preserve mode exports the parent only. There is no parent-plus-children
double count. Transfer references are retained but links are not created, and
missing counterpart transactions are never synthesized. Same-date/payee/amount
matches are candidates for human review; identical legitimate purchases remain.

CSV quoting does not by itself prevent spreadsheet formulas. Text starting with
a formula marker gets a leading apostrophe and a report warning. This can affect
category/name matching in a destination; original values remain in JSON/QIF.
Validated numeric amount fields retain their original signs.

## Reusable archive contract

`schemaVersion: 1.0.0` archives are bound to generator `0.1.0-alpha.1` in this
preview. `sources[0].parseOptions` records the fallback account name, date order
and USD currency. Reopening validates references, types, money, split balances,
IDs and source coverage, then reparses the original QIF and compares normalized
data. Hand-editing this JSON is intentionally not a supported import path.

Future versions must implement an explicit archive upgrade before changing
parser semantics, preserve unknown fields and offer a rollback/preservation
path. Old source data must not be silently reinterpreted under a new parser.
Downstream software can read the published shape now, but direct application
integration remains unimplemented. Public interchange needs its own import
transactionality, stable cross-file identifiers, and account/transfer mapping.

Source-local IDs are audit references. They are deliberately not exported as
cross-file deduplication keys; doing so could collide across independent QIF
exports. Source hashes, explicit overlap windows and target receipts belong in
a future incremental-migration protocol.

## Operational model

The runtime has no network service to operate. Updates replace the downloaded
program folder, while original financial sources remain separate. Keep the
previous application version alongside any alpha archive until compatibility is
verified. Clear releases tab state; it cannot erase files, browser downloads,
operating-system swap, clipboard content or copies held by other applications.

Resource guards limit source size, records, fields, accounts, output rows and
split expansion. These are safety bounds, not measured performance guarantees.
Large-file parsing is currently synchronous and may briefly block the UI; a
worker/streaming design is planned after representative workload measurement.
