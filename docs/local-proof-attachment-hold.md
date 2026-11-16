# Candidate Supabase proof-attachment deny migration

## Scope and current status

Prepared `supabase/migrations/20261107000700_deny_payment_proof_attachment.sql` and tested it **only in disposable local PostgreSQL**. It is applied by the mock-Supabase test runner *after* the unmodified baseline migrations and vulnerability demonstrations, and tested separately on a fresh database. It has **not** been deployed; neither the app nor any hosted database is protected by it yet. No existing financial migration or RPC, hosted resource, scanner, download/preview, recovery or deployment was changed. Do not apply this migration to production without separate approval and preflight review. Do not disable existing holds.

## Candidate behavior

- A BEFORE INSERT/UPDATE trigger denies **every new non-null proof** (SQLSTATE `23514`), regardless of whether a future scanner might deem it clean. It does not validate objects, signatures or actual malware state.
- It also denies changes/removal of a historical proof's identity, tenant, invoice or customer and changing a no-proof row to a proof-bearing row. Context-unchanged updates—including void—remain possible. It does not attempt to make all financial fields immutable; existing financial constraints and permissions remain as before.
- The migration leaves existing rows and RPCs intact. An identical historical `record_payment` retry returns the existing row before any insert; a changed retry is rejected by the existing RPC. No-proof payments continue. The result `proof_attached` on a historical payment does not mean the object was scanned or is safe to access.
- The migration uses ordinary PostgreSQL trigger enforcement, not protection against a superuser/table owner disabling it, replication-trigger bypass, other unreviewed privileges, direct storage access or schema drift. Only explicitly limited mock roles were tested. Revoking direct execution of the trigger function is not by itself a security boundary; it runs as a trigger.

## Local test evidence

Executed `PAIDFLOW_TEST_PG_DIR=... ./scripts/isolated-database-tests.sh` using a hash-checked staged PostgreSQL in a disposable namespace/chroot and synthetic fixtures. The final run exited 0, stopped the server, confirmed no listeners and removed the jail. It used no hosted data. The database harness produced **41 ordinary mock-Supabase checks passed and four known-gap demonstrations**, plus the SQL RLS suite. All ten candidate hold checks passed:

1. Historical payment, invoice and audit unchanged after applying the candidate migration.
2. Owner, manager and accountant cannot submit metadata-only proof through direct SQL invocation of the existing security-definer payment RPC; ledger/audit unchanged.
3. Missing, cross-tenant, wrong-invoice, already-linked and legacy proof IDs all denied with ledger/audit unchanged.
4. Normal privileged insert is denied, as are proof reassignment, removal and customer context changes; authenticated direct payment update is denied by existing grants.
5. Identical historical proof payment replay returns the existing payment, changed retry fails and no ledger/audit changes occur.
6. Historical proof-bearing payment can be voided and void replayed; proof reference retained.
7. Two simultaneous no-proof retries produce one payment and one payment audit event; changed retry fails.
8. Simultaneous proof retries are denied without ledger/audit changes.
9. A fresh disposable database applies all migrations, passes the mock RLS suite, blocks proof-bearing payment and allows a no-proof payment.
10. Trigger is enabled in the test DB, authenticated cannot execute its function directly or disable it, and original RPC grant remains.

The mock baseline before applying the candidate migration still accepted unscanned metadata for a manager and accountant, reused a document linked to another payment, and accepted a `payment_receipt` metadata row without a scan. These four outputs are marked **VULNERABILITY DEMONSTRATED**, not passing security acceptance. The other lab suites completed: Neon 44 ordinary checks and one known gap; storage 40; Better Auth 29; integration 39; upgrade 9. Local test process success means the synthetic expected outcomes were observed, not that production is secure.

## Next gate

A production migration rollout, real Supabase/Auth/PostgREST/Storage role and compatibility verification, scanner attestation pipeline, immutable storage semantics and security review remain unimplemented and require the applicable separate approvals. Do not assume the mock `auth.uid()` or direct SQL invocation proves real Supabase HTTP behavior. If approved, inventory actual grants and deployed schema before designing a rollout; keep proof attachment, download and preview blocked until the production guard and all required controls are verified. See `step-13-security-architecture.md` for threat model, limitations, migration ordering and rollback requirements.

## Supabase target selection — additional synthetic regression

The user subsequently selected Supabase Auth + Supabase Database as the intended target; this is not permission to deploy or lift any hold. An added synthetic regression verifies that candidate hold 007 rejects unscanned same-invoice `payment_receipt` metadata for owner, manager and accountant with unchanged ledger/audit. The latest isolated mock-Supabase suite reports 96 ordinary checks, zero test errors and four base proof vulnerabilities deliberately demonstrated: **SECURITY FAIL**. The deny-all candidate is not deployed, a scanner, an independent security approval or a real-provider test. See `IMPLEMENTATION_PROGRESS.md` for commands and restrictions.

## Continued local candidate — reverse association

The same undeployed candidate 007 now also guards the independent `documents.payment_id` path. New non-null reverse links are refused, as are changing an old linked document's identity, tenant, customer, invoice or payment, unlinking it, or deleting it. No historical row is rewritten; a pre-existing reverse association survived local migration and void. Synthetic direct-role, privileged write, cross-tenant and fresh-install tests passed; full latest mock-Supabase run: 98 ordinary checks, zero test errors, four demonstrated base security failures. The accountant and cross-tenant linked-insert error is the generic BEFORE-trigger hold error, not proof of RLS evaluation. Regular unlinked documents remain possible. No hosted migration or access occurred.

This is a **deny-all hold proposal**, not a scan or complete document lifecycle. It does not protect object reads or physical storage, prevent invoice-only implicit association, freeze other linked-document metadata, or stop privileged trigger disabling. Current base authenticated roles cannot update/delete documents, but privileged writers can alter metadata. Existing links can still point at unsafe, absent or replaced objects. Compatibility, historic retention, privacy/legal deletion obligations and any scanner/byte-binding design require independent review. Keep every existing hold in place and do not assume hosted protection.

## Step 10 remediation batch — supersedes earlier candidate limitations

The local 007 candidate now freezes **all document row fields**, not only relationship fields, when an existing payment references the document through `payments.proof_document_id` or the document references a payment through `documents.payment_id`. Both kinds reject ordinary privileged reassignment, storage path/file-name edits and deletion; unchanged historical rows, payment references, invoice balances and audit entries were checked in the synthetic suite. It blocks new reverse and forward links, leaving unrelated invoice-only document registration available. No real objects, scanner state or object-store operations are protected. This supersedes earlier statements above that linked metadata is not frozen by the candidate. Owners/superusers can disable triggers or use replication mode; direct storage mutation and historical object bytes remain outside scope.

The linked-payment lookup is `SECURITY DEFINER` with `pg_catalog, pg_temp` search path and schema-qualified `public.payments`; synthetic checks confirm function ownership, trigger status and runtime execute revocation. Owner privileges and RLS semantics must be independently assessed in the actual target. A partial index on `(business_id, proof_document_id)` avoids an unconditional payment-ledger scan; its ordinary non-concurrent creation can take locks, so production-size performance, locking, exact migration ordering, rollback, compatibility, retention and privacy/legal deletion must be reviewed separately. No migration has been applied to a hosted database.

The four previously demonstrated base attacks were separately replayed and separately denied by the local hold; their **overall status remains FAIL**, not a security PASS. The additional mock matrix covers owner, admin, manager, accountant, viewer, anonymous, another tenant, missing document, wrong invoice, concurrent different-key attempts, and ordinary privileged writes. The storage-lab role matrix denies proof download/preview without reading bytes for owner/admin/manager/accountant/viewer/anonymous, but this is a distinct lab and not Supabase Storage. See `security-gaps.md` and `IMPLEMENTATION_PROGRESS.md` for the per-attack matrix and exact evidence.
