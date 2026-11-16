# Customer reader/writer and privilege compatibility

**FAIL: proposals are not backward compatible; rollout is NOT APPROVED.** Inventory is limited to repository and synthetic roles, not unknown integrations. Matrix uses 002 baseline plus 010 and final local 012–015. Role authorization still applies within each allowed path.

| Reader/writer | Before | After candidate | Classification / evidence |
|---|---|---|---|
| Authenticated member tenant SELECT customer, invoice/payment history and activity | RLS SELECT | Same column grants/RLS; added edit_version | **PASS synthetic**; `002` tenant_read; customer detail page and DB cross-tenant checks; provider integration **NOT TESTED**. |
| New create app `customers/actions.ts` -> `create_customer_once` | Requires 010 RPC | Signature retained; 015 stronger validation | **PASS synthetic valid payload/key**, **FAIL compatibility** legacy GSTIN/UI replay; DB GST tests and `src/lib/validation/customer.ts`. |
| Old `create_customer_once` RPC client | Present after 010 | Same signature, replay checked before stricter GSTIN rule | **PASS synthetic replay**, **FAIL** new nonstandard GSTIN/state, unknown old clients **NOT TESTED**. |
| New versioned edit app | Function absent before 012 | owner/admin/manager, tenant-scoped CAS on six fields | **PASS synthetic** in DB and unit mocks; **BLOCKED** real app-to-PostgREST/browser. |
| Legacy authenticated direct INSERT | Granted with 002 role/creator RLS | Revoked by 013 | **FAIL**; `legacy customer grants...`, `shared contact...` test direct 42501. |
| Legacy authenticated direct UPDATE | Column grants and role RLS | Revoked by 012 | **FAIL**, including archive, terms, notes, WhatsApp, credit limit and addresses, for which no equivalent RPC exists. DB `new version migration...`, `customer version RPC...`. |
| Authenticated accountant/viewer or other tenant | Tenant read subject to membership, no customer manager write | Same write denial via RPC authorization/grants | **PASS synthetic**; DB role/cross-tenant tests. |
| Privileged importer/service/owner direct DML | Can bypass RLS/grants depending role | UPDATE increments version & audits, but no expected-version CAS; INSERT bypasses RPC/idempotency/GST validation; owner may disable trigger | **FAIL** universal CAS; actual service roles/integrations **NOT TESTED**. DB `customer version RPC...`, audit privileged update tests. |
| Audit owner/administrator | Potentially privileged | Can alter/delete history or disable triggers | **NOT TESTED** operational immutability, backup, retention. Runtime mutations denied in synthetic DB. |

**Evidence:** `tests/database/run-tests.mjs` tests baseline/final grant transition and authorization. It does not launch legacy applications or every real role. `src/app/(workspace)/workspace/customers/actions.ts` and customer pages are new repository paths; untracked external importers/jobs/mobile/SQL clients are **NOT TESTED**.

## Required staged design (recommendation, not instructions to deploy)

1. Inventory all direct/privileged clients and fields/versions, access roles and real grants, ledger/legacy GSTIN data and duplicate populations with privacy-preserving review. Decide supported archive and other missing field APIs, null actor attribution, GSTIN policy and audit retention. Establish backup, restore exercise, migration owner/grants and production lock budget.
2. Design a truly compatible expand phase: additive version/audit, stable old signatures and reviewed version-aware equivalents for **all** fields; instrument unknown legacy calls. Feature-gate capable clients until database support exists. A bridge that leaves direct updates enabled cannot guarantee CAS; call that phase insecure/limited, not accepted.
3. In a separately authorized environment prove old and new clients against each migration step, provider roles, audit failure, concurrency and data-preserving upgrade/rollback. Coordinate all clients, privileged writer decommission and atomic or controlled cutover with maintenance window if necessary. Only revoke when compatibility is explicitly retired and verified. Never broaden privileges merely to pass tests.
4. Rollback decision must account for versioned clients, existing audit and request keys. Freeze writes, route clients to a verified compatible release, preserve customer/invoice/payment/audit/ledger data, and restore schema/function/grants only through a reviewed tested rollback. Restoring direct UPDATE sacrifices CAS; dropping version/audit loses guarantees. Exact rollback SQL **NOT TESTED** and is deliberately not supplied as safe.
