# Compatibility evidence

Research checked **2026-11-15** against the primary sources below. Documentation
can change. These are format-grounded preview adapters, not live-import
certifications. All source fixtures committed here are fictional.

## Quicken Classic source

Quicken's [Windows export guide](https://info.quicken.com/win/export-data-from-quicken)
documents QIF export of transactions and selected lists. Its [QXF guide](https://info.quicken.com/win/working-with-qxf-files)
describes a different transfer format, with exclusions. Porter does not parse
QDF/QXF or imply that QIF contains the complete original database.

The [GnuCash QIF grammar reference](https://raw.githubusercontent.com/Gnucash/gnucash/stable/gnucash/import-export/qif-imp/file-format.txt)
documents transaction/account/list fields and warns about locale ambiguity and
missing currency information. The implementation therefore requires an explicit
date order and USD confirmation, preserves unknown fields, and blocks account
attribution it cannot establish.

## Quicken Simplifi

[Official transaction import help](https://support.simplifi.quicken.com/en/articles/4413430-how-to-manually-import-transactions-in-quicken-simplifi),
dated August 3, 2026, documents this header:

```csv
Date,Payee,Amount,Category,Tags,Notes,Check_No
```

Dates are documented as M/D/YY; expenses are negative. Date, Payee and Amount
must be populated. Import is per account through the web app. Category and
subcategory assignment requires those categories to exist first. The help also
warns that deleted imported transactions cannot be restored by repeating the
same file into the same account.

The linked [download template](https://app.simplifimoney.com/files/import%20template.csv)
could not be retrieved in the research environment. The adapter follows written
official documentation; template-byte and live-import verification remain open.
Multiple-tag separator behavior is not fully specified there and is flagged.

### Conflicting four-column help

The [shared Simplifi / Quicken Business & Personal page](https://info.quicken.com/sim/how-to-manually-import-transactions)
instead documents `Date,Payee,Amount,Tags`, dates M/D/YYYY, signed expenses, and
one account per import. Porter exposes that as `simplifi-compat` and makes the
missing category/note/check columns explicit. Neither profile is silently
assumed correct for every current Quicken web product. Confirm its live template.

### Investment and balance history

[Investment transaction help](https://support.simplifi.quicken.com/en/articles/6540220-managing-investment-transactions)
currently permits importing investment transactions, but separates them from
holdings, portfolio value and balances. No verified investment import schema is
implemented here. "This adapter does not support investment migration" is the
accurate limitation; "Simplifi cannot import investments" is not.

[Historical balance import help](https://support.simplifi.quicken.com/en/articles/8912157-how-to-import-historical-balances-not-transactions-in-quicken-simplifi)
documents a separate Date/Amount file. Porter does not manufacture those
snapshots from transaction sums.

## Quicken on the Web

Quicken's [Web FAQ](https://info.quicken.com/web) describes the browser companion
and synchronization with Classic. It is not a standalone destination adapter in
Porter. The UI explains that distinction.

## Monarch Money

[Official import instructions](https://help.monarch.com/hc/en-us/articles/4409682789908-Importing-Transactions-Manually)
and its linked [sample spreadsheet](https://docs.google.com/spreadsheets/d/1YeAJpdAaWkVpy635ImlFfkgtkfwMSYQXwUVSuGaVD04/edit?gid=2114503272)
provide the implemented columns:

```csv
Date,Merchant Name,Data Provider Description,Amount,Category,Account,Tags,Notes
```

The sample uses ISO dates and signed amounts with negative expenses. Tags are
comma-separated within the CSV cell. Account, amount and date are required in
the general import route; account/category/tag mapping is reviewed during import.
Porter does not fabricate Monarch transaction IDs.

The documented overlap choices have materially different effects: prioritizing
CSV deletes existing records in the imported date interval; importing all can
duplicate records; prioritizing Monarch can exclude some supplied history.
Those choices belong to the user inside Monarch and are included in the kit.

## YNAB

[Official file import guide](https://support.ynab.com/en_us/file-based-import-a-guide-Bkj4Sszyo)
documents `Date,Payee,Memo,Outflow,Inflow`. Porter emits positive magnitudes in
the separate flow columns. The guide explicitly excludes category and split
import through this path. Category/tag details therefore travel in the memo and
archive, and flattened splits become separate transactions.

## Actual Budget

[Official import guide](https://actualbudget.org/docs/transactions/importing/)
documents QIF/OFX/QFX/CSV and configurable CSV mappings. Porter emits Date,
Payee, Notes, Category and Amount with ISO dates and signed amounts. Users must
review column mapping and matching of existing transactions. A [maintainer
explanation of category mapping](https://github.com/actualbudget/actual/issues/3428)
states that categories need to exist in the budget first.

The [official local API](https://actualbudget.org/docs/api/reference/) offers a
later higher-fidelity path for IDs, splits and transfers. It is not implemented
by this preview and is not required to run the converter.

## GnuCash and native QIF destinations

[GnuCash migration guidance](https://wiki.gnucash.org/wiki/Quicken_Migration)
and the [native import manual](https://wiki.gnucash.org/docs/C/gnucash-guide/importing-from-files.html)
describe importing single/multiple-account QIF, mapping categories into accounts,
and reviewing currency and investments. Porter supplies its original decoded
QIF text, including unsupported investment records, for that native importer.
It does not claim to have verified the resulting GnuCash ledger or tax lots.

## Acceptance receipt required for each destination

Record application/version/date, exact Porter commit/profile, source fixture
hash, import options, counts before/after, signs, category mapping, transfer
classification, split behavior, beginning/ending balance comparison and duplicate
retry behavior. Use disposable fictional accounts. Preserve receipts with the
release evidence; screenshots containing real finances do not belong in Git.
