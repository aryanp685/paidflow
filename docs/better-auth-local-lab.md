# Step 2B — Better Auth local lab

## Scope

This is an **opt-in, local-only experiment**, not a production migration or a replacement for Supabase. `/better-auth-lab/*` and `/api/better-auth-lab/*` are disabled unless explicitly enabled and are always disabled when `NODE_ENV=production`. They are intentionally not available via the Arena preview host. The existing Supabase routes, cookies, and migrations remain unchanged; the existing Supabase recovery-marker weakness also remains unchanged. Do not use its recovery flow for real users until separately fixed and tested. No Neon, R2, cloud project, external mail service, or remote migration was used.

The lab uses Better Auth **1.7.18**, a local PostgreSQL pool and a separate restricted runtime pool. `better-auth-lab/migrations/20261107010000_better_auth.sql` was generated from that version's migration planner on an empty disposable local database with UUID IDs. `20261107010100_identity_mapping.sql` adds the reviewed mapping and grants; neither changes the seven Step 2A or six Supabase migration files. These SQL files are a local test baseline, not an upgrade plan for an existing populated database.

## Identity and authorization

* Better Auth `public."user".id` is a UUID. A security-definer trigger creates exactly one `paidflow_identity.users` anchor with that same UUID on user creation and synchronizes its verification timestamp when Better Auth changes `emailVerified`. An FK from the anchor to the Better Auth user enforces the direction; profile and business-membership FKs reference the anchor. This is an explicit database-enforced equality mapping, not an assumption that unrelated provider IDs coincide. The tests exercise each FK, verification removal, and cross-tenant denial. Existing anchors cannot be silently linked: adding the FK fails unless every existing anchor already has a matching Better Auth user, and creation fails on collision.
* The auth service role can access Better Auth's four tables, but not the private identity anchor or tenant tables. The restricted application runtime cannot access Better Auth session/credential tables. The trigger runs with migration-owner privileges and has a fixed search path. The auth service is nevertheless a **trusted** component: anyone able to use its DB credential can alter auth users and verification; never expose that credential. Review grants, default privileges, role membership and ownership again before any deployment.
* Account deletion is deliberately blocked by the anchor FK, because retention/deletion of financial history is not designed. No migration or mapping of existing Supabase users or business data is implemented. Email change, deletion, account linking, abuse controls, and account lifecycle require further design and tests.
* `withVerifiedBusiness` reads the real server-side session and verified status, uses the UUID guaranteed by the mapping, sets a transaction-local actor through the existing wrapper, and queries the current active membership and role. A caller's business UUID is only a selector. Onboarding is the special pre-membership operation: it requires a verified session and delegates to the existing atomic onboarding function. The workspace GET and onboarding POST use parameterized SQL and never accept a user ID; the POST additionally requires the configured Origin and JSON. Already-running database statements have normal PostgreSQL snapshot semantics.
* RLS is defense in depth, **not protection from a compromised application, auth service, migrator, or runtime DB credential**. The runtime GUC is a trusted-server assertion and is forgeable by someone with arbitrary SQL or that DB credential. No arbitrary-SQL endpoint is exposed. Actual Neon ownership, BYPASSRLS support, PgBouncer and connection pooling have not been verified.

## Sessions and recovery

Email verification is required before login; signup and verification do not automatically sign in. Sessions are database-backed with cookie cache disabled; each protected call obtains the current session and user from Better Auth. Sessions expire, are refreshed by Better Auth, and are invalidated at logout. The lab's local HTTP cookies and settings are **not production cookie/TLS configuration**.

The separate Better Auth reset flow uses Better Auth's cryptographically generated token, a 15-minute expiry and hashed stored verification identifiers. With the PostgreSQL pool adapter's transaction support, token consumption, session revocation and the password update run in one transaction. The local suite injects a database failure to verify rollback, and runs two simultaneous reset requests to verify one success and one rejection; it also verifies expiry, replay, session revocation and that a recovery token alone cannot open a workspace. A normal password change uses Better Auth's current-password check. It does not use the legacy `paidflow_recovery` cookie.

Lab verification/reset links necessarily contain sensitive tokens. The Next.js lab routes send no-referrer/no-store headers, remove the token from the reset page URL after loading, and omit lab requests from Next dev request logs. Better Auth unexpected errors are returned without printing raw exception details. These measures are not a guarantee that a browser, extension, network proxy, or other environment will not log URLs. Never share or screenshot links. The optional local email adapter writes owner-only files in a private directory outside the repo, never to an HTTP inbox or application logs; these files contain sensitive one-time links and **must be removed when finished**. Only synthetic data belongs in the lab. Production mail, deliverability, rate limiting/abuse protection, TLS, and operational logging still need a separate design and approval.

## Automated reproduction

Start a **fresh throwaway local PostgreSQL cluster**, not a shared or remote DB and not a tunnel. Both runners need an administrative local URL, create disposable databases and cluster-wide roles, refuse to run if any test roles already exist, and attempt cleanup on exit. A process interruption can leave artifacts; inspect/remove only artifacts belonging to that disposable cluster. A loopback URL does not prove it isn't a remote tunnel.

```sh
# Example only: use the port of your own disposable local cluster.
export PAIDFLOW_BA_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55435/postgres'
export BETTER_AUTH_TELEMETRY_DISABLED=1
npm run test:better-auth:local
# This starts and stops an isolated local Next dev server on port 3000.
# Set CHROMIUM_PATH if Chromium is not installed at /tmp/chromium.
npm run test:better-auth:browser
```

The browser test creates a private temporary inbox, uses dynamically generated synthetic passwords and secret, runs the UI, then removes the inbox and test DB. It needs a compatible Chromium and its OS libraries. Do not run it against a dev server containing real data. Browser test details are suppressed on failure because they could contain a token-bearing URL.

### Optional manual lab setup

Only on a fresh disposable cluster, create `paidflow_runtime` and `paidflow_auth_service` as restricted LOGIN roles without superuser, BYPASSRLS, database/role creation or replication; create a separate NOLOGIN `paidflow_migrator` with BYPASSRLS. Create a new empty DB owned by that migrator. As the migration owner apply, in filename order, all seven `neon/migrations/*.sql`, then both `better-auth-lab/migrations/*.sql`. The local test runners demonstrate the exact setup and cleanup. Do not reuse this procedure on a populated database.

For the isolated dev process, set `PAIDFLOW_BA_LAB_ENABLED=1`, `PAIDFLOW_BA_LAB_ORIGIN` to exactly `http://localhost:3000` or `http://127.0.0.1:3000`, and provide `PAIDFLOW_BA_LAB_AUTH_DB_URL` and `PAIDFLOW_BA_LAB_RUNTIME_DB_URL` using their respective role names and loopback DB host (without URL query options). Set a fresh random `PAIDFLOW_BA_LAB_SECRET` of at least 32 characters and `PAIDFLOW_BA_LAB_INBOX_DIR` to an existing owner-only directory outside the repository. Keep all values private. Start Next **bound to loopback**, e.g. `npx next dev --hostname 127.0.0.1 --port 3000`, then open the configured local origin at `/better-auth-lab/signup`. The hostname check is only an additional guard and is spoofable; it is not a substitute for loopback binding or a firewall. Never expose the lab through an Internet-facing preview, reverse proxy, or tunnel. Stop the server and remove the temporary inbox and disposable cluster after use.

## Executed locally in this session

* PostgreSQL 18.6 + actual Better Auth HTTP handlers: **29 passed, 0 failed** using two synthetic users and two businesses. Coverage includes role-inheritance preflight, identity FKs, roles, suspension, session refresh/expiry/logout, origin/CSRF, reset expiry, rollback, concurrent consume/replay, revocation, normal change, and reused connection context.
* Next dev + local Chromium + PostgreSQL: **7 passed, 0 failed**. Exercises responsive signup, verification, login, protected route, workspace onboarding/authorization, CSRF, reset, revocation and logout. The browser test used a private temporary inbox and removed it after completion. This is not a deployed-browser or Neon/PgBouncer test.
* Dependency installation reported **8 moderate npm audit advisories**. They remain unresolved; do not describe the dependency audit as clean.
