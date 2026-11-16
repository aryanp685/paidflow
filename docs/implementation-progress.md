# Implementation progress — local roadmap

Updated 2026-11-06. Status refers to the current working tree, including uncommitted work, not a release. **PARTIAL** means scope and/or acceptance remains incomplete; **BLOCKED** means the prerequisite is not met. No phase is asserted complete from mocked or synthetic testing alone. Baseline is in `docs/roadmap-audit.md`.

| Phase | Status | Implementation/evidence | Remaining acceptance / independent verification |
|---|---|---|---|
| Audit / baseline | PARTIAL | Current branch, PRs, code, SQL and tests reviewed; baseline rerun and recorded. | Full independent security/financial review and real-provider checks remain. Browser suite could not launch. |
| Customers | PARTIAL / NOT ACCEPTED | Search/filter, read-only tenant-scoped detail, invoice/payment history, recorded-balance aging, limited activity, separate edit and value-snapshot checks; mocked UI/action and synthetic PostgreSQL role/tenant/concurrency tests. Local 010 retry ledger remains undeployed. See `docs/customer-management-acceptance.md`. | Authenticated customer browser and real Auth/PostgREST tests, DB-wide versioning/ABA/direct-write bypass, duplicate/retention policy, reconciliation, GST domain review and scale remain. |
| Invoices | BLOCKED for issuance; PARTIAL drafts | Local 008 non-GST atomic drafts, read pages; 009 local issuance hold. | Editing, cancellation, issue/send, snapshots and legal rules unresolved. Holds not deployed. |
| India GST and financial correctness | BLOCKED | `docs/financial-gst-review-and-issuance-hold.md` and synthetic tests cover selected arithmetic and issuance guard. | Tax-professional review and independent vectors, comprehensive ledger and history verification required. |
| Payment ledger | PARTIAL | No-proof manual record/void and scoped reads; `docs/local-payment-recording.md`; synthetic DB and mocked UI. | Financial reconciliation, cross-invoice idempotency race, transport retries, real-provider and direct-API verification. |
| Proof security | BLOCKED | Local 007 denies new non-null links; hold UI. Baseline vulnerability demonstrations remain **security FAIL**. | Trusted byte-bound attestation and runtime separation, direct-bypass/lifecycle/concurrency, real scanner/provider, rollout/rollback. Hold is undeployed and no malware verification. |
| Reminders | PARTIAL | English/Hindi/Marathi editable manual handoff, mocked tests; `docs/local-manual-reminders.md`. | Native-speaker review, consent/privacy, provider and delivery/scheduling/history work. No message is sent by Paidflow. |
| Dashboard / analytics | PARTIAL | Issued invoice recorded balances and India-calendar aging; mock tests, exact-count guard and cap; `docs/local-invoice-analytics.md`. | Ledger reconciliation, provider scale/consistency, real data accuracy and performance. |
| OCR | BLOCKED / design only | `docs/local-ocr-review-gate.md` requires explicit human review. | Security gate and safe extraction/review/persistence/tests; never automatically create an invoice from uncertain OCR. |
| Team / settings / subscription | PARTIAL / BLOCKED | Local 011 and team UI with role checks; old RPC bypasses CAS and ABA is undetected. Settings/subscription billing incomplete. | API compatibility plan, versioned concurrency, Auth/authorization and sessions, invitations; no billing activation. |
| Premium UI and accessibility | NOT STARTED as a roadmap phase | Existing UI is not proof of requested final polish. | After features, responsive/motion/accessibility/performance review; Playwright currently unavailable. |
| Launch | BLOCKED | See `docs/release-readiness.md`. | All relevant gates, provider and independent review, separate authorization. |

## Change made after baseline in this pass

**Offline test staging coverage:** `scripts/isolated-offline-tests.sh` now stages the explicitly reviewed `scripts/offline-roadmap-files.txt` (48 previously untracked app/test source paths, including 16 unit test files), rejects missing files and escaping/file symlinks, and keeps the no-egress jail. It does not automatically stage arbitrary untracked files; future additions require manifest review. No database changes. This corrects the earlier misleading coverage risk: baseline isolated run had 50 tests, while the full local suite had 123.

Acceptance verified locally: isolated no-egress run now reports 27 files / 123 tests passed, archive tests 9, SMTP tests 11, hold tests 13, minimatch compatibility passed; optional encrypted PDF fixture still skipped. A deliberate missing manifest entry caused an early nonzero exit and was restored. Manifest uniqueness/existence check, `sh -n`, and `git diff --check` passed. This is test infrastructure, not real provider verification, proof security acceptance or a release authorization.

## Latest Item 13.2 local migration review

**PARTIAL / NOT ACCEPTED; Item 14 ON HOLD.** Local candidate only. Replaced unique duplicate policy with non-unique normalized indexes (no warning UI); audit now records changed field names only; protected identity/creation fields against ordinary trigger-enabled privileged updates. Added compatibility/owner/grant, shared-contact/concurrency, audit rollback/permissions, due boundary/cancelled/1,001-history and mixed-snapshot tests. **FAIL:** old direct writes revoked, privileged writers bypass CAS, mixed snapshots can diverge, four base proof vulnerabilities. **BLOCKED:** authenticated customer browser and real provider. 133 unit/offline and 80 mock Supabase ordinary checks pass; details and exact evidence in `customer-migration-review.md` and `customer-management-acceptance.md`. No hosted migration/deployment and no hold lifted.

## Latest Item 13.3

**PARTIAL / NOT ACCEPTED; Item 14 ON HOLD.** Candidate 016 adds a full-field versioned patch, privacy-limited duplicate advisory and one-statement financial snapshot. User-facing detail uses snapshot; optional create check reports only possible presence. Synthetic tests cover role/tenant, stale and concurrent patch, audit trigger bypass and concurrent payment during statement. Legacy writes, unknown privileged clients, actual provider/browser, retention and rollout remain unresolved. Unit/offline 136 and mock DB 88 ordinary checks pass; four payment-proof vulnerabilities remain **SECURITY FAIL**. See Item 13.3 reports and `customer-management-acceptance.md`.
