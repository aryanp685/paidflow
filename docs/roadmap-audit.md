# Paidflow roadmap audit and baseline

**Latest architecture decision:** user selected Supabase Auth + Supabase Database as intended target. Historical Item 13.5 statements that no target was selected are superseded; source-of-truth and provider status remain unverified. This decision does not approve 012–016, hosted access, migration, deployment or hold removal. See `item-13.5-architecture-decision.md` and `IMPLEMENTATION_PROGRESS.md` for latest work; other sections are historical where they differ.

Baseline taken 2026-11-06 UTC on `arena/4c754980-paidflow` at `0ce31ccc7e866add30988f60297c4b78767a5b79`, **including substantial pre-existing uncommitted and untracked local work**. Git history is shallow; GitHub PRs #1, #2 and #3 are merged, with #3's merge at HEAD. A merged PR is not evidence that subsequent local candidates were deployed. No hosted provider was accessed in this audit. Previous provider reports are historical, not current state.

## Inventory and execution boundaries

- Next.js app in `src/app`; Supabase SSR auth and workspace business context gate workspace pages. Customer, invoice, payment, reminder, analytics and team local routes contain provider queries/actions. See `src/lib/validation`, `src/lib/financial`, `src/lib/data` and their corresponding components and unit tests.
- Original Supabase migrations 001–006 define tenant data, grants/RLS, onboarding, financial RPCs and audits. Candidate 007 denies new non-null proof attachment; 008 creates non-GST drafts atomically; 009 holds new issuance; 010 adds customer request-key creation; 011 adds a member-access compare-and-set RPC. These candidates are local, untracked and **not deployed**. Existing grants/RPCs remain applicable; UI restrictions are not database boundaries. `tests/database/run-tests.mjs` exercises standalone PostgreSQL with mocked Supabase identity, not real Supabase/PostgREST.
- `neon/`, `better-auth-lab/`, `storage-lab/` and their tests are local alternatives/experiments, not production protections. Storage structural checks are not scanner attestations. Production boundary tests check lab routes are unavailable in a local production build.
- Env *names* and dependency metadata were inspected without recording values. `package-lock.json` used with Node 22.22.3/npm 10.9.8. No secrets are included here.

## Baseline commands, before new implementation

| Command/check | Result | Evidence and limitation |
|---|---|---|
| `npm ci --no-audit --no-fund` | PASS | 760 packages; deprecation warnings. |
| `npm test` | PASS | 27 files, 123 tests; predominantly mocked/jsdom. |
| `npm run typecheck`; `npm run lint`; `NEXT_TELEMETRY_DISABLED=1 npm run build` | PASS | Local production build. |
| `PAIDFLOW_TEST_PG_DIR=/tmp/paidflow-postgres-test/package/native sh scripts/isolated-database-tests.sh` | Test harness PASS; **security acceptance FAIL** | Supabase mock 62 ordinary checks and four deliberately demonstrated baseline proof vulnerabilities; Neon 44 ordinary checks and one vulnerability; storage emulator 40, Better Auth 29, integration 39, upgrade 9 passed. Disposable isolated local PostgreSQL, no real Supabase or Neon. |
| `sh scripts/isolated-offline-tests.sh` | PASS with skip/coverage limitation | Archive verifier 9, SMTP synthetic 11, 13 hold checks, minimatch cases, 50 unit tests passed; optional encrypted PDF test skipped (fixture absent). Stages tracked files plus a fixed allowlist, so it excludes most untracked roadmap features and tests. |
| `node tests/integration/production-boundary.mjs` with clean environment | PASS | 5 local build checks, not deployment. |
| `npx playwright test` with clean environment | **FAIL / NOT VERIFIED** | All 10 failed at browser launch: expected Playwright Chromium executable missing; no browser assertions executed. |
| `npm audit --omit=dev` | PASS at baseline | 0 reported vulnerabilities in production dependency graph. |
| `npm audit` | **FAIL** | 4 findings: 3 high, 1 moderate, in dev dependency chain involving `s3rver`, `busboy`, `dicer`, `fast-xml-parser`; no safe compatible fix established. |
| `git diff --check` | PASS | Tracked diff only; untracked files require separate review. |

## Prioritized findings and dependencies

1. **Critical / BLOCKED:** Base Supabase and Neon paths accept unscanned proof metadata; additional Supabase reuse paths demonstrated. Local hold 007 is undeployed and does not protect Neon. Production needs byte-bound trusted scanner attestation, separated authority, fail-closed direct SQL/RPC enforcement, lifecycle/concurrency/history controls and real provider verification. Upload, download and preview stay held. See `step-13-security-architecture.md` and `docs/local-proof-attachment-hold.md`.
2. **Critical / BLOCKED:** Tax determination, historical immutability and legal/commercial rules are incomplete; issuance hold 009 is local only. Do not issue real invoices or equate paise arithmetic tests to compliance. See `docs/financial-gst-review-and-issuance-hold.md`.
3. **High / PARTIAL:** Existing payment RPC and local recording/void UI preserve selected transactional history; cross-invoice same-key race and ambiguous transport retries remain. Proof association is separate and blocked. See `docs/local-payment-recording.md`.
4. **High / PARTIAL:** Customer create request key is scoped to same business/key and RPC; new keys, other tabs and direct inserts can duplicate; request ledger stores contact PII and needs retention/deletion review. Customer updates and reads need real provider and concurrency verification.
5. **High / PARTIAL:** Team CAS 011 compares values, not versions (ABA); original granted RPC bypasses CAS. No invite acceptance, ownership transfer or identity lookup. See `docs/local-team-access.md`.
6. **High / BLOCKED:** Recovery UI holds updates, but the provider-level flow is not verified and the caller-controlled label is not a security boundary. Do not enable recovery absent provider validation.
7. **Medium / PARTIAL:** Reminder handoff is manual and unsaved; no delivery, scheduling or tracking. Analytics uses recorded balances, capped complete reads, and mocked tests; offset pagination shifts under concurrent changes. OCR is design only with mandatory human review. No billing or subscription activation.
8. **Verification gaps:** Real provider Auth/RLS/PostgREST/storage, migration ordering/rollback, restore, abuse, accessibility, browser behavior and operational review remain outstanding. The offline script's untracked-file omission is a test-coverage gap, not a 123-test isolated pass.

Further implementation must preserve historical data, integer paise and existing RPC contracts. See `docs/implementation-progress.md`, `docs/security-gaps.md`, `docs/financial-test-matrix.md` and `docs/release-readiness.md` for current status.

## Item 13 follow-up — local customer implementation

See `docs/customer-management-acceptance.md` for file-by-file changes, exact results and outstanding acceptance. The customer list now has name search and status filters; tenant-scoped details include invoice/payment histories, recorded-balance aging and a limited customer-only activity view. Edits compare a client-supplied value snapshot in the update; direct writers can bypass it and ABA remains. GSTIN validation supports standard PAN-based shape/check digit, not registration verification or all identifier classes. This is not a real-provider or full browser acceptance: status remains **PARTIAL**. No database migration or financial RPC contract was changed.

Current-run offline baseline independently confirmed 123 tests, and after the added tests the no-egress runner executed 132. It now detects unstaged unit-test paths rather than silently accepting a smaller suite. The earlier 50-test result in the baseline table is historical. Current synthetic mock-Supabase DB suite: 64 ordinary checks passed and four proof vulnerabilities demonstrated (security acceptance FAIL). With temporarily staged Chromium 153 and its Linux libraries, the 10 existing landing/auth Playwright tests passed; authenticated customer flows were not tested and Playwright's pinned Chromium 158 was not available.

## Latest Item 13.2 local migration review

**FAIL / BLOCKED; Item 13 PARTIAL / NOT ACCEPTED; Item 14 ON HOLD.** Latest results supersede earlier duplicate-uniqueness claims: non-unique advisory indexes preserve shared contact/GSTIN data, without an implemented warning UI. Legacy write grants are revoked and privileged direct writers bypass CAS; financial mixed snapshots can diverge. Synthetic Supabase 80 ordinary checks plus four demonstrated proof vulnerabilities (**SECURITY FAIL**), 133 unit/offline tests pass; authenticated browser/provider **BLOCKED**. Full evidence and migration SQL links: `customer-management-acceptance.md`, `customer-migration-review.md`, `customer-grant-compatibility.md`, `customer-duplicate-policy.md`, `customer-concurrency-acceptance.md`. No hosted operations or holds lifted.

## Latest Item 13.3

**FAIL / BLOCKED, Item 13 PARTIAL / NOT ACCEPTED, Item 14 ON HOLD.** Local candidate 016 adds full-field versioned patch (not wired for all fields), authorized presence-only duplicate advisory, and one-statement balances/payment page; legacy direct writes still break, privileged owners bypass CAS/audit, real provider/browser not verified. 136 unit/offline tests and 88 ordinary mock Supabase DB tests pass; four base proof vulnerabilities demonstrated (**SECURITY FAIL**). See `customer-writer-compatibility.md`, `customer-advisory-duplicates.md`, `customer-audit-integrity.md`, `customer-snapshot-consistency.md`, updated acceptance and complete SQL bundle `customer-migrations-012-016-sql.md`. No hosted migration or holds lifted.

## Latest Item 13.4 independent verification

**Item 13 PARTIAL / NOT ACCEPTED; Item 14 ON HOLD.** Functional PARTIAL; legacy compatibility FAIL; concurrency PARTIAL; audit PARTIAL; browser BLOCKED; real provider BLOCKED; security FAIL. 137 unit/offline tests and 95 ordinary mock Supabase DB checks passed, but **four proof vulnerabilities remain demonstrated**. 016's invalid JSON, nulls, role grants, real row-lock wait, 20,001-payment paging, max paise, concurrent void and performance sample were tested locally; external roles, actual PostgREST and rollback remain blocked. See updated `customer-management-acceptance.md`, `customer-writer-compatibility.md`, `customer-migration-rollout-plan.md`, `customer-snapshot-consistency.md`, `customer-audit-integrity.md`, `customer-provider-browser-verification.md`. No holds lifted.

## Latest Item 13.5 — release blockers and architecture decision

**BLOCKED:** target architecture not formally selected in available evidence. **REPOSITORY VERIFIED:** current customer application and proposals 012–016 are Supabase-specific; `docs/neon-better-auth-switch-plan.md` is planning only and Neon/Better Auth is a local lab, not an approved switch. **EXTERNAL OWNER CONFIRMATION REQUIRED:** choose target and source of truth, sign writer/role inventory, approve retirement window and separately authorized isolated test environment/artifact provenance. **NOT TESTED:** real provider, target-specific staged upgrade/rollback, audit sink and exact browser/fixture. **SYNTHETIC TEST VERIFIED:** earlier Item 13.4 evidence only; four known proof vulnerabilities remain **SECURITY FAIL**. See `item-13.5-architecture-decision.md`, `item-13.5-legacy-compatibility-closure.md`, `item-13.5-browser-prerequisites.md`, `item-13.5-provider-verification-plan.md`, `item-13.5-acceptance-gates.md`. Item 13 **PARTIAL / NOT ACCEPTED**, migrations 012–016 **NOT APPROVED**, holds unchanged, Item 14 **ON HOLD**. No code or migration changes in 13.5.
