# Sovereign Finance Porter

This is a public, independent financial-data portability project within the
Sovereign Finance Software Suite. Do not copy private repositories, household
records, credentials, infrastructure details, or model telemetry into this tree.
Use fictional fixtures only.

## Engineering contract

- Runtime is offline browser-native JavaScript, plus an optional Node CLI.
- No network calls, external scripts, analytics, bank credentials, database,
  persistent browser storage, or automatic writes to destination services.
- Money uses exact integer minor units internally and decimal strings in JSON.
- Preserve source text and unsupported records. Never silently drop transactions,
  guess ambiguous account attribution, round amounts, or remove duplicates.
- Destination capabilities are sourced and versioned; never promise a complete
  app/database migration based on transaction-CSV compatibility.
- Keep target exports distinct from the canonical archive. Require review of
  fidelity warnings and block transactional exports on input errors.
- Test the real browser/CLI path and failure cases. Two independent reviews are
  required before a production release; do not claim live destination acceptance
  from local tests.

Run `npm test` and `npm run check`. See `docs/PLAN.md` for acceptance scope.
