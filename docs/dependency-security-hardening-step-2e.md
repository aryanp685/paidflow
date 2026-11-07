# Step 2E — local dependency and security hardening

## Outcome

**Not production-ready.** No dependency versions were changed because no compatible patched versions were found for the affected locked dependency paths. The two Step 2D.1 security regressions and all requested local suites pass. This phase narrowed local emulator operations, redacted some local database error paths, and added tests for audit metadata and log leakage. These controls do not make the emulator production-safe or replace malware scanning.

Only synthetic data, disposable local PostgreSQL 18.6, and the existing guarded local emulator were used. No cloud provisioning, deployment, paid service, production data or Supabase project was accessed. All six Supabase migrations and the prior 2A–2D.1 migrations remain unchanged; the first 16 existing migration files were verified against their previous SHA-256 baselines. No migration was added or applied remotely.

## Before / after npm audit

| Audit | Before | After |
| --- | --- | --- |
| Full dependency graph | 9 moderate, 3 high, 12 affected package entries | 9 moderate, 3 high, 12 affected package entries |
| `npm audit --omit=dev` | 0 | 0 |
| Advisories fixed this phase | — | **None** |

A non-mutating `npm audit fix --dry-run` proposed no package version changes and still reported all 12 entries; it also listed optional-platform packages in the simulated plan. SHA-256 checks confirmed `package.json` and `package-lock.json` were unchanged. No `--force`, override, downgrade or new dependency was used. Audit findings can change as the registry advisory database changes; a clean production-only audit is not a security guarantee.

These are **12 affected package entries, not 12 distinct underlying advisories**. The independent advisories in this audit are [dicer crash GHSA-wm7h-9275-46v2](https://github.com/advisories/GHSA-wm7h-9275-46v2), [minimatch glob amplification GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), and fast-xml-parser [prototype pollution GHSA-x3cc-x39p-42qx](https://github.com/advisories/GHSA-x3cc-x39p-42qx) and [XMLBuilder injection GHSA-gh4j-gqv2-49f6](https://github.com/advisories/GHSA-gh4j-gqv2-49f6).

| Package and locked version | Severity / directness | Production reachability | Fix assessment |
| --- | --- | --- | --- |
| `s3rver` 3.7.1 | High; direct dev | No application runtime dependency or Next trace; used by local test emulator | Latest inspected 3.7.1 still depends on affected busboy and XML parser. npm suggests 2.2.9, a major downgrade, not a proven compatible or safer replacement. Unresolved. |
| `busboy` 0.3.1 | High; transitive via s3rver | Local test emulator, not production runtime | 1.6.0 avoids old dicer but is a major/API change; s3rver uses `new Busboy(...)`, so an override is not shown compatible. Unresolved. |
| `dicer` 0.3.0 | High; transitive via busboy | Local test emulator, not production runtime | Advisory covers `<=0.3.1`; latest inspected 0.3.1 is also affected. No patched dicer version identified. Replace the dependency path only after separate review. |
| `fast-xml-parser` 3.21.1 | Moderate; transitive via s3rver | Local test emulator, not production runtime | 4.1.2 fixes the older pollution advisory; 5.7.0+ addresses both reported advisories. S3rver uses v3 `j2xParser`, so a v5 override is a breaking API change. Unresolved. |
| `minimatch` 10.2.6 | Moderate; transitive via typescript-estree | Lint/development tooling, not production runtime | 11.0.1 is the first patch outside the reported range, a major change outside `^10.2.2`; not safely compatible without upstream changes. Other minimatch versions in the tree are separate instances. Unresolved. |
| `@typescript-eslint/typescript-estree` 8.72.1 | Moderate; transitive | Lint/development tooling | Inherits affected minimatch 10.x. Latest inspected 8.72.1 still declares `^10.2.2`; no fixed compatible published version identified. |
| `@typescript-eslint/parser` 8.72.1 | Moderate; transitive | Lint/development tooling | Inherited typescript-estree/minimatch path; no independently patched compatible release identified. |
| `@typescript-eslint/type-utils` 8.72.1 | Moderate; transitive | Lint/development tooling | Inherited typescript-estree/utils path; no independently patched compatible release identified. |
| `@typescript-eslint/utils` 8.72.1 | Moderate; transitive | Lint/development tooling | Inherited typescript-estree/minimatch path; no independently patched compatible release identified. |
| `@typescript-eslint/eslint-plugin` 8.72.1 | Moderate; transitive | Lint/development tooling | Inherits parser/type-utils/utils paths; no independently patched compatible release identified. |
| `typescript-eslint` 8.72.1 | Moderate; transitive via eslint-config-next | Lint/development tooling | Inherits the packages above; latest inspected remains 8.72.1. A minimatch 11 override is unverified and outside declared range. |
| `eslint-config-next` 16.4.5 | Moderate; direct dev | Lint/development tooling | Inherited typescript-eslint path. npm suggests 15.5.29, a major downgrade relative to Next 16; not applied. |

The dev tools can run during development or CI/build and remain relevant there. `s3rver` is absent from `npm ls --omit=dev` and all current Next `.nft.json` traces. However, the app's `@aws-sdk/client-s3`, `sharp`, and `pdf-lib` remain production dependencies; AWS SDK files appear in four server trace manifests, and local-only storage code remains bundled even though routes fail closed. This is a graph/trace review, not a proof of every deployment artifact.

## Security review and hardening

### Better Auth sessions and recovery

Local Better Auth uses database-backed sessions, disables cookie cache, requires email verification, checks origin/CSRF, hashes verification identifiers, expires recovery tokens after 15 minutes, and revokes sessions on reset. The actual local handler and browser tests cover expiry, reset-token replay and concurrent consumption, stale sessions, logout, cross-origin requests and normal-session misuse. No production mail, real browser cookie deployment, rate limiting, phishing resistance or externally hosted identity provider was tested. The separate Supabase fallback recovery-marker issue remains unresolved; this phase did not modify it.

**Changed:** idle `pg.Pool` errors now emit fixed generic messages instead of allowing unhandled error/client objects to be dumped. Initialization/session failures are sanitized before reaching framework request logs; the workspace API returns a generic 503 when session lookup errors. Local browser tests terminate idle test connections and revoke synthetic session-table access, then verify reconnection/error handling and that the synthetic lab secret and cookies are absent from captured server logs. These tests do not cover every infrastructure, proxy or database logging path; real monitoring should redact secrets independently. Generic error messages also sacrifice detailed diagnostics by design.

### PostgreSQL runtime role and actor context

The local `paidflow_runtime` role is neither owner, superuser nor BYPASSRLS; the wrapper checks role drift and ownership, obtains a transaction-scoped actor with `set_config(..., true)`, and discards unsafe connections. Step 2A and integration tests cover membership authorization, pooled reuse after commit/rollback and stale context. Security-definer functions use pinned search paths and explicit grants/revokes. A compromised runtime credential or arbitrary SQL execution can set the actor GUC and impersonate users: this remains a trusted-server boundary, **not** an unforgeable database identity. Real Neon privilege/role configuration and PgBouncer behavior were not tested.

### Payment proof and document lifecycle

The Step 2D.1 trigger checks proof tenant, invoice/context, area and verified status while locking the document inside the payment transaction. Deletion and revocation lock the same row; tests force both lock orderings and confirm failed operations leave balances, payments and audits unchanged. Historical payments and replay remain intact; deletion/revocation is blocked once linked to payment or extraction history. No live scanner or authorized invoice-association UI/API exists, so the positive verified-proof case uses a privileged synthetic fixture. No payment or migration behavior was changed in Step 2E. PostgreSQL and object storage remain separate systems; owner/admin/migrator compromise is outside this protection.

### Upload and malware scanning

The 5 MiB bound, actual signature/MIME matching, image decode, conservative PDF active-content deny-list, hash checking, and download reinspection remain. Files are `structurally_valid_unscanned`, not malware-clean. **There is no malware scanner, sanitizer, isolated parser worker or trusted scanner attestation.** The PDF deny-list is incomplete against parser differentials, polyglots and unrecognized active content. Lab-authorized downloads of unscanned synthetic files remain possible. Do not use real or untrusted documents.

**Changed:** the loopback emulator guard now allows only server-shaped UUID object paths and tenant-prefixed V2 listing; it rejects bucket mutation, multipart and subresources, unscoped listing, missing/chunked PUT lengths and oversized PUTs. A first local regression revealed that the SDK lists a bucket with a trailing slash; the guard was corrected and the complete suite subsequently passed. These restrictions reduce accessible emulator operations but do **not** patch the npm vulnerabilities, validate SigV4 or make the emulator safe for untrusted traffic. The random guard token and private local directory are still required.

### Lab isolation, secrets, and audit leakage

The production Next config refuses startup if local-lab environment variables are present; lab pages/APIs return 404 in clean production mode. Code uses loopback-only database/storage endpoint checks and a private, owner-only local inbox. Development Host checks are spoofable and are **not a firewall**. The standard dev server and browser test runner bind `0.0.0.0` in this environment; do not expose the lab through a network, preview, or tunnel. Infrastructure can inject or observe environment variables before application startup, and externally configured logs are not controlled by this app.

No S3/R2 presigned or public document URL generator is implemented in the lab. Download grants are short-lived, sent in a header, tied to a session/document and reauthorized, not placed in a signed URL. Existing browser checks assert that test recovery-link tokens and a download grant do not appear in captured Next logs; a new synthetic test verifies that tested DB audit metadata excludes filenames, object paths, invitation hashes/email, payment notes/reference, session cookies, download grants and URLs. This is targeted evidence only. Actual audits still contain tenant/user identifiers and financial amounts and require access control, minimization, retention and operator-log policy. Document downloads and denied attempts are **not audited**; there is no complete security/access audit trail. Reverse proxies, storage providers, DB logging and future features could still leak sensitive data or bearer URLs and require separate review.

## Exact files changed in this phase

1. `storage-lab/emulator.mjs` — narrow local emulator methods, paths, queries and PUT size handling.
2. `src/lib/better-auth-lab/server.ts` — generic idle-pool diagnostics, sanitized initialization/session errors.
3. `src/lib/storage-lab/server.ts` — sanitized local storage initialization errors.
4. `src/app/api/better-auth-lab/workspace/route.ts` — generic 503 on session lookup error.
5. `src/app/better-auth-lab/[screen]/page.tsx` — use sanitized session lookup.
6. `src/app/better-auth-lab/documents/page.tsx` — use sanitized session lookup.
7. `tests/better-auth-lab/browser-local.mjs` — idle-disconnect, session failure, reconnection and log-redaction checks.
8. `tests/storage-lab/run-local.mjs` — emulator operation/size restrictions.
9. `tests/integration/run-local.mjs` — audit metadata leakage checks using synthetic sentinels.
10. `docs/dependency-security-hardening-step-2e.md` — this report.

No dependency manifest/lockfile or existing migration changed in this phase.

## Final regression ledger

| Suite | Final result |
| --- | --- |
| Step 2A local PostgreSQL | 43 passed, 0 failed |
| Step 2B Better Auth handlers | 29 passed, 0 failed |
| Step 2B browser | 9 passed, 0 failed |
| Step 2C storage handlers | 26 passed, 0 failed |
| Step 2C storage browser | 10 passed, 0 failed |
| Step 2D / 2D.1 full integration | 39 passed, 0 failed, including both original failing cases |
| Step 2D.1 historical upgrade | 5 passed, 0 failed |
| Step 2D production boundary | 5 passed, 0 failed |
| Supabase SQL with **mock** Auth | 30 passed, 0 failed, plus transactional SQL suite passed |
| Unit / existing Playwright | 19 / 10 passed, 0 failed |
| Lint / typecheck / production build | Passed |

Local test databases/roles were cleaned, and the disposable PostgreSQL cluster stopped and removed. All counts are synthetic local runs, not real cloud integration or proof of real-world absence of vulnerabilities.

## Production blockers and recommended next phase

The blockers are unchanged: missing malware scanning/attestation and safe quarantine, unresolved dev dependency advisories, no real provider/role/transaction-pool validation, incomplete access/denial auditing and operational secret-redaction policy, legacy Supabase recovery concerns, incomplete customer/invoice/payment/proof-association workflows, untested mail/TLS/rate limiting, and no approved account/data migration or retention design. Do not deploy or process real documents or payments.

Recommended **separately approved** next work: evaluate a maintained local emulator alternative or upstream fixes for the dev dependency tree, and independently design a safe scanner/quarantine and auditable document-access approach. Only after approval should provider compatibility and rollout planning be considered; do not provision services or implement product features in this phase.
