# Contributing

Use fictional fixtures only. Never submit financial exports, account identifiers,
credentials, household screenshots or private infrastructure details.

Run `npm run check` with Node 22 or 24. No npm dependency installation is needed.
Submit a focused change explaining the source/destination behavior, preserved
data, fidelity limits and tests. Changes to parser semantics require archive
version compatibility work; do not silently reinterpret old preserved sources.

A new adapter needs an official format reference and date, golden CSV/file
examples, exact sign/date/encoding rules, unsupported-field reporting, transfer
and split decisions, duplicate/retry behavior and a disposable destination import
receipt. Local format tests alone justify a documented preview profile.

No bank login, automatic upload, telemetry, persistent browser storage, external
scripts or hosted conversion may be added without a separate reviewed design.
Keep monetary arithmetic exact. Reviewers must be independent of the code they
approve, and required reviews must bind to the final candidate revision.
