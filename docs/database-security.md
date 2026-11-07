# Database security and RBAC

## Trust boundary

Every tenant-owned row is scoped by `business_id`; authenticated calls must present a Supabase-verified session. Policies use `auth.uid()`, not a supplied user ID. Client-supplied business IDs are selectors only, rechecked against active membership on every policy/RPC. Composite FKs prevent cross-workspace links even if a caller guesses valid IDs. Database authorization is necessary but not sufficient: the eventual server must also validate sessions, input, rate limits and safe storage paths.

`ENABLE` and `FORCE ROW LEVEL SECURITY` are enabled on all 17 tables. The migration aborts unless its function owner has `BYPASSRLS` or superuser privilege: helpers must bypass membership RLS to avoid recursive policy evaluation. Security-definer helpers and RPCs have a fixed `pg_catalog, pg_temp` search path and schema-qualified objects. Helpers test only `auth.uid()`'s active membership, not arbitrary users. Helper execution is revoked from PUBLIC/anon; only read-policy helpers are granted to authenticated. Privileged RPC execution is restricted to authenticated and checks actual roles internally. Trigger/internal lock functions are not callable by ordinary users. The owner and service role can bypass RLS: never put service credentials in clients and never treat FORCE RLS as a boundary against privileged database roles.

## Permission matrix (implemented surface in this migration)

| Operation | Owner | Admin | Manager | Accountant | Viewer |
|---|---|---|---|---|---|
| Read own business and business records | Yes | Yes | Yes | Yes | Yes |
| Change workspace settings/preferences | Yes | Yes | No | No | No |
| Create draft customers/invoices; edit draft lines; issue | Yes | Yes | Yes | No | No |
| Record payment | Yes | Yes | Yes | Yes | No |
| Void payment (reason required) | Yes | Yes | No | No | No |
| Reminders/commitments, reminder logs, document metadata | Yes | Yes | Yes | Read | Read |
| Invite | non-owner roles | manager/accountant/viewer | No | No | No |
| Modify existing member | non-owner, not self | manager/accountant/viewer, not self | No | No | No |
| Read audit events | Yes | Yes | Yes | Yes | Yes |
| Write audit, ledger or billing directly | No | No | No | No | No |

`create_business` bootstraps the first owner and default records atomically. No one can directly insert/update/delete membership rows. `set_member_access` locks the business, rereads the active actor, prevents self-modification or owner promotion/demotion and restricts admin scope. Ownership transfer, removal, invitation acceptance/email delivery, last-owner recovery and member provisioning are **not implemented**. Invitation creation stores only a supplied hash; a future trusted server must generate high-entropy secrets, validate email ownership, rate-limit, deliver the invitation, and implement single-use acceptance. Ordinary users cannot select token hashes. No hard deletes are granted for financial records; only draft line deletion is permitted.

Privileged payment, issue, sequence and invitation RPCs acquire a shared lock on the active membership for the transaction, serializing with a role/status update. RLS for direct statements evaluates active membership under PostgreSQL statement/snapshot semantics; it is not an instant revocation mechanism for already-running transactions. Use short transactions and test real session revocation in the eventual application.

## Documents and data access

A document row is metadata, not an object or proof of upload. No Storage bucket, storage RLS, malware scanning, private URLs, download authorization, signed URL expiration, or object-path normalization are implemented. Until those are built and tested, **do not upload real documents or claim private storage**. The prefix check is defense-in-depth and alone is not storage authorization. `proof_attached` does not verify a payment or demonstrate a real file exists. The demo and database tests do not test object downloads.

Security-definer functions return tenant-authorized rows. Private helpers cannot be used to probe other users' memberships. `profiles` are self-only; members can see other members' membership rows but not their private profiles. Invitation hash is hidden using column grants; clients must explicitly select permitted columns, not `SELECT *`. Direct writes to document extractions are intentionally unavailable until human confirmation is designed. Activity logs cannot be inserted/updated/deleted by normal roles; privileged DB roles can still alter them, so external immutable logging is future work.

## Operational prerequisites and residual risks

- This foundation is not production-approved. Run actual Supabase role, Auth, PostgREST, Storage and concurrency integration tests before connecting real data.
- Supabase's default `service_role`/migration owner bypass RLS. Use least privilege and do not expose these roles; privileged direct SQL can bypass application permission checks. Deferred ledger checks catch ordinary inconsistent ledger changes but cannot constrain a superuser who disables triggers.
- Limit API invocation and body sizes, add rate limiting, review invitation abuse, secret lifecycle, PII retention, data deletion, backups, monitoring and incident response before launch.
- RPCs serialize membership changes with protected writes; direct RLS operations use normal MVCC snapshots. Test long-running/revoked sessions and deadlocks.
- `email`, addresses, phone and reminder messages are personal/business data; don't copy them into logs. Audit metadata is deliberately narrow.
- Financial values exposed in JSON are limited to JS-safe integer paise; clients should still use integer/string/decimal-safe arithmetic and not assume `numeric` quantities or future values can be safely processed with floating point.

## Step 1C amendment

Migration `20261107000600_auth_onboarding.sql` revokes authenticated execution of the earlier minimal `create_business` function. Initial workspaces must use the confirmed-user, idempotent `onboard_business` RPC, which also sets the default business. Profile creation is automatic on `auth.users` insertion; `set_default_business` checks active membership. See `auth-onboarding.md` for the remaining real-Supabase tests.
