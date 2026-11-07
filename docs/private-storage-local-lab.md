# Step 2C — private document storage, local foundation

> **Current security hold (steps 1–4):** all document grants, downloads and previews are disabled, including legacy `verified` documents and previously issued grants. The remainder of this page is a historical Step 2C record; its download, preview, verified-state and test-result descriptions do not describe the current behavior. See [current scope and verification](steps-1-4-security-and-isolation.md).

> Step 2D identified failures involving deleted payment proofs and active PDF content; both original cases pass after the local [Step 2D.1 remediation](security-remediation-step-2d1.md). No malware scanner exists, and ordinary files remain unscanned. Do not use this lab for real documents or financial workflows. Production refuses startup if local-lab environment variables are set. The description below records the original Step 2C implementation and is superseded where it refers to “verified” upload status.

## Scope and entry points

This is a **local-only lab**, disabled in production and separate from the existing Supabase implementation. No Cloudflare account, R2 bucket, billing, Neon cloud project or remote migration was created or accessed. Only synthetic data belongs in this lab. Existing migration files and the Better Auth core remain intact; the Better Auth lab workspace gets a link to the document page only when storage is explicitly enabled. The page is `/better-auth-lab/documents` and the API is `/api/storage-lab/*`. They require both local labs, the configured local host, and the Better Auth session; they are intentionally unavailable in the public preview.

The emulator uses three separate local S3-compatible buckets: `evidence`, `payment-proofs`, and `ocr-staging`. The application has **no cloud endpoint mode**: `storage-lab/s3.mjs` rejects non-loopback and non-HTTP endpoints. Each server-generated opaque key is `<business UUID>/<random UUID>`, stored in the database, not accepted from the browser or returned in document-list responses. Only the server talks to storage. Documents uploaded through the lab have an existing, committed quarantine record before any object write.

### Important emulator limitations

S3rver 3.7.1 is a test emulator, not an S3/R2 security implementation: its native configuration permits anonymous requests and **does not validate SigV4 signatures**. The test-only wrapper binds to `127.0.0.1`, revokes its built-in dummy account, requires a separate ephemeral secret header before every request, disables multipart POST and unnecessary operations, and stores data under a private owner-only directory outside the repository. Startup also probes the emulator root and rejects a response other than 403; that single probe does not prove every bucket is private. The tests verify that anonymous and forged-header requests to the guarded emulator are denied. These guards are not proof of real bucket privacy; a process with the local guard token or access to the private directory can read the data. Never expose the emulator, use a tunnel, trust a raw S3rver instance, or store real documents here.

The test-only `s3rver` dependency adds known development advisories. Latest local install reported **12 npm advisories: 9 moderate and 3 high**, including `busboy`/`dicer` and `fast-xml-parser`. The emulator guard blocks multipart POST, but these advisories are not considered fixed. Do not deploy the emulator or use it with untrusted traffic. `npm audit --omit=dev` reported zero advisories at the time checked; this is not a general security audit or guarantee.

## Authorization and access

Every list, upload, grant, download, deletion and cleanup resolves a verified Better Auth session on the server. Business IDs and document IDs are only selectors, never authority: the application checks current active membership and role in PostgreSQL, and derives transaction-local actor identity from the session. Document operations resolve storage area/key from the database. SECURITY DEFINER functions lock the document and active membership for mutating/storage operations; the actor GUC remains a trusted-server assertion, not independent authentication. Someone holding DB credentials or able to execute arbitrary server SQL can impersonate users. There is no arbitrary SQL or direct object-key API.

| Area | Read/download | Upload | Delete/cleanup |
| --- | --- | --- | --- |
| evidence | owner, admin, manager, accountant, viewer | owner, admin, manager | owner, admin |
| payment-proofs | owner, admin, manager, accountant | owner, admin, manager | owner, admin |
| ocr-staging | owner, admin, manager | owner, admin, manager | owner, admin |

Suspended membership is denied. Uploads are never public and no public or presigned URL is emitted. Downloads require a **60-second single-document HMAC grant bound to the current session**, sent in a request header, not the URL, followed by a fresh session/membership/document check on the authenticated proxy. Tokens are not logged. Download responses are attachment-only with `nosniff`, CSP sandbox and no-store. PNG/JPEG previews are separately decoded and re-encoded on the server; PDF inline preview is disabled. Browser copies and already-started downloads cannot be recalled, and suspension waits for any in-flight operation holding the membership lock.

Presigned URLs, if ever added for R2, are bearer capabilities that generally cannot be individually revoked before expiry merely by suspending a user. Use short expiry, private buckets and minimal scope, and retain the authenticated proxy for immediate authorization checks. This lab does not issue or test R2 presigned URLs.

## Validation and lifecycle

The upload endpoint checks session/membership before reading the request body, limits actual streamed bytes to **5 MiB**, accepts only PDF, PNG and JPEG, and never trusts the filename or declared Content-Type as proof. It verifies magic bytes, fully decodes images with a 20-million-pixel limit, and structurally parses unencrypted PDFs. Filenames are normalized to a conservative ASCII display name; no filename controls an object path. This is **not malware scanning or proof that a PDF is safe**. Active PDF content and parser vulnerabilities remain risks; downloaded files are attachments, not trusted content.

The server reserves a `quarantine` document record with a 15-minute expiry, writes the object, reads it back, checks length, SHA-256 and structure, and only then transitions to `verified`. An actor/business-scoped idempotency key and matching name, area, MIME, size and content hash make retries and concurrent duplicate submissions converge; reuse with different contents is rejected. The DB transition and successful audit entry are atomic, while S3 and PostgreSQL cannot share a transaction. On an interrupted upload or failed verification, the committed quarantine row remains for retry or cleanup. Deletion first transitions to `deleting`, hiding it from download, then deletes the object and marks it `deleted`; retry or cleanup can finish an interrupted deletion. Cleanup requires an authenticated owner/admin, removes expired quarantine and leftover deleting objects, and reconciles unreferenced opaque keys within that business prefix. It must be invoked explicitly: no scheduled worker is installed.

The pre-existing `document.registered` audit event means only the metadata row was created. `document.uploaded` is recorded only after read-back and the verified DB transition; `document.upload_abandoned` and `document.deleted` record actual completed cleanup/deletion. Audit metadata contains area, MIME and size, not object keys or URLs. The local failure, concurrent retry and delete tests check these distinctions.

## Database changes and financial boundary

Only `storage-lab/migrations/20261107020000_document_storage.sql` is new. It alters the existing `documents` table with area, state, request ID, expiration and update time, adds two indexes, area-specific read policy and narrowly granted state-transition functions. Existing document and extraction tables remain; no public application table is added. Existing documents default to `legacy_unverified` and are not silently treated as stored or safe. Existing direct `paidflow_runtime` document INSERT is intentionally revoked when this local migration is applied; registration now uses the checked function. Existing `document_extractions` rows and financial ledger rows/functions are not rewritten.

The delete transition refuses documents already linked to a payment or extraction. A local post-migration integration test issued a synthetic invoice, recorded/replayed a payment with a linked proof, verified the balance and rejected deletion of the proof. The lab's upload UI does **not** attach files to invoices or payments; the test creates that link as a privileged synthetic fixture. A complete production integration must review concurrency and lifecycle for any privileged process that links documents after deletion, legacy documents, retention, legal holds, and financial/audit requirements. Do not assume this lab migrates real documents or changes ledger semantics safely in a deployed environment.

## Running the isolated tests

Start a **new, throwaway local PostgreSQL cluster**, never a shared cluster, cloud database or forwarded tunnel. The runners require an administrative local URL, create temporary databases and cluster-wide roles, refuse existing test roles, and attempt cleanup. An interrupted run can leave artifacts in that throwaway cluster. Both runners create and remove a private temporary S3 directory and ephemeral test-only credentials; the browser runner additionally starts/stops Next on port 3000 and needs Chromium and its system libraries.

```sh
export PAIDFLOW_STORAGE_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55435/postgres'
export BETTER_AUTH_TELEMETRY_DISABLED=1
npm run test:storage:local
# Set CHROMIUM_PATH as needed.
npm run test:storage:browser
```

For a manual local lab, first follow the disposable Better Auth DB/role setup in [the Step 2B lab](better-auth-local-lab.md), then apply the one Step 2C migration as that same local migration owner. Set `PAIDFLOW_STORAGE_LAB_ENABLED=1` and configure `PAIDFLOW_STORAGE_LAB_ENDPOINT`, `PAIDFLOW_STORAGE_LAB_ACCESS_KEY`, `PAIDFLOW_STORAGE_LAB_SECRET_KEY` and `PAIDFLOW_STORAGE_LAB_EMULATOR_TOKEN` with fresh random local-only values. For the guarded emulator, set `PAIDFLOW_STORAGE_LAB_DIR` to a private owner-only directory outside the repo and `PAIDFLOW_STORAGE_LAB_PORT` to a local test port; run `npm run storage:emulator`, then bind Next to loopback as described in Step 2B. Set the endpoint to the corresponding `http://127.0.0.1:<port>`. Never print credentials or links, never use real R2 credentials, and delete the private inbox, emulator directory and disposable cluster when finished.

## Executed and remaining work

* Actual Better Auth + PostgreSQL 18.6 + guarded S3rver: **25 passed / 0 failed**. Covers two tenants and multiple roles, type/size/signature checks, grant expiry, retry/concurrency, interrupted storage, corruption, cleanup, audit, financial proof retention and session/suspension denial.
* Local Next dev + Chromium + PostgreSQL + guarded emulator: **7 passed / 0 failed**. Covers mobile/desktop UI, synthetic signup/onboarding, drag-and-drop upload, re-encoded image preview, direct HTTP validation and cleanup, authenticated download and deletion.
* No real R2, cloud IAM/bucket policy, S3 SigV4 verification by the emulator, TLS, real presigned URLs, remote concurrency, provider lifecycle policies, real malware scanning or background cleanup has been tested. Real R2 compatibility, quotas, multipart behavior, bucket policy/public-access blocking, encryption, backup/retention, monitoring, dependency security and provider-specific error recovery need explicit design and approval before cloud use.
