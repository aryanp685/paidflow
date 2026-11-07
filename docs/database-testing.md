# Local database testing

## What was actually executed

Five migrations were applied in order to disposable PostgreSQL 18.6 databases locally, using PostgreSQL roles and a small `auth.uid()`/`auth.users` mock. `npm run test:database -- --standalone` executed 27 positive/negative checks, including A–J, tenant FKs, manager suspension, owner bootstrap, payment retry/void/proof/overpayment, line GST validation, deferred ledger drift, parallel counter allocation, concurrent payments and membership-suspension locking, and repeated opt-in demo seed. `supabase-rls.sql` was also executed against the mock. The database is dropped after the runner. These tests exercise PostgreSQL RLS but **do not verify actual Supabase Auth, PostgREST, Storage, or their runtime roles**. Supabase CLI/Docker were not available in the environment used for Step 1B.

## Standalone PostgreSQL (mock Auth)

Use a disposable **local** PostgreSQL instance and a local administrator able to create/drop databases and roles. The test runner rejects non-loopback URLs, creates a uniquely named `paidflow_test_*` database, bootstraps mock auth in that database, applies migrations, runs tests, then drops the database. `anon` and `authenticated` are cluster-wide roles and are created if absent; use a throwaway cluster. Loopback alone cannot prove a connection is not tunneled to a remote server—never point this runner at a tunnel or real database.

```sh
npm ci
export PAIDFLOW_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/postgres'
npm run test:database -- --standalone
```

`tests/database/bootstrap-standalone.sql` is a test shim, **not a Supabase migration**. PostgreSQL client and server must support the migration syntax (Supabase target is PG 17; the standalone run here used PG 18). If the process is killed before cleanup, manually remove only the corresponding disposable `paidflow_test_*` database.

## Actual local Supabase (still required)

Install Docker and a compatible Supabase CLI; ensure the CLI is not linked to a remote project and check `supabase/config.toml` before running. These commands start/reset **local** containers only; `db reset` destroys local database data. Do not use `db push`, project linking, or a remote connection.

```sh
npx supabase start
npx supabase db reset --local
# Read the LOCAL database connection from `npx supabase status`; do not use a cloud URL.
# Replace the example port/credentials only with values printed by local status.
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1 -f tests/database/supabase-rls.sql
```

The SQL suite creates fictional fixtures, impersonates authenticated/anon using `SET LOCAL ROLE` and claims, and rolls back. It tests database policies with the real local Supabase `auth.uid()` implementation, but not API/JWT verification or Storage. If it fails, the connection ends with an aborted transaction; fix the cause before proceeding. Then add end-to-end tests through local Auth/PostgREST using real sessions and implement and test Storage policies/downloads. Repeat concurrency tests on the actual target PG version and simulate suspension while requests are in flight. Review grants/default privileges in the actual Supabase runtime, backups, and RLS with the exact deployment role. Do not mark Supabase isolation or document downloads verified until those tests succeed.

## Demo seed (never production)

`supabase/config.toml` disables automatic seeding. `supabase/seed.sql` uses fictional IDs, names and `example.invalid` email, is repeatable for its known rows and refuses to run without an explicit session flag. On a disposable **local** database only, after migrations:

```sql
BEGIN;
SET LOCAL paidflow.allow_demo_seed = 'local-only';
-- psql only:
\i supabase/seed.sql
COMMIT;
```

The flag is an accidental-execution guard, not proof of local identity; it cannot make seeding a remote database safe. Never enable seed in production, run this in a cloud SQL editor, or include it in a production deployment. The demo invoice remains a draft. To remove it, reset the disposable local database.

## Step 1C test run

The sixth migration and onboarding tests were run on standalone PostgreSQL with the same mock auth shim: 30 checks passed, including concurrent duplicate submissions, verified-email gating, profile creation, unauthorized default selection and injected rollback. This is still **not** real Supabase Auth or PostgREST verification. See `auth-onboarding.md` for the unexecuted integration matrix.
