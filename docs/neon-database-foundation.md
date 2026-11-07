# Step 2A — Neon-targeted PostgreSQL foundation (local only)

> Historical Step 2A report: a separate, opt-in Better Auth local lab has since been added. See [Step 2B local lab](better-auth-local-lab.md); the default app still uses Supabase and nothing has been deployed.

## Status and scope

This is a separate, locally tested PostgreSQL baseline. It has **not** been applied to Neon or connected to the Next.js app, Better Auth, or R2. It is not a production-ready authentication or storage implementation. The six original files in `supabase/migrations/` are preserved unchanged. No cloud database or project was touched.

## Migration mapping

| New migration in `neon/migrations/` | Source / intentional difference |
| --- | --- |
| `20261107000000_identity_context.sql` | New restricted-role preflight, private identity anchor, private actor helper and grants. |
| `20261107000100_initial_schema.sql` | Supabase `001`: all 17 tables/constraints, UUID user FKs to the identity anchor; actor defaults use the local context helper. |
| `20261107000200_multi_tenant_rls.sql` | Supabase `002`: same policy structure, adapted to `paidflow_runtime` and actor helper; definer owner requires RLS-bypass capability. |
| `20261107000300_financial_constraints.sql` | Supabase `003`: same constraints and issue logic. Invoice-item trigger now always requires an actor with an allowed active role, including privileged maintenance writes; it no longer relies on the Supabase role name. |
| `20261107000400_payment_ledger_functions.sql` | Supabase `004`: same locking, idempotency, partial/overpayment checks, void and deferred consistency behavior, with actor substitution. |
| `20261107000500_indexes_and_audit.sql` | Supabase `005`: same FY sequence, membership, invitations, audit and indexes, with actor/role substitution. The legacy `create_business` remains present but runtime execution is revoked by `006`. |
| `20261107000600_auth_onboarding.sql` | Supabase `006`: profile trigger/backfill targets `paidflow_identity.users`; onboarding checks its `email_verified_at`, not `auth.users.email_confirmed_at`. |

The private `paidflow_identity.users` table is a **minimal identity anchor**, not Better Auth's schema, session store, signup, or credential verifier. Its UUID and verified timestamp are only writable by trusted privileged identity provisioning; the restricted runtime cannot read or modify it. Future Better Auth work must design and test a reliable, atomic mapping of the actual verified user to this anchor; merely setting a timestamp is not verification. Identity deletion/cascades, verification changes, and account lifecycle must be reviewed before connecting real users.

## Schema comparison executed locally

The local test runner applies the original migrations to one disposable mock-Auth PostgreSQL database and the new migrations to a second disposable database. PostgreSQL catalog comparisons passed for **17 public tables, 217 columns, 294 table constraints, 50 indexes, 11 non-internal public-table triggers**, including normalized actor defaults and the identity FK schema change. Public RLS policy definitions and target roles matched after normalizing the actor and runtime role names. All 17 public tables have RLS enabled and forced. These counts and comparisons are for PostgreSQL 18.6, not a proof of Neon behavior. Function bodies, grants, private identity-trigger differences and real provider behavior are not claimed to be identical; selected semantics and permissions are tested separately.

The additional private identity anchor, actor helper and PostgreSQL roles are intentionally outside those 17 public tables. The original `auth` schema, Supabase `authenticated`/`anon` roles and `auth.uid()` are not required by the new migration set. No existing audit records or real business data were migrated.

## Security and transaction contract

- `paidflow_runtime` must be a separate restricted login with no superuser, BYPASSRLS, database creation, role creation or replication rights, no privileged-role membership, and no table ownership. The migration preflight rejects unsafe setup. `neon/runtime/with-actor.mjs` also checks the live role/membership/ownership at each transaction.
- The local migration owner is a separate `paidflow_migrator` role with BYPASSRLS; existing SECURITY DEFINER membership helpers require an owner able to bypass forced RLS to avoid recursion. Never use it as the application connection. Actual Neon role provisioning, BYPASSRLS permissions and function ownership are **unverified** and may require a provider-specific design review.
- `withActorTransaction` checks that the pool connection has no leftover session actor, opens a transaction, uses a parameterized `set_config(..., true)`, runs trusted server code and commits or rolls back. It discards connections with unsafe state or failed cleanup. No application route or arbitrary SQL endpoint was added; the current app still uses Supabase.
- **Critical boundary:** the actor GUC is a trusted-server assertion, not a database-authenticated identity. A holder of the runtime DB credential, arbitrary SQL execution, or a compromised server can set a different UUID and impersonate that user. The future server must obtain the ID from a verified session, never from browser input, use parameterized queries, prevent arbitrary SQL, and protect the DB credential. RLS is defense in depth against missing tenant filters, not protection from a compromised trusted server or migration owner.
- Runtime SQL checks the actor's active membership and role; an input business ID is only a selector. Composite FKs independently enforce tenant relationships. Financial definer functions lock active membership for their transaction. Direct RLS statements use normal PostgreSQL snapshot semantics, so already-running statements are not guaranteed to stop immediately on suspension.
- Local pool tests reuse a `pg.Pool` client across commits/rollbacks and reject a deliberately contaminated session. They do **not** test Neon PgBouncer, serverless driver behavior, real network interruption, or a deployed server. Only the wrapper should execute application queries; do not set the actor at session scope.
- Audit is append-only to ordinary runtime roles but not tamper-proof against a database administrator. `document.registered` records metadata only and does not prove an upload or download occurred. R2 policy and audit work is out of scope.

## Reproducing local tests

Use a **new, throwaway local PostgreSQL cluster**, not a shared development cluster, remote database or tunnel. The runner needs a local administrator able to create databases and roles. It creates cluster-wide `paidflow_runtime`, `paidflow_migrator`, `anon` and `authenticated` roles; it refuses to run if any already exist. It creates two uniquely named disposable databases and attempts to drop them and its roles on completion. An interrupted process can leave artifacts; inspect and remove only artifacts belonging to the throwaway cluster. A loopback URL alone does not prove it is not forwarded to a remote database.

```sh
# Use a disposable cluster you started locally; never forward this port to a cloud DB.
PAIDFLOW_NEON_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55434/postgres' \
  npm run test:neon:local
```

In this session PostgreSQL 18.6 returned **43 passed, 0 failed** using synthetic data, including tenant and role isolation, composite FKs, concurrent invoice numbering, partial payments, duplicate keys, concurrent overpayment prevention, void history, audit, transaction rollback, onboarding and reused-pool context. Local tests do not verify Better Auth email/session behavior, Neon integration, R2, real external credentials or authenticated frontend journeys. The original Supabase runtime and recovery behavior are unchanged.
