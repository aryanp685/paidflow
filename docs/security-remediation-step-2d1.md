# Step 2D.1 — focused local security remediation

## Decision

**The two reported Step 2D regression cases now pass locally, but PAIDFLOW is not production-ready.** There is no malware scanner, no trusted scan-attestation workflow, no authorized document-to-invoice association workflow, and no production customer/invoice/payment application flow. All validation used synthetic data, disposable local PostgreSQL and the guarded local storage emulator. No Neon, Cloudflare, billing, deployment, Supabase project or production data was accessed.

## 1. Root causes

- **Payment proof:** the existing `record_payment` RPC checked invoice balance and relied on a same-business/same-invoice foreign key, but did not check the document's lifecycle or lock it. A document already deleted or being deleted could still be referenced. The existing deletion check only considered *already-recorded* links and did not serialize against a future payment.
- **Active PDFs:** `pdf-lib` checked whether the file parsed and had pages; it did not reject actions or embedded files. The storage lifecycle called this result `verified` even though no malware scanner had run.

## 2. Files and migrations

- `storage-lab/migrations/20261107030000_proof_lifecycle_and_scan_state.sql` — **new additive local-only migration**: reclassification/audit, lifecycle transition, and payment proof trigger. The six Supabase and all ten prior Step 2A/2B/2C migration files remain byte-for-byte unchanged (16 original files checked by SHA-256).
- `storage-lab/pdf-inspection.mjs` — conservative structural PDF inspection, including parsed compressed object-stream objects and decoded names.
- `storage-lab/core.mjs` — use the inspector, mark successful uploads unscanned, allow authorized local synthetic download with warnings, re-inspect on download, and enforce revoked/inaccessible states.
- `src/components/storage-lab/document-manager.tsx` — visibly says files are **not malware scanned**, and no longer calls structural checks verified. The local lab remains disabled in production.
- `tests/integration/run-local.mjs` — retained both original failing assertions and added lifecycle, lock-order, ledger, PDF and reinspection cases.
- `tests/integration/upgrade-local.mjs` — applies the new migration after a synthetic pre-existing Step 2C payment, compares records/audits, and tests replay, rejection, retention and void.
- `tests/storage-lab/{run-local,browser-local}.mjs` — retained the original storage operations/security assertions while updating expected lifecycle labels. Their financial case uses a **privileged synthetic scanner fixture**, not an actual scanner.
- `tests/neon/run-local.mjs` — handles late idle-pool errors without printing database connection internals during teardown; unexpected errors before teardown still fail the suite. No security assertions were removed.
- `package.json` — adds `test:integration:upgrade`.

## 3. Payment-proof lifecycle and exact financial impact

The RPC signature and JSON result are unchanged. A new database `BEFORE INSERT` / context-changing `UPDATE` trigger locks the referenced document row **inside the payment transaction**. It requires the proof to be in the same business, associated with the same invoice (and the same customer if a customer is set), in the `payment-proofs` area, and in the active `verified` state. A document with an existing `payment_id` must refer to the same payment context. An invalid proof now raises SQLSTATE `23514`; no payment, balance change or payment audit event commits. A payment without a proof remains permitted as `user_recorded`; `proof_attached` still means attachment, not confirmation that payment occurred.

`verified` is reserved for a future *trusted* scanner/attestation design. This lab provides **no runtime transition to verified**, and a runtime principal cannot directly update document metadata. Therefore newly uploaded documents **cannot currently be used as proof for a new payment**. The positive payment tests use a privileged synthetic fixture to simulate a future scanner result and invoice association; this is not scanning or a product workflow. A trusted migration/DB owner can modify any data and remains outside the application threat boundary.

The migration reclassifies previously `verified` Step 2C documents as `structurally_valid_unscanned` and writes a `document.scan_status_reclassified` audit event with a null system actor. Existing payments, balances and existing audit events are not edited. Existing idempotent payment replay remains available even if its old proof is now unscanned; the trigger runs on new insert/context change, not replay. Historical payments can still be voided under the old RPC rules. A new payment cannot reuse that old unscanned proof unless a future approved trusted attestation establishes the required state.

For unlinked documents, an owner/admin may transition to `revoked` (which blocks grants/download/payment and emits `document.revoked`) or `deleting` then `deleted` (with `document.deleted`). Revocation is a DB operation tested here, **not an implemented product UI/API**. Once a document is referenced by any recorded or voided payment or by an extraction, both deletion and revocation are blocked; the object and audit history are retained. A revoked but otherwise unlinked object can be deleted through the existing controlled deletion path. Quarantined uploads can still expire and be abandoned. These decisions avoid rewriting old history; an eventual legally compliant retention/correction policy remains to be designed.

Payment insertion and delete/revoke both take an exclusive lock on the **same document row**. If revocation/deletion wins, payment waits and then fails; if payment wins, deletion/revocation waits, sees the payment, and fails. The integration suite forces and checks both orderings for both transitions on real local PostgreSQL. Existing app/runtime RLS and actor-context boundaries still apply; a compromised privileged DB owner or runtime credential is not contained by this lab.

## 4. PDF inspection and quarantine policy

Upload checks the actual signature and declared MIME against each other, rejects empty files and files over 5 MiB, parses the PDF and limits pages, and inspects **all parsed indirect objects**, including objects from compressed object streams. It rejects `JavaScript` / `JS`, `OpenAction`, additional actions (`AA`), embedded file/file-specification structures, XFA, launch and several external or rich-media actions. Malformed, encrypted/unparseable, excessively complex, or suspicious files are rejected before metadata registration/object upload. This intentionally rejects some benign interactive/attachment-bearing PDFs, too. A valid ordinary PDF or image is stored as `structurally_valid_unscanned`; it is never labelled clean.

The local-only lab permits authenticated, role-authorized download of structurally checked **unscanned synthetic** files, with a prominent UI warning. Images are separately re-encoded for preview; PDFs are not previewed inline. Every download rechecks the hash and runs structural inspection again, so an old stored active PDF detected by this inspector is not served. These controls do not make an unscanned file safe to open. **Never use real or untrusted documents in this local lab.**

This is a conservative deny-list using a general-purpose PDF parser, not exhaustive active-content detection, a malware scan, a sandbox, or sanitization. It does not rewrite or independently validate a sanitized PDF. Polyglots, parser differentials, novel features, compressed-data bombs and malware without these markers remain possible; the in-process parser is not resource-isolated. Production needs a separately verified scanning/quarantine service, controlled promotion/attestation, resource limits and an explicit policy for failures and unsafe downloads.

## 5. Before/after test results

| Suite | Before Step 2D.1 | After |
| --- | --- | --- |
| Full integration | 22 passed, **2 failed** | **38 passed, 0 failed**; original deleted-proof and JavaScript-PDF tests remain and pass |
| Pre-existing Step 2C data upgrade | Not run | 5 passed, 0 failed |
| Step 2A local database | 43 passed | 43 passed, 0 failed |
| Step 2B Better Auth server / browser | 29 / 7 passed | 29 / 7 passed, 0 failed |
| Step 2C storage server / browser | 25 / 10 passed | 25 / 10 passed, 0 failed, with new unscanned semantics |
| Unit / existing Playwright | 19 / 10 passed | 19 / 10 passed, 0 failed |
| Production boundary | 5 passed | 5 passed, 0 failed |
| Lint, typecheck, production build | Passed | Passed |

Coverage includes active scanner-fixture proof, deleted, revoked, quarantine, legacy/unscanned, cross-tenant, wrong invoice/area/payment context, replay, historical void, no partial ledger/audit changes, and both race orderings for revoke and delete. PDF cases include ordinary unscanned, JavaScript, non-JavaScript OpenAction, additional actions, attached synthetic executable, malformed bytes, spoofed MIME, oversized file, and an already-stored active PDF on download.

**Test-harness incident:** an initial Step 2A regression completed its assertions but crashed during disposable database teardown; Node printed connection internals including a transient local PostgreSQL cancellation field. This was not a password or cloud credential. The affected local connection/cluster was stopped and removed, leftover local DB/roles were cleaned, and the runner now avoids dumping connection internals on late teardown errors. The final Step 2A run completed and cleaned up successfully.

To reproduce, initialize a fresh disposable local PostgreSQL cluster and run the local scripts from the existing documentation. For the new checks:

```sh
export PAIDFLOW_INTEGRATION_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55436/postgres'
export BETTER_AUTH_TELEMETRY_DISABLED=1
npm run test:integration:upgrade
npm run test:integration:local
```

Runners create/drop test databases and cluster-wide test roles; refuse existing test roles; and require a genuinely local, dedicated cluster, not a tunnel. Never point them at an existing server. An interrupted runner may require cleanup of only its own temporary resources.

## 6. Dependency advisory status

Fresh `npm audit`: **9 moderate, 3 high package entries**; `npm audit --omit=dev`: **0**. This is unchanged from Step 2D and is not proof of security. No dependency versions were changed or forced. The individual affected packages, direct/transitive paths, patched versions and compatibility risks remain in [Step 2D's dependency table](full-stack-security-validation.md#c-dependency-audit-local-npm-registry-metadata). `s3rver` is dev-only and absent from production Next traces, but its parser advisories still apply while running the local emulator. The AWS SDK remains present in production server traces.

## 7. Remaining risks and production readiness

- No integrated malware scanner, trustworthy scanner identity/attestation, automatic quarantine processing, parser isolation, malware-safe download workflow or real-file validation; PDF deny-list coverage is incomplete.
- No authorized UI/API to associate a proof with an invoice and no production customer/invoice/payment workflows. A `verified` proof exists only as a privileged synthetic fixture in tests.
- No real Neon roles/PgBouncer, R2 signing/IAM/retention, provider failure, production email, real Supabase Auth/PostgREST or deployed-browser testing. Supabase fallback recovery-marker caveat remains unresolved.
- Existing runtime credentials/GUC assume a trusted server; a DB owner can bypass application controls. Real retention/legal correction and safe handling of existing linked unsafe objects need design. Database/object storage are not one atomic system.
- The full npm audit is not clean, and the emulator is not suitable for untrusted traffic. Existing production-boundary scans are focused checks, not exhaustive secret-leak proofs.

**Do not deploy or use real documents or money flows.** Stop here; any further provider integration, production remediation, scanner selection or product feature work requires separate approval.
