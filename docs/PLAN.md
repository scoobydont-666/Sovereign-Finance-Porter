# Delivery plan

## Goal and acceptance scope

Make a public, independent migration path from Quicken Classic history to a
choice of financial applications. A successful first slice accepts a legitimate
QIF, shows what can and cannot move, exports documented transaction formats, and
preserves everything available in the source for a future destination.

The first acceptance contract is a **development preview**, not a claim of a
complete database conversion or unattended migration. No real bank/customer
data is needed to develop or test it.

| ID | Acceptance example | Implementation/evidence |
|---|---|---|
| A1 | Named checking, savings and card records remain separate with exact signs | QIF + exporter tests. |
| A2 | Split children add to their parent; chosen export does not double-count | Both split modes and source/export totals tested. |
| A3 | Bad date/amount/account context blocks CSV, original record survives | Parser and blocked-export tests. |
| A4 | Every adapter emits its documented columns and date/sign convention | Exporter tests and compatibility references; live acceptance pending. |
| A5 | Unknown/investment records are visible and preserved | Source/archive tests. |
| A6 | Duplicates and unmatched transfers are flagged without invented changes | Targeted tests. |
| A7 | Archive round trip rejects inconsistent records and preserves non-ASCII text | Canonical and browser-state tests. |
| A8 | No runtime network/persistent storage; text cannot execute; output cannot overwrite | Static guard, CSV/ZIP/CLI and browser-state tests. |
| A9 | A Windows user can open the app and download a valid kit offline | Intended workflow implemented; real Chrome/Edge qualification pending. |
| A10 | A disposable destination accepts a synthetic kit with correct balances/classification | Explicitly pending per destination. |

## Phase 1 — Public preview and destination qualification

The implemented slice is QIF → strict canonical archive → local review → CSV or
original-QIF kit. Before a public release tag:

1. Finish independent source reviews on the exact candidate and resolve blockers.
2. Run `npm run check` on Windows/Linux Node 22/24 in the new public repository.
3. Open the extracted folder on Windows Chrome and Edge with network disabled.
   Exercise selection, both encodings, non-ASCII archive reload, blocked input,
   split modes, acknowledgement, ZIP download and clear/reset.
4. Import fictional fixtures into disposable accounts in Simplifi, the current
   Quicken Business & Personal web product, Monarch, YNAB, Actual and GnuCash.
   Record exact product/date, selected profile, warnings, transaction counts,
   amounts and cleanup behavior. Do not use production accounts for this gate.
5. Confirm the Simplifi live downloadable template. Resolve the four/seven-column
   documentation discrepancy with observed behavior and keep profile versioning.
6. Build a source/app ZIP from the reviewed commit; test the extracted artifact,
   record SHA-256, and publish a clearly labeled prerelease with known limitations.

The tool itself never performs the target upload. Destination mutation requires
the user's intentional import inside that destination.

## Phase 2 — Broader sources and better review

Ordered work packages:

1. Add mapped CSV import with a fixture-driven mapping UI, explicit delimiters,
   headers, date/sign rules, account binding and preview. Refuse ambiguous columns.
2. Add OFX/QFX parsers using maintained, reviewed format libraries or narrowly
   specified parsers; use genuine transaction IDs and retain statement metadata.
3. Add multiple-source staging with source hashes, explicit overlap windows,
   account mapping and a review queue. Never automatically collapse identical
   legitimate records merely because their date/payee/amount matches.
4. Add category/tag mapping and transfer matching with explicit user decisions.
   Preserve original fields and emit mapping provenance into a new archive version.
5. Add statement-backed opening/closing balances and reconciliation. Preserve
   imported snapshots as independent observations; do not infer missing history.
6. Move large-file parsing/export into workers or bounded streaming after measuring
   representative 10k/50k/100k histories. Keep the no-network and cancellation rules.
7. Add versioned archive upgrades and interoperability tests for independent
   consumers. A generic CSV path is not proof of native ledger integration.

Each package requires known fixture expectations, failure/rollback behavior,
resource bounds and independent review. The local UI and CLI share one core.

## Phase 3 — Higher-fidelity destinations and investments

1. Build an opt-in Actual Budget API adapter against a disposable local budget.
   Preserve imported IDs, categories, splits and transfers; prove no double
   counterpart creation and verify retry/matching behavior.
2. Implement a securities model covering actions, quantities, prices, fees,
   cash effects, holdings and explicit lots. Separate known source facts from
   computed/unknown basis. Validate against native source registers and statements.
3. Qualify investment-specific Simplifi formats and other portfolio destinations;
   do not route investment buys/sells through a banking CSV merely to import them.
4. Define attachment/document manifests and destination-specific manual/API paths.
5. Add independent balance-history imports where documented, with actual source
   observations and explicit date/currency semantics.

Budgets, scheduled reminders, business records and rules require their own
capability contracts. A destination without a supported interface receives a
portable preservation format and reconstruction checklist, not a pretend API.

## Phase 4 — Suite integration

Publish a stable versioned adapter interface that financial, retirement,
document and tax applications can consume locally. Importers must own staging,
preview, deduplication, atomic commit and reversal/recovery. A reference consumer
should prove multi-account imports and transfer linking before being described
as integrated. Keep private deployments and household records outside this repo.

## Non-goals

No bank credential collection, direct bill payment, live account modification,
proprietary QDF decryption, guessed undocumented cloud API, subscription
management or AI inference is needed for this migration tool. No investment
performance or tax advice is calculated by this preview.
