# Financial test matrix

2026-11-06. Monetary values use integer paise and GST basis points in existing implementations. Tests are limited evidence, not legal or tax advice. No GST compliance claim or real invoicing approval is made.

| Area / scenario | Evidence classification | Current result / gap |
|---|---|---|
| Decimal input to paise, invalid/precision/bounds | MOCKED unit | Local invoice/payment validation tests pass; exact code paths, broader external contract and provider types remain to be reviewed. |
| Non-GST draft totals, atomic creation and retry | SYNTHETIC mock-Supabase PostgreSQL + MOCKED UI | Candidate 008 tested for role, tenant, atomicity and same-key replay/conflict. Not deployed; new keys/cross-tab and ambiguous transport remain. |
| GST 105 paise at 18% | SYNTHETIC PostgreSQL | Existing baseline computes 19 paise tax and 124 total; examples intra 10/9 CGST/SGST and inter 19 IGST; invalid 19/0 intra split rejected. No inference that the rule, rate or split is legally correct. |
| GST classification, place of supply, exemptions, credit notes, reverse charge, cess | NOT VERIFIED | Not implemented/reviewed comprehensively. Professional tax input and accepted/rejected vectors required. |
| Issuance transition / historical replay | SYNTHETIC PostgreSQL | Candidate 009 blocks ordinary new issue/direct insert and preserves selected historical replay; undeployed, privileged bypass and wider history immutability remain. |
| Record, partial/full payment, void, balance and selected retries | SYNTHETIC PostgreSQL + MOCKED app | Existing transactional RPC and UI tested locally. Different-invoice same-key race may unique-violate; cross-key duplicates, bank verification, reconciliation and independent financial review remain. Null proof is not a database boundary. |
| Overpayment, concurrent payments and role/tenant failures | SYNTHETIC PostgreSQL | Selected existing tests in `tests/database/run-tests.mjs` cover contention and access; require full matrix, real-provider replay, failure injection and independent verification. |
| Analytics / aging / dates / completeness | MOCKED unit | Recorded balance aggregation and India calendar buckets tested; 1,000-invoice cap, offset instability and accuracy against reconciled real ledger remain. |
| History, immutable records, migration/restore | SYNTHETIC upgrade cases only | Selected history preserved locally; administrator/definer writes, backup, restoration, rollback and independent reconciliation unverified. |
| Real bank/provider / GST expert | REAL PROVIDER: NOT VERIFIED | No payment network, real provider, real invoice or tax professional involved. |

See `docs/financial-gst-review-and-issuance-hold.md`, `docs/non-gst-invoice-draft-local.md`, `docs/local-payment-recording.md` and `docs/local-invoice-analytics.md` for exact scope and known limits. Before lifting issuance hold, get expert-approved vectors for all supported supply/rounding cases and test tenant, direct-RPC, retries, concurrency, immutable history and restore on an explicitly approved isolated provider environment.
