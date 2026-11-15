# Verification and publication handoff

Date: **2026-11-15**. Candidate: **0.1.0-alpha.1 development preview**.

## Observed evidence

| Check | Observed result |
|---|---|
| Canonical local gate, `npm run check` | 64 tests passed, 0 failed, 0 skipped; syntax and offline surface checks passed. |
| Source baseline | New isolated repository, no pre-existing application/tests; initial adapter/CLI slice had 20 passing checks. |
| Regression controls | New UTF-8 archive, archive-size and blank-payee checks failed on the previous implementation and passed after correction. |
| Real CLI path | Synthetic QIF → destination ZIP, refusal to overwrite, source unchanged, acknowledgement/currency guards tested. |
| Browser JavaScript path | UMD modules and application event/state logic exercised in a Node VM with an explicit DOM double. This is not a rendered browser. |
| ZIP structure | Deterministic bytes, known CRC vector, central directory, unsafe path/collision rejection checked. |
| Large archive / independent ZIP reader | A 9,450,011-byte fictional QIF produced 34,746,929-byte JSON; CLI reopened it and exported all 15,000 transactions with exact -15000.00 total. Python zipfile verified every entry CRC and original source text. |
| Financial scope | Separate accounts, exact debit/refund signs, both split modes, source/export sums, transfer references and duplicate retention checked. |
| Archive integrity | Reparse comparison detects removed errors, omitted or altered financial records; UTF-8 non-ASCII regression checked. |
| Independent review | Distinct non-author functional and security reviewers identified issues; corrections applied. Final review receipts accompany the candidate handoff. |

Local runtime: Linux, Node v24.22.1, Python 3.12.14. The optional Python browser
script passed syntax compilation; its browser checks did not execute here.

## Explicitly unverified gates

- **Actual rendered browser / Windows Chrome and Edge: NOT_RUN.** The local
  Playwright browser package was missing; system Chromium could not start because
  the execution environment denied its Unix socket. A cloud-browser attempt to
  open the local application was rejected by its URL policy. These restrictions
  were not bypassed. Browser rendering/download behavior remains unproven.
- **Hosted CI: PENDING INITIAL RUN.** The workflow is configured for Windows/Linux
  Node 22/24. Consult the [public Actions runs](https://github.com/scoobydont-666/quicken-migrate/actions)
  for results associated with the published commit; no hosted result is claimed
  by this pre-publication evidence record.
- **Live destination imports: NOT_RUN.** No Simplifi, Business & Personal web,
  Monarch, YNAB, Actual or GnuCash account was changed.
- **Real Quicken installation/export fixture: NOT_RUN.** Grammar and destination
  formats are grounded in primary documentation; committed fixtures are synthetic.
- **Production release, public deployment, npm publication: NOT_PERFORMED.**

These limitations make the delivery an implementation preview, not completion
of the full migration/release Definition of Done. The required remaining gates
are specified in [PLAN.md](PLAN.md). No household data or private repository
content is included.

## Run the browser gate on an allowed machine

Use a provisioned Python/Playwright environment with Chrome or Edge installed:

```bash
python scripts/browser_check.py --channel chrome
python scripts/browser_check.py --channel msedge
```

The script opens local `index.html` with network disabled, exercises fictional
data, inspects the actual ZIP and tests blocked-input behavior. It requires the
Playwright package; the authoring environment provided version 1.62.0, but could
not launch a browser. Record the exact package/browser versions used. A browser
launch failure is NOT_RUN, never PASS. Also manually check narrow layouts,
keyboard navigation, file dialogs and non-ASCII category/account names.

## Public repository handoff

Public repository: [scoobydont-666/quicken-migrate](https://github.com/scoobydont-666/quicken-migrate).
The repository owner's initial Apache 2.0 license is retained. The application
name remains Sovereign Finance Porter, and it has no private-suite dependency.

The original reviewed implementation is commit
`948715f29773b1a5bf29cbf4a328b4f93bc1f3bd` in the supplied Git bundle. Publication
adds the repository identity and aligns license metadata with the owner's
initialized repository; it does not change the reviewed runtime behavior.
Independent review receipts accompany the source package.

Use the complete source checkout or ZIP, retaining its LICENSE, documentation,
tests and fictional fixture. Do not add migration outputs or personal records.
Keep the release marked as a preview until browser and destination qualification
are recorded. Source publication is not a production release.

## Applicability of the release checklist

| Area | Status / reason |
|---|---|
| Scope and tests | Core conversion slice implemented and locally tested; end-user destination acceptance pending. |
| Error handling and integrity | Blocking errors and preservation tested; no silent guessed account assignment. |
| Security | No credentials/network/data service; text/CSV/archive and bounds inspected and tested. |
| Deployment, daemon restart, ports, fleet hosts | N/A: static file application and optional one-shot CLI, no service deployment requested. |
| Database migrations, secret vault, operational telemetry | N/A: no database, secrets or runtime collection. |
| Financial observability | Local counts, source/export net movements, issue positions and fidelity report implemented. |
| Performance | Resource limits tested; no claimed large-history browser latency benchmark. |
| Independent source review | Separate functional/security review; exact-source final receipts supplied at handoff. |
| Hosted CI and production adoption | Pending; local success does not stand in for those gates. |

Never close the overall release task merely because source is committed or a
preview ZIP exists. Never import into a real destination to satisfy a test gate.
