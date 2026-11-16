# Roadmap item 13 — customer management acceptance

**Latest:** Item 13.4 evidence and classifications appear at the end of this document; earlier sections are historical where they differ.

**Latest status:** See the Item 13.2 section at the end and `customer-migration-review.md`. Earlier sections below are historical and may describe superseded code or results.

**Status: PARTIAL / NOT ACCEPTED for production**, 2026-11-06. This is local uncommitted work on `arena/4c754980-paidflow`; no hosted access, schema application, production deployment, merge or release. Relevant evidence was reviewed again before edits, including all five roadmap reports, the branch, working tree, schema/RLS, customer code, existing tests and isolated runner.

## Implemented in this pass

- Customer list: server-derived tenant scope, literal name substring search, active/archived/all filter, stable name/ID ordering, exact-count pagination, view links available to every active tenant member, and error/empty/loading states. Search and filter persist in pagination links. Offset paging is not snapshot-consistent; the list caps navigation at 50,000 records. Search is name-only; provider behavior and indexing need review.
- Customer detail: tenant-scoped contact fields for active and archived customers; independently paginated invoice and payment histories with recorded/voided and lifecycle/archive status; last 20 customer-specific activity events. Archived invoices are shown without links because their existing detail route excludes them. Activity is explicitly incomplete: the baseline only audits customer creation, not customer edits, and related invoice/payment events are not shown as customer events. Existing tenant RLS allows active members to read activity logs.
- Outstanding and aging: reuse `invoiceAnalytics`, integer paise and the recorded `balance_paise` for non-archived issued invoices, consistent with existing analytics and payment RPC behavior. It is **not** an independently reconciled ledger or verified payment. The app fails on incomplete results, and refuses partial totals when over 1,000 issued invoices. Due today is not overdue, using India calendar date. Invoice/payment/history queries are separate statements and may reflect different instants under concurrency; no snapshot or reconciliation is claimed.
- Edit route is separate and owner/admin/manager-only; the server action also verifies live workspace and role and scopes updates to tenant, customer and non-archived status. It atomically compares the displayed values with stored values before applying edits; two different edits from one unchanged snapshot cannot ordinarily overwrite each other. This is value-based, susceptible to ABA, client-controlled snapshot substitution and direct SQL/API writers bypassing the app check; it is **not** database-wide versioning. Failed/stale updates instruct reload and reveal no provider details. The baseline `updated_at` is not automatically advanced on customer edits, so it is not used as a concurrency token.
- Contact validation rejects malformed email/phone; GSTIN accepts optional standard PAN-based format and validates a base-36 check digit and matching state prefix. This does not establish registration, ownership, state-code allocation or tax compliance; nonstandard registration identifiers are not supported and need tax/domain review. Existing legacy records with other formats may require correction before editing. Baseline database grants/direct writes and local 010 RPC have weaker validation, so app validation is not a database-wide guarantee.
- Existing create flow retains the local 010 same-business/same-key replay protection. Different keys, devices/tabs and direct inserts can still create duplicate customers. The private retry ledger stores original contact PII; retention/erasure/backup and direct grants need review. Candidate migration 010 was already present locally and was not changed or applied here.
- Tables scroll horizontally on small screens; search and form fields reflow. Actual authenticated customer workflows, screen-reader behavior and mobile rendering remain unverified in a real browser.

## Security and acceptance evidence

| Requirement | Result and classification |
|---|---|
| Cross-tenant and roles | MOCKED page/action tests check server-derived scope, malformed IDs, foreign/missing customer and viewer edit denial. SYNTHETIC PostgreSQL tests check tenant RLS on customer/invoice/payment/activity reads and direct updates, viewer write denial and customer create RPC role denial. Not a real Supabase Auth/PostgREST test. |
| Concurrent edits | MOCKED stale/malformed snapshot and SYNTHETIC PostgreSQL parallel conditional updates: one of two differing writes wins. Direct PostgREST concurrency, ABA and bypass by legacy direct writers are not solved. |
| Validation / duplicates | MOCKED action/schema tests cover missing/malformed input, bad email/phone, GSTIN shape/check digit and state mismatch, and retry behavior. SYNTHETIC PostgreSQL 010 tests cover same-key replay/conflict and concurrent requests, not general duplicate detection or real API validation. |
| Invoice/payment history, balance and aging | MOCKED provider tests check tenant/customer query predicates, rendering recorded values and failing closed for incomplete rows and >1,000 totals. Existing synthetic payment ledger tests exercise representative partial/void/concurrency cases; no independent reconciliation or provider snapshot proof. |
| Test suite | `npm test`: **28 files, 132 tests passed**. Relevant customer/pagination/form subset: **5 files, 28 tests passed**. `npm run lint`, `npm run typecheck`, production build and `git diff --check` passed. |
| Isolated offline runner | Before edits, after restoring locked dependencies, it ran the previous **27 files / 123 tests** with no-route/no-capability/chroot probe; optional encrypted-PDF test skipped. Manifest staging adds files only; isolation mounts, network namespace, env clearing and capability drops remain. Runner now compares local and staged Vitest test paths and fails if a test was silently omitted. A deliberately unlisted test caused the expected early failure. Final run: **28 files / 132 tests**, archive 9, synthetic SMTP 11, hold 13 and minimatch compatibility passed; optional encrypted fixture still skipped. Explicit manifest must be maintained and is not automatic permission to stage arbitrary untracked source. |
| Database integration | `PAIDFLOW_TEST_PG_DIR=/tmp/customer-pg/package/native sh scripts/isolated-database-tests.sh`: mock Supabase PostgreSQL **64 ordinary checks passed, 4 known proof vulnerabilities demonstrated (security acceptance FAIL)**; Neon lab 44 plus one proof vulnerability; storage 40, Better Auth 29, local integration 39, upgrade 9 passed. PostgreSQL was staged temporarily from hash-verified npm package. These are local synthetic tests, not hosted Supabase/Neon or customer app-to-PostgREST integration. |
| Browser investigation | No existing Chromium/Chrome binary found. Playwright expected Chromium 158; a temporary npm-sourced Chromium 153 initially failed to launch due to missing `libnspr4.so`; after extracting its temporary bundled Linux libraries, **10 existing landing/auth tests passed** with that alternative browser. This does not test authenticated customer flows or establish compatibility with Playwright's pinned browser. No browser dependencies were added to the repository. |
| Production boundary | Clean-environment local production-boundary checks: **5 passed**. No production service was contacted. |

## Files changed in this pass

- `src/app/(workspace)/workspace/customers/page.tsx` — search, status filter, list navigation.
- `src/app/(workspace)/workspace/customers/[id]/page.tsx` — scoped detail, financial history/aging and limited timeline.
- `src/app/(workspace)/workspace/customers/[id]/edit/page.tsx` — restricted edit route.
- `src/app/(workspace)/workspace/customers/error.tsx`, `loading.tsx` — safe error/loading states.
- `src/app/(workspace)/workspace/customers/actions.ts`, `src/components/customers/customer-form.tsx`, `src/lib/validation/customer.ts` — snapshot edit and validation/form changes.
- `src/lib/supabase/database.types.ts` — narrow payment customer ID and activity-log type additions; `src/app/globals.css` — responsive customer layouts.
- `tests/unit/customers.test.ts`, `tests/unit/customer-detail.test.tsx`, `tests/database/run-tests.mjs` — customer validation, page/action and synthetic RLS/concurrency cases.
- `scripts/isolated-offline-tests.sh`, `scripts/offline-roadmap-files.txt` — reviewed staging and omission detection.
- `docs/customer-management-acceptance.md`, `docs/implementation-progress.md`, `docs/roadmap-audit.md` — this evidence and status.

Many of these files were already untracked or modified before this pass; prior work was preserved. **Database impact:** no new migration or changes to schema, payment RPCs, invoice numbering or financial migrations. Existing local 010 remains a prerequisite for create and remains undeployed.

## Blockers to COMPLETE

1. Approved isolated real-provider Auth/RLS/PostgREST and app-to-database integration; direct action/API, concurrent update and search escaping behavior must be verified independently.
2. Authenticated customer browser tests on desktop/mobile including keyboard, accessibility, loading/errors, success/retry and cross-tenant navigation; the 10 passing browser tests cover only landing/auth.
3. Database-wide concurrency/versioning and duplicate policy, existing direct-write permissions, PII retention/erasure and audit completeness need an explicit design/compatibility decision. App snapshot CAS alone is bypassable and has ABA.
4. Verify financial reconciliation, archived-invoice treatment, concurrency/snapshot consistency and large-customer limits. GST identifier types/check digits and state rules require domain review. Do not imply legal compliance or verified payments.
5. Existing proof, issuance and recovery gates remain blocked independently; their baseline vulnerability demonstrations remain security failures. No hold was lifted.

## Follow-up

The earlier results above describe the preceding pass. Subsequent local versioned customer edits, duplicate-policy/audit/GST migration proposals, synthetic reconciliation, current test results, compatibility concerns and the blocked authenticated browser suite are recorded in `docs/customer-item13-local-followup.md`. Item 13 remains **PARTIAL**; no hosted migration or release occurred.

## Item 13.2 — latest migration security review (supersedes conflicting earlier candidate claims)

**Overall: PARTIAL / NOT ACCEPTED.** **Security: FAIL**, **compatibility: FAIL**, authenticated customer browser/provider: **BLOCKED**. Local SQL 012–015 is a proposal only, not applied or approved. Details: `docs/customer-migration-review.md`, `docs/customer-grant-compatibility.md`, `docs/customer-duplicate-policy.md`, `docs/customer-concurrency-acceptance.md`.

- **PASS synthetic:** normalized email/phone/GSTIN no longer uniquely constrained; shared/archived identifiers and prior duplicate rows survive. Non-unique indexes only; warning UX **NOT IMPLEMENTED**. Same-key idempotency still tested. No automatic merges.
- **PASS synthetic:** ordinary versioned RPC stale/ABA/concurrent checks, tenant authorization and tamper denial; update audit now includes changed field names without values; ordinary audit writes denied and audit failure rolls back update. **FAIL** privileged direct writers bypass CAS; owner can disable triggers; actor can be null. **FAIL** legacy direct INSERT/UPDATE and missing legacy field APIs; real roles/clients/rollback **NOT TESTED**.
- **PASS limited synthetic financial fixtures:** partial/multiple/voided/concurrent payments, archive/cancel, due-date boundaries, 1,001 history. **FAIL** demonstrated mixed-snapshot reconciliation under concurrent payment; no production reconciliation or stable cross-query snapshot claimed.
- **PASS regressions:** 28 unit files/133 tests, isolated offline runner with same 133, lint/typecheck/build/diff check; DB mock Supabase 80 ordinary tests with **four demonstrated proof vulnerabilities (SECURITY FAIL)**; Neon 44/one, storage 40, Better Auth 29, integration 39, upgrade 9. Optional encrypted PDF fixture **NOT TESTED**. All mocks/local only.
- **BLOCKED:** five authenticated browser cases failed before test bodies: Playwright 1.65.0 expects Chromium 158 revision 1254, missing binary and required shared libraries; isolated synthetic provider absent. Real hosted integration forbidden. GSTIN domain policy, special IDs, real role ownership/privileges, operational audit retention and migration/rollback require review.

All existing proof attachments, download/preview, issuance and recovery holds remain. No hosted access, migration, deployment or release. **Item 14 remains on hold.**

## Item 13.3 — latest review; supersedes conflicting earlier results

**Customer Management: PARTIAL / NOT ACCEPTED. Migration proposals 012–016: NOT APPROVED. Item 14: ON HOLD.**

- **PASS limited synthetic / FAIL legacy compatibility:** 016 adds expected-version patch for all previously granted customer mutable fields, including archive/unarchive, but new UI still edits only six fields through old RPC, unknown privileged writers can bypass CAS, and old direct clients remain broken. See `customer-writer-compatibility.md`.
- **PASS synthetic / BLOCKED browser:** optional presence-only duplicate check for authorized managers includes archived records, never blocks or merges; cross-tab/network races remain. `customer-advisory-duplicates.md`.
- **PASS synthetic / FAIL tamper resistance:** audit actor/changed names/no-op/stale/rollback/unauthorized mutations tested; owner disabling trigger demonstrably suppresses audit. `customer-audit-integrity.md`.
- **PASS bounded synthetic:** customer balance and payment page now use one stable SQL statement; a test commits payment while the statement is paused and demonstrates consistent before/after snapshots. Invoice history and other requests remain independent. `customer-snapshot-consistency.md`.
- **PASS local checks:** unit 28 files / 136 tests; offline jail same 136 plus 9 archive, 11 mail, 13 synthetic hold checks (encrypted-PDF optional fixture **NOT TESTED**); lint/typecheck/build pass. Mock Supabase DB 88 ordinary checks / 0 errors and **four vulnerabilities demonstrated (SECURITY FAIL)**; local Neon 44/one vulnerability, storage 40, Better Auth 29, integration 39, upgrade 9. Synthetic data, not hosted. Cross-language GSTIN vectors pass; special IDs/registration not verified. Detailed tests in four Item 13.3 reports.
- **BLOCKED:** five authenticated browser tests fail at missing Chromium 158 headless shell revision 1254 before test bodies; required shared libraries also absent and no isolated provider fixture. Playwright 1.65.0 uses CDN not accessible in this environment; prior pinned download returned ECONNRESET. Real Supabase/PostgREST and rollout/rollback **NOT TESTED**. Four base proof-association vulnerabilities remain **SECURITY FAIL** regardless of ordinary checks.

No hosted database access or production changes; no holds lifted. Complete local SQL: `customer-migrations-012-016-sql.md`.

## Item 13.4 — latest independent verification (supersedes earlier counts)

**Item 13: PARTIAL / NOT ACCEPTED. Migrations 012–016 NOT APPROVED. Item 14 ON HOLD.**

| Acceptance dimension | Decision | Evidence / blocker |
|---|---|---|
| Functional implementation | **PARTIAL** | Existing create/edit/advisory and detail mocked/synthetic; full-field patch not wired to UI; archive/unarchive UI absent. `customer-writer-compatibility.md`. |
| Legacy compatibility | **FAIL** | 012/013 revoke direct writes; unknown external clients and Neon legacy runtime remain. Expand/contract is design only: `customer-migration-rollout-plan.md`. |
| Concurrency guarantees | **PARTIAL** | ordinary CAS/row-lock tests and one-statement payment/void snapshots pass synthetic; privileged owner bypass and multi-request page consistency remain. `customer-snapshot-consistency.md`. |
| Audit integrity | **PARTIAL** | ordinary denial/rollback/actor/no-op tested; owner disable demonstrated; independent sink and retention design only. `customer-audit-integrity.md`. |
| Browser verification | **BLOCKED** | 5 launch failures, 0 assertion bodies; exact pinned Chromium/library and local provider fixture missing. `customer-provider-browser-verification.md`. |
| Real provider | **BLOCKED** | No real Supabase Auth/RLS/PostgREST or external writers/roles inspected. |
| Security | **FAIL** | four proof-association vulnerabilities demonstrated, independent of ordinary checks. |

**Commands/results:** `npm ci --no-audit --no-fund`; `npm test` **28 files/137 tests PASS**; `sh scripts/isolated-offline-tests.sh` **28/137 PASS** plus 9 archive verifier, 11 mail, 13 synthetic hold checks, optional encrypted-PDF fixture **NOT TESTED/SKIP**; `npm run typecheck`, `npm run lint`, `NEXT_TELEMETRY_DISABLED=1 npm run build`, `git diff --check` PASS. `PAIDFLOW_TEST_PG_DIR=/tmp/paidflow-134-pg/package/native sh scripts/isolated-database-tests.sh`: mock Supabase **95 ordinary checks passed, 0 errors, four proof vulnerabilities demonstrated (SECURITY FAIL)**; Neon **44 plus one demonstrated vulnerability**, storage 40, Better Auth 29, integration 39, upgrade 9 passed; all disposable synthetic. 20,001 voided payment row page test and 1,001-invoice cap pass; one synthetic performance observation is not a performance SLO. Full conditions/commands and limitations are in linked reports.

No hosted data access, production migration, deployment, push, merge, release, hold change or Item 14 work. Existing SQL/API contracts were not changed by 13.4.
