# Steps 5–8 — progress and safety gates

## Current branch, not deployed

Work is in progress on the session branch; no merge, cloud configuration or deployment was performed as part of this change. No real customer files or credentials were used, and no hosted database migrations or payment contracts were changed. The storage-lab hold from steps 1–4 remains in effect: no new grants, downloads or previews are possible.

## 5. Scanner and quarantine — separately approved, blocked by pilot gate

The user separately approved obtaining ClamAV and official signatures for a disposable offline pilot, conditional on the isolation and artifact checks. Those checks cannot yet be completed here. No scanner, definitions or Garage binary has been installed or run. A real scanner and trustworthy definition freshness cannot be inferred from structural validation. Do not replace the download hold with a fake or fixture verdict. The existing state called `quarantine` is an upload-interruption state; it is not a complete isolated malware-quarantine pipeline. Build a byte-bound attestation, separate quarantine and restricted promotion only after the prerequisites in [the pilot plan](network-isolated-storage-scanning-plan-step-2g.md) are met. Malware non-detection is not proof of safety.

## 6. Document audit — local denials expanded, still incomplete

Authenticated and anonymous core denials now cover upload, delete, grant, download, preview, list and cleanup; selected origin and pre-delegation request-validation denials are also recorded. Restricted DB events contain no target, file content, credential or request metadata, and failure to write does not authorize a denied operation. Origin attempts are anonymous; expired, missing and fabricated sessions are deliberately indistinguishable. Existing successful registration, structural upload and delete events remain in tenant `activity_logs`. The runtime cannot read or modify private denial history; no tenant/document attribution or audit reader is provided for denials.

Scan started/passed/failed and successful download events are **not implemented**: no trusted scanner exists, and successful downloads are blocked by the hold. Other operational and production gaps remain. See [the detailed audit/auth report](steps-5-8-audit-auth-report.md) for coverage, limitations, trust model and testing; do not apply the lab migration to production.

## 7. Garage local pilot — stopped before launch

This environment has no Garage or no-NIC virtual machine/hypervisor available, and the separately reviewed offline artifacts are absent. A Linux namespace/chroot based unit-test sandbox shares the host kernel and runtime and is not the no-NIC VM specified by the pilot plan. Do not start Garage or replace the current emulator until the complete VM, artifact provenance, isolated listener, egress, IPC and credential gates are independently verified. This is a blocked pilot, not a failed Garage compatibility result.

## 8. Auth and recovery — interim mitigation

The older Supabase `paidflow_recovery` cookie asserted recovery on a URL parameter, without provider-authenticated recovery type or session binding. This branch disables the forgot/reset UI and server reset action, rejects callbacks explicitly marked `flow=recovery` without exchanging codes, and clears the legacy marker on those callbacks. A valid ordinary verification callback remains supported and clears the marker. Callback responses send `no-store`, `no-referrer` and `noindex` headers. In the workspace guard, a session error always blocks access, even if a user object is present. Missing/unconfirmed users and an empty active membership list remain denied.

The `flow` label is caller-controlled: a recovery code presented without that label may still be exchanged as an ordinary login session because callback purpose is not independently verified. This mitigation blocks the application password-update action; it does not distinguish every provider recovery code from a signup code.

This is an availability-impacting **temporary block**, not a working password reset, not a real Supabase integration test, and not a statement that all session revocation/suspension paths are fixed. A verified recovery solution must prove purpose and session binding, prevent replay and cross-session substitution, handle expiry and revocation, and test actual Supabase Auth/PKCE and its provider configuration in an isolated local stack. Better Auth's separate lab was not modified here. No credentials or hosted Supabase project were used.

## Verification so far

- Offline, network-isolated synthetic checks: **13 storage-hold checks, 8 structural/security probes and 35 unit tests passed**. The auth tests use mocks and cover recovery callback/action denial, callback headers, inconsistent session-error/user responses, missing/unconfirmed sessions and filtering to active memberships; they do not prove real Supabase behavior. The first run failed because Vitest could not resolve Next's `server-only` marker; the test-only resolver was corrected and final runs passed.
- Production build passed inside a network namespace with only loopback enabled, with a sanitized environment. Final lint and typecheck passed; the local production-boundary checks passed **5/5** in a network namespace with loopback enabled.
- In a disposable **namespace/chroot**, synthetic loopback-only PostgreSQL and S3 emulator suites completed with clean teardown: Neon **43/43**, storage **32/32**, Better Auth **29/29**, integration **39/39**, upgrade **6/6**, mock Supabase PostgreSQL **30/30**. The runner is `scripts/isolated-database-tests.sh`; it requires separately staged PostgreSQL binaries under `/tmp` and locked Node dependencies, and does not fetch or verify them. This run used `@embedded-postgres/linux-x64@18.6.0-beta.19`, whose npm tarball was checked against SHA-512 `53bb2a36c23633938f002967a6d4f4e5b1929e8b382044a051eb0dcadc2f81743d2f818a6359a725c89769be82135a569b729eb38fd4aec65524964a04c1596f`; its native symlinks were rehydrated with path confinement. This integrity check is not independent publisher-signature or scanner-artifact verification.
- The DB-test namespace shares the host kernel and read-only runtime/dependencies; it is suitable only for benign synthetic tests, **not** the no-NIC VM required for scanner or Garage pilots. The jail had no external route, host home/run sockets, Git or inherited credentials, and test processes had no effective capabilities. PostgreSQL and the emulator stopped and the disposable jail was removed.
- An earlier integration run printed 39 passing assertions but failed in teardown when forced database deletion terminated an idle auth connection. The runner now closes pools and uses ordinary `DROP DATABASE`, failing rather than forcibly disconnecting remaining clients; the four suites subsequently completed cleanly. This does not establish that every possible teardown timing is covered.
- Real Supabase Auth and Chromium integration/browser tests were not run; historical reports describe previous environments and cannot verify these changes.
