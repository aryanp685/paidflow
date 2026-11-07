# Step 2D — local full-stack integration and security validation

> Historical Step 2D results. Both original failing regression cases pass after local Step 2D.1 remediation; see [the current remediation report](security-remediation-step-2d1.md). No malware scanner or production deployment is approved.

## Executive result: not production-ready

**22 integration checks passed and 2 security checks failed.** The end-to-end business workflow is only partially implemented: customer, invoice, payment and document-association application routes/UI are not present. The test uses the real Better Auth server handlers, PostgreSQL runtime role/RLS/functions and the guarded local S3 emulator. Customer/invoice/payment database operations are invoked from a test-only server wrapper that verifies a real session and membership. The proof-to-invoice association requires a **privileged synthetic fixture** because no authorized application operation exists. This is not a complete user-facing workflow or an approval to migrate/deploy.

### Failing checks

1. **Deleted payment proof can be used in a payment (financial-integrity blocker).** With an invoice-linked proof that has not yet been attached to a payment, the authorized storage delete transitions it to `deleted` and removes the object. The existing `public.record_payment` function then accepts the deleted proof ID and records a payment with `proof_attached`. The composite FK ensures the business/invoice match but does not require `storage_status = 'verified'` or guarantee an object still exists. The test proves this using a privileged synthetic fixture to create the invoice association; that association is not implemented for end users. Do not claim payment-proof retention or existence is enforced. A subsequent approved phase must design locking/ordering and a database-enforced lifecycle check, including attachment/deletion concurrency and legacy rows, before real money workflows. No financial function or existing migration was changed in Step 2D.
2. **Active-content PDF accepted as verified (document-safety blocker).** A structurally valid synthetic PDF with an `OpenAction` JavaScript entry is accepted and marked `verified`. PDF parsing verifies structure, not benignness, and there is no malware scan or active-content sanitization. Downloads are attachment-only and PDF inline preview is disabled, but opening a downloaded PDF may still be dangerous. “Verified” here is not malware-free; real document handling requires an explicit scanning/sanitization and isolation design, not merely signature checks. The test is non-destructive and uses synthetic content.

Both regression tests intentionally assert the desired rejection and therefore make `npm run test:integration:local` exit nonzero until the issues are addressed. No financial behavior was silently changed.

## A. Integrated workflow results

| Step | Actual result |
| --- | --- |
| Signup, email verification, login | Passed against real Better Auth handlers, real DB-backed sessions and synthetic local inbox. Unverified login was denied. |
| Business onboarding | Passed through the existing verified-session onboarding function for two synthetic users and two businesses. |
| Customer and membership authorization | Passed using a test-only server wrapper, authenticated session, restricted runtime role and parameterized SQL; no customer UI/API exists. |
| Invoice creation and issuance | Passed through the same wrapper, restricted role and existing invoice/line/issue functions; no invoice builder UI/API exists. |
| Evidence upload and business association | Passed through storage lab; the verified document references the correct business. No invoice/customer attachment workflow exists. |
| Payment proof upload and invoice link | Upload passed. The invoice/customer link was set **only by a privileged synthetic test fixture**; runtime direct update was denied and no application endpoint is implemented. |
| Partial payment, replay, concurrent overpayment | Passed through the existing payment RPC using a session-derived actor: initial payment 20,000 paise, one of two simultaneous 50,000-paise attempts succeeded, balance 30,000 paise, and idempotent replay did not duplicate payment. |
| Document download | Passed through a session-bound grant and authorized proxy. |
| Payment history and audit | Passed in the restricted database test, including actual actor and payment events. The product UI for these is absent. |
| Recovery and logout | Concurrent recovery had one success and one failure; replay failed and old sessions were revoked. A new login and logout revoked the new session. |

## B. Security results and boundaries

Passed locally: cross-tenant reads/writes; forged business selector, forged document ID and cross-tenant grant; actual HTTP upload with an attacker-supplied object-key header (ignored, server generated its own tenant-bound key); unauthenticated HTTP upload/grant; viewer restrictions; suspended membership; expired sessions; recovery replay/concurrency; reused pool commit/rollback actor isolation; invalid/mismatched types and oversize uploads; quarantine on injected storage error and retry; payment idempotency and concurrent overpayment. Storage regression additionally checks orphan cleanup, download grant expiry, storage tampering and delete retry. These cover local synthetic cases, not every possible exploit or network failure.

The two failed tests above are release blockers. An authorized operation already in progress may finish while revocation waits for database locks. The runtime actor GUC is set by trusted server code and is forgeable by someone with DB credentials or arbitrary SQL; RLS is not protection against a compromised server/migrator. Cleanup is manual, not a scheduled worker.

## C. Dependency audit (local npm registry metadata)

`npm audit` reports **12 affected package entries: 9 moderate, 3 high**. Most entries are inherited paths, not 12 independent defects. Root advisories: [dicer GHSA-wm7h-9275-46v2](https://github.com/advisories/GHSA-wm7h-9275-46v2), [minimatch GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), and fast-xml-parser [GHSA-x3cc-x39p-42qx](https://github.com/advisories/GHSA-x3cc-x39p-42qx) / [GHSA-gh4j-gqv2-49f6](https://github.com/advisories/GHSA-gh4j-gqv2-49f6). `npm audit --omit=dev` reported zero entries at the time of testing; this is not a complete security assessment.

All twelve affected packages below are **dev/build/test dependencies, not application production runtime dependencies** in the current npm graph. The production boundary test also found no `s3rver` in Next trace manifests. However, the application's separate `@aws-sdk/client-s3`, `sharp` and `pdf-lib` remain production dependencies, and AWS SDK files appear in server trace manifests; only the emulator package is absent from the production graph. Dev tools and a running local emulator remain reachable during development/testing.

| Affected package / installed version | Severity; directness | Production runtime reachable? | Patch / compatibility assessment |
| --- | --- | --- | --- |
| `s3rver` 3.7.1 | High; direct dev | No; local emulator only | No fixed 3.x release identified; npm suggests downgrade to 2.2.9, a major-version change requiring a separate compatibility and security review. Do not force it. |
| `busboy` 0.3.1 | High; transitive via s3rver | No | 1.6.0 removes vulnerable dicer dependency; major/API change. S3rver calls the older constructor, so overriding blindly can break it. |
| `dicer` 0.3.0 | High; transitive via busboy | No | No patched dicer version identified; latest 0.3.1 is within `<=0.3.1` advisory range. Replace dependency path, not a blind bump. |
| `fast-xml-parser` 3.21.1 | Moderate; transitive via s3rver | No | 4.1.2 addresses the older prototype-pollution advisory; **5.7.0+** addresses both listed advisories. Major API change from v3; S3rver uses v3 APIs, so override is breaking/unverified. |
| `minimatch` 10.2.6 | Moderate; transitive via typescript-estree | No; lint tooling only | 11.0.1 is outside the reported affected range; major upgrade from the `^10.2.2` dependency range, compatibility with typescript-estree unverified. |
| `@typescript-eslint/typescript-estree` 8.72.1 | Moderate; transitive via typescript-eslint | No; lint tooling only | Inherited minimatch path; no fixed compatible published release identified at audit time. Updating/overriding minimatch to 11 is a major transitive change. |
| `@typescript-eslint/parser` 8.72.1 | Moderate; transitive | No; lint tooling only | Inherited typescript-estree/minimatch; no independently patched release identified. Requires a compatible upstream dependency update or reviewed override. |
| `@typescript-eslint/type-utils` 8.72.1 | Moderate; transitive | No; lint tooling only | Inherited typescript-estree/utils path; no independently patched release identified. Upstream/override compatibility must be verified. |
| `@typescript-eslint/utils` 8.72.1 | Moderate; transitive | No; lint tooling only | Inherited typescript-estree/minimatch; no independently patched release identified. Upstream/override compatibility must be verified. |
| `@typescript-eslint/eslint-plugin` 8.72.1 | Moderate; transitive | No; lint tooling only | Inherited parser/type-utils/utils path; no independently patched release identified. Upstream/override compatibility must be verified. |
| `typescript-eslint` 8.72.1 | Moderate; transitive via eslint-config-next | No; lint tooling only | Inherited packages above; current latest inspected version is 8.72.1 and still uses the vulnerable minimatch range. A major minimatch override is unverified. |
| `eslint-config-next` 16.4.5 | Moderate; direct dev | No; lint tooling only | Inherited typescript-eslint path. npm suggests downgrading to 15.5.29, a major version mismatch against Next 16; do not force. Await/review an upstream compatible fix. |

S3rver itself does not validate SigV4 and normally allows anonymous access. The local wrapper requires an ephemeral guard token, binds loopback, and blocks multipart POST and unnecessary operations, but **does not fix npm advisories or establish R2 security**. Do not run it against untrusted traffic or real files.

## D. Missing product functionality

The production/Supabase workspace's customer, invoice, payment, evidence and other section pages explicitly say “coming soon.” There are no completed customer/invoice/payment APIs or UI, no authorized document-to-invoice/payment association operation, no real payment-history UI, and no existing data or account migration. The Better Auth and storage labs are opt-in and deliberately unavailable in production. The payment proof association in this report is a fixture, not an implemented user action. No claims are made about OCR extraction, automatic payment verification, or real email delivery.

## E. Neon / R2 compatibility gaps

No Neon or R2 account, resource, endpoint, migration, billing operation, or network test was used. Local PostgreSQL 18.6 and a single local pg pool are not evidence of Neon role ownership, BYPASSRLS, PgBouncer/session behavior, cloud outages or concurrent serverless execution. S3rver is not evidence of R2 SigV4/IAM, private bucket policies, presigned URL expiration/revocation, multipart semantics, consistency under network faults, encryption, lifecycle policies, retention or provider-specific errors. Real presigned URLs are bearer tokens that typically persist until expiration even after membership is revoked; authenticated proxy downloads remain necessary where fresh authorization is required. No provider compatibility is asserted.

## F. Production boundary and blockers

A new fail-closed Next configuration check refuses production startup/build if any `PAIDFLOW_BA_LAB_*` or `PAIDFLOW_STORAGE_LAB_*` variables are present, without including values in errors. The local production-boundary test injected an ephemeral sentinel and confirmed refusal without logging its value, then started a clean local production server and received 404 for lab pages and APIs. **An external platform can still place secrets in the process environment before Next runs**; the test proves the application refuses that configuration, not that an operator/platform cannot inject or observe environment variables. Never configure local secrets in production.

The test scanned generated client JS for private lab env names and PostgreSQL URL literals, searched lab source for public/presigned URL construction, and found no `s3rver` in production dependency output or trace manifests. These are focused checks, not proof that every possible credential or custom deployment path is safe. `@aws-sdk/client-s3` still appears in server deployment traces even though the lab routes are blocked. No emulator listener or endpoint is intentionally exposed by the production app.

The Supabase rollback files were not modified in this phase and the six original migration hashes match prior baselines. A local mock-Auth SQL suite passed, but that is not a real Supabase Auth/PostgREST integration. The legacy Supabase recovery marker remains insufficiently bound to recovery/session type, as documented in `docs/auth-onboarding.md`; keeping fallback does not make that flow safe for real users. Also unresolved: the two failed checks, dev dependency advisories, production mail/TLS/abuse controls, data migration/retention, privileged-role boundaries, real provider tests, and full product workflows.

## G. Recommended next phase (approval required)

Before product development or cloud provisioning, approve a focused local remediation: (1) design and test database-enforced verified-proof attachment with safe deletion/association lock ordering, idempotency and concurrency; (2) define a safe document policy and scanning/sanitization/isolation approach for active PDFs and malicious files; (3) reassess dev emulator dependency alternatives and npm advisories; (4) rerun this suite, including its two currently failing tests. Separately design authorized document association and customer/invoice/payment workflows. Do not provision cloud resources or deploy without a further decision.

## Local test ledger

| Suite | Result |
| --- | --- |
| Full server/DB/storage integration | **22 passed, 2 failed** (both blockers detailed above) |
| Step 2A PostgreSQL | 43 passed, 0 failed |
| Step 2B Better Auth handlers | 29 passed, 0 failed |
| Step 2B browser | 7 passed, 0 failed |
| Step 2C storage handlers | 25 passed, 0 failed |
| Step 2C browser/API | 10 passed, 0 failed (includes new forged-key, forged-ID and unauthenticated cases) |
| Supabase rollback SQL, mocked Auth | 30 passed, 0 failed; additional transactional SQL suite passed |
| Unit | 19 passed, 0 failed |
| Existing Playwright | 10 passed, 0 failed |
| Production boundary | 5 passed, 0 failed |
| Lint, typecheck, production build | Passed |

Reproduction uses a **fresh disposable local PostgreSQL cluster**, no shared server or tunnel. The runners create/drop temporary DBs and cluster-wide roles and refuse existing test roles; interrupted runs may need local cleanup. The full integration test is expected to return exit 1 while the two security assertions fail:

```sh
export PAIDFLOW_INTEGRATION_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55436/postgres'
export BETTER_AUTH_TELEMETRY_DISABLED=1
npm run test:integration:local
npm run build
npm run test:production-boundary
```

See the Step 2A/2B/2C docs for their separate variables and test commands. Temporary emulator/inbox data are private, synthetic and removed by the runners. A loopback connection alone does not rule out a tunnel; the operator must ensure the cluster is actually local and disposable.
