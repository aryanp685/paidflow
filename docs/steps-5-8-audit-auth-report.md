# Document audit and authentication verification report

> **Historical snapshot:** PR #2 was subsequently merged and its production deployment promoted. The temporary application recovery block is now deployed; it does not resolve the provider-purpose gap. See `supabase-recovery-verification.md` for current work.

**Scope:** local branch only, 8 November 2026. No merge, deployment, hosted database operation or cloud resource creation. No Garage or ClamAV installed. Storage grant/download/preview hold is unchanged. This is **not completion of all requested events** and is not a production-readiness or no-bugs claim.

## Audit inventory

| Event | Current local-lab implementation and evidence |
| --- | --- |
| Upload registered / structurally accepted | Existing tenant `activity_logs`, written in document registration / transition DB transactions. Structural inspection is **not** a malware scan. |
| Upload denied | Separate restricted denial row for authenticated or unauthenticated core attempts; API origin, pre-delegation authorization, filename/size/body rejection paths covered. |
| Delete completed / denied | Existing transactional `document.deleted` on completion; separate restricted denial row on core denial or API origin rejection. Storage/DB deletion is not atomic; failed deletions remain `deleting` and can be retried. |
| Grant, download, preview denied | Restricted row after hold, invalid grant, authorization failure, or failed/missing session. No bytes or grants returned. List and cleanup core denials are also recorded. |
| Anonymous / expired sessions | Records `actor_user_id = NULL` and `unauthenticated`; Better Auth's null session result cannot safely tell a missing session from an expired or fabricated one. Authentication provider exceptions are `auth_unavailable`, also anonymous. |
| Origin / request validation | Origin rejections for upload, grant, delete and cleanup are intentionally anonymous even if a cookie accompanies the request: attacker-controlled origins must not be attributed to the cookie owner. Upload pre-delegation validation and cleanup request validation are recorded; valid sessions are attributed, otherwise authentication denial is recorded. |
| Scan started, passed, failed | **Not implemented or emitted.** There is no scanner, trusted scanner identity, scan job, verdict or attestation; inventing events would be misleading. They must be transactionally bound to the future real scan workflow. |
| Successful download | **Not implemented or emitted.** The hold prevents successful downloads. Before lifting it, implement durable authorization/delivery events, audit-failure behavior and byte-level delivery semantics; do not fabricate success. |

The private denial table records only generated id, DB timestamp, actor UUID or NULL, bounded operation and bounded reason. No target tenant/document ID, filenames, objects, URLs, cookies, tokens, request payloads or file bytes are accepted. Therefore it deliberately **cannot** answer which document or tenant was targeted. There is no tenant-scoped denial-event reader; runtime cannot read *any* of these records, which prevents cross-tenant access but is not a usable tenant audit UI. Existing success `activity_logs` are tenant-scoped separately. New denials are in a separate transaction after the rejected operation's rollback. Audit outages keep denied operations denied; they cannot make the unavailable audit record durable. API origin failures still return a generic denial even if writing the event fails.

The runtime role has no SELECT/INSERT/UPDATE/DELETE/TRUNCATE on the private table; narrow security-definer functions accept only fixed enums, not actor/target/metadata. The trusted server's verified-session actor GUC is not independent authentication: compromise of that DB role/server can forge actor events, and owner/admin can alter history. The anonymous writer always records NULL regardless of actor GUC. This is runtime append-only, not immutable or tamper-evident. The authenticated reason `access` is deliberately broad and may include authorization, hold or backend failure; it is not proof of a specific cause.

**Remaining audit gaps:** scan and successful delivery events; a safe tenant-aware authorized reader and target attribution after authorization; all errors before a lab is initialized or before a route reaches auditing (including exceptional framework/parameter failures); durable outage/backpressure/alerting and rate limiting for anonymous event floods; retention and stronger tamper evidence; production/Supabase audit path; real end-to-end API/browser/log leakage tests. Authorization can change after a session check; denial rows record the session actor verified at attempt start, not proof of current tenant membership. Raw request headers are used only by server-side session lookup and are not passed to the DB writer. Existing infrastructure logs, proxies and hosting logs were not exhaustively audited.

## Authentication security assessment

### Supabase application, current local branch

- The forgot-password form cannot send a reset request; `/auth/reset-password` redirects to unavailable and `resetPassword` always returns an error without calling `updateUser`. A callback explicitly labelled `flow=recovery` is rejected without code exchange and clears the old `paidflow_recovery` marker. The callback sends no-store, no-referrer and noindex headers.
- Password login, signup, signup verification/resend and callbacks not labelled recovery remain available when configured; workspace guard verifies `getUser` and active membership. Logout uses local scope. These are not real-provider integration results.
- `flow` is untrusted input. Callback accepts an otherwise successful code exchange without independently checking provider-authenticated purpose. A recovery code with the label removed or changed **may** be exchanged as an ordinary login if its PKCE verifier is available. The installed Supabase auth SDK derives `redirectType` from locally stored PKCE verifier metadata (`GoTrueClient._exchangeCodeForSession`), so treating this value alone as independently provider-attested purpose is insufficient. PKCE binds an exchange to its verifier, but this application has not proved a one-time purpose-and-session-bound recovery authorization, concurrent-flow isolation, replay resistance or logout/revocation for recovery.
- Disabling this app's action does **not** revoke existing provider recovery links/sessions or disable provider APIs/configuration; a client holding a valid provider session may interact directly with provider APIs subject to provider policy. The production deployment has not received even the local mitigation, and its legacy marker/action gap remains a blocker.
- Required real, disposable Supabase Auth tests: signup versus recovery code substitution and altered/missing flow label; PKCE verifier ownership, multiple tabs and concurrent sessions; code/link/token replay and expiry; cross-account/session substitution; update-user behavior and provider secure-password-change settings; session creation, refresh, logout and revocation after password change; unverified, suspended and deleted memberships at every protected operation; outages, callback headers and log/URL leakage. Inspect actual provider email templates/redirect allowlist/session policies. Use synthetic identities only and get separate approval before any hosted resources or changes. Local mocks do not establish these facts.

### Better Auth lab, distinct implementation

The isolated lab enables email/password recovery with a 900-second reset-token lifetime, hashed verification identifiers, `revokeSessionsOnPasswordReset: true`, trusted-origin checks and verified email; recovery is available **only in the locally enabled lab**, not the production Supabase app. The reset token is a bearer credential associated with an account, not a pre-existing workspace session. Actual local Better Auth HTTP handlers and PostgreSQL tests covered missing/expired tokens, a recovery token not acting as a workspace session, atomic rollback, concurrent one-use reset, old-session revocation, session expiry and suspended membership. This is not proof about Supabase or hosted deployments; browser tests were not run in this environment.

## Verification in this turn

All database suites ran using synthetic data in a disposable PostgreSQL namespace/chroot with loopback-only listeners and no external route, host home/run sockets, Git, inherited secrets or effective process capabilities. The environment shares the host kernel and read-only runtime/dependencies and is **not** the no-NIC VM required for scanner/Garage. Processes exited and disposable databases/jail were removed; only suites with clean process exit and teardown are counted as passed.

| Suite | Result |
| --- | --- |
| Neon-compatible local database | 43 passed, 0 failed |
| Storage lab + guarded S3 emulator + real local Better Auth | 32 passed, 0 failed |
| Better Auth HTTP + PostgreSQL | 29 passed, 0 failed |
| Integrated local Auth/PostgreSQL/storage | 39 passed, 0 failed |
| Synthetic old-to-new migration upgrade | 6 passed, 0 failed |
| PostgreSQL with mock Supabase auth | 30 passed, 0 failed (not real Supabase Auth) |
| Offline hold synthetic checks | 13 passed |
| Offline structural/security probes | 8 passed (EICAR marker acceptance demonstrates absence of scanning) |
| Unit tests | 35 passed, 0 failed (including six mocked API-route cases) |
| Production-boundary checks | 5 passed, 0 failed |
| ESLint, TypeScript, network-isolated production build, `git diff --check` | Passed |

No Chromium executable was available, so Playwright, Better Auth browser and storage browser suites were **not run**. Real Supabase Auth, external S3/R2 and real scanner integration were not run. `scripts/isolated-database-tests.sh` requires independently staged benign PostgreSQL binaries; it does not verify provenance. This run used the previously documented pinned npm tarball and SHA-512. `scripts/isolated-offline-tests.sh` optionally accepts the exact hash-checked synthetic encrypted PDF fixture documented in `docs/storage-security-evaluation-step-2f.md`.

## Exact changed files on this branch

These are cumulative changes against the branch base, including work from the preceding turn:

- Documentation: `docs/auth-onboarding.md`, `docs/steps-5-8-progress.md`, `docs/steps-5-8-audit-auth-report.md`.
- Runners/config: `scripts/isolated-offline-tests.sh`, `scripts/isolated-database-tests.sh`, `vitest.config.mts`.
- Storage implementation: `storage-lab/core.mjs`, `src/lib/storage-lab/server.ts`, `src/app/api/storage-lab/cleanup/route.ts`, `src/app/api/storage-lab/documents/route.ts`, `src/app/api/storage-lab/documents/[id]/route.ts`.
- Auth implementation: `src/app/auth/callback/route.ts`, `src/app/auth/reset-password/actions.ts`, `src/app/auth/reset-password/page.tsx`, `src/components/auth/auth-form.tsx`, `src/lib/supabase/guard.ts`.
- Tests: `tests/e2e/auth.spec.ts`, `tests/integration/run-local.mjs`, `tests/integration/upgrade-local.mjs`, `tests/storage-lab/download-hold-offline.mjs`, `tests/storage-lab/run-local.mjs`, `tests/storage-lab/security-evaluation-offline.mjs`, `tests/unit/auth-security.test.ts`, `tests/unit/recovery-ui.test.tsx`, `tests/unit/storage-audit-routes.test.ts`.
- **One new local-lab migration:** `storage-lab/migrations/20261107040000_storage_access_denials.sql`. No financial or hosted migrations were changed. Do not apply this local-lab migration to production as-is.

## Production blockers and separate pilot prerequisites

Production blockers include the unresolved provider-verified Supabase recovery design and real-provider tests, unchanged deployed legacy recovery gap, incomplete document event coverage and audit operations/reader/retention controls, and missing trustworthy scan/attestation/quarantine/delivery design. The storage lab is intentionally unavailable in production and its audit is not a production audit. Do not release a download path on the strength of structural checks.

- **Scanner:** user separately approved obtaining ClamAV and official signatures only subject to verified artifacts/freshness and an independently validated disposable no-NIC VM. That VM and verified offline scanner/signature media are absent. No scan was run; keep the hold. Follow the scanner gates in `docs/network-isolated-storage-scanning-plan-step-2g.md`.
- **Garage:** a separate isolated local pilot needs an independently validated no-NIC VM, reviewed pinned offline Garage artifacts/provenance, isolated loopback-only listeners, synthetic credentials/data, and all compatibility/security/cleanup tests before considering replacement. No Garage pilot has been run, and scanner approval is not Garage installation approval.

**Stop here for user review and approval before any next phase.** No deployment or cloud changes are authorized by this report.
