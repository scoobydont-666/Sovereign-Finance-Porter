# Security and financial-data handling

This preview reads local text and produces local files. It has no network
client, account system, analytics, server, database or persistent browser store.
It cannot protect records from a compromised operating system, browser extension,
shared download folder or an application that later opens the exported files.

Keep QDF/QIF sources and migration kits on trusted encrypted storage. Output
JSON/QIF/CSV and ZIP are plaintext. Source control exclusions are convenience
guards, not protection against intentional `git add --force` or arbitrary
renamed financial files. Review every staged file before publishing.

Report security problems using a private security advisory on the hosting
repository if that feature is enabled. If it is unavailable, open only a minimal
issue asking for a private reporting channel. Do not publish exploitation details
or attach private financial files. Use the fictional fixture and a small synthetic
reproduction wherever possible.

Money/date corruption and unnoticed record loss are security-relevant findings.
Specify application version, source format, destination profile and a synthetic
example. Do not include real payees, account numbers, balances or source paths.

Before a production release, two independent reviews must examine exact source
bytes, and Windows/browser/destination qualification must be recorded. This file
does not claim those external gates have run.
