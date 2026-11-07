# Steps 1–4: checkpoint, design, offline isolation and download hold

## Checkpoint and scope

An initial local checkpoint was made during the prior session; its commit object was not retained when the workspace was restored. The recovered files are committed again on the session branch for publication; GitHub history is the source of truth for the resulting commit. The design proposal is [premium-ui-direction.md](premium-ui-direction.md), not a redesigned site. No Garage, scanner, cloud resource, production credentials or real customer files were used. Existing package manifests and SQL migrations were unchanged.

## Current storage-lab hold

The **local Better Auth/storage lab** now refuses every grant and every download or preview, regardless of document state. Legacy `verified` is not trusted scan evidence. Even a valid previously issued, session-bound grant cannot get document bytes, and denial never invokes the download `store.get`. Authentication, token validation for direct requests and database read authorization remain in place. The UI explains the hold and removes preview/download actions; permitted deletion remains, subject to existing ledger/proof retention constraints. Uploads still do structural inspection and read-back; they are not malware scans.

This is an interim restriction, not scanning, quarantine integration, a proof that a file is safe, or a safeguard added to the separate Supabase implementation. It does not revoke copies already downloaded, nor prevent a person with access to the emulator data directory, emulator guard token, or other privileged infrastructure from reading files outside the application API. Releasing the hold requires separately approved, independently tested malware scanning and trustworthy attestation linked to the exact object bytes, plus a new review of access and lifecycle behavior; a scan non-detection is not proof of safety.

## Offline runner

On a Linux host with unprivileged user, mount, network, IPC and PID namespaces enabled, `scripts/isolated-offline-tests.sh` stages tracked source and tests plus the new hold-test and UI-test files in a disposable directory. It creates a private network namespace (loopback remains down), private mount/IPC/PID namespaces, chroots into the staged root, mounts only the host system runtime and current project's installed dependencies read-only, supplies a temporary writable `/tmp`, starts with a cleared environment, and drops namespace capabilities. It runs synthetic offline tests; no database, browser, server or scanner is started. It exits on setup/probe failure rather than falling back to host networking. The runner removes the staged workspace on exit. Restore locked dependencies separately with `npm ci --ignore-scripts` before using it; this restore requires registry access and happens **outside** the offline sandbox.

In this Linux sandbox the probe found no route to `1.1.1.1` (`ENETUNREACH`), no host home or `/run/user` paths, no repository `.git`, and no inherited test credential environment. The hold tests passed **12/12**, and unit tests **20/20**. Vitest warned that the read-only dependency cache could not be written and continued without caching. The first isolated unit run failed because the staging list omitted `vitest.config.mts`; a second failed because Vite's default config loader wanted to write inside read-only dependencies. The corrected runner stages the config and uses Vite's runner loader; the final run passed.

This is a constrained local test environment, **not a hardened hostile-code or malware sandbox**: it shares the host kernel and exposes the host `/usr`, `/lib`, `/lib64` and current `node_modules` read-only. Do not put credentials in those paths. It does not establish macOS support or isolate PostgreSQL/Chromium/server workflows. For those, use a separately verified offline VM and dedicated disposable services; do not run the old browser runners on a public or shared host. If namespace setup/probes fail, stop instead of bypassing isolation.

## Verification and outstanding work

- Locked dependencies restored with lifecycle scripts disabled; `sharp` loaded and processed synthetic files in the tests. The installed files are generated and not committed.
- Fresh lint and TypeScript checks passed. The offline tests use stubbed DB authorization and do not prove actual PostgreSQL RLS or HTTP behavior.
- Storage/database integration and browser test expectations were updated, including test-only reconstruction of old grants, but those suites **were not run** in this environment: PostgreSQL and Chromium were not available. They need an appropriately isolated disposable PostgreSQL/loopback environment before relying on them. Existing historical reports record earlier versions and are not evidence for this change.
- A production-boundary test was attempted without an existing production build: its environment rejection check passed, then its server exited because the build was absent. The suite did **not** pass and has not been rerun. No production server was left running.
- No new migrations, payment RPC/ledger changes, production deployment or security certification. Do not use this local lab for real files.
