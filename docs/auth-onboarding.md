# Authentication and onboarding — Step 1C

> **Current branch security hold:** Supabase password recovery is temporarily disabled, including direct reset actions and recovery callbacks. The former recovery marker was not reliable proof of a recovery flow. This is a fail-closed mitigation, not a functional recovery fix; do not enable recovery until it is validated against real isolated Supabase Auth. See [steps 5–8 progress](steps-5-8-progress.md). The remainder is historical where it describes the earlier recovery behavior.

## Status and safety

The app uses real `@supabase/ssr` browser and cookie-based server clients, Next.js 16 `proxy.ts` for session refresh, server-side `auth.getUser()` verification, and RLS-scoped database calls. There is no service-role client or mock login. No Supabase project is connected. **Do not deploy or use real business data yet:** actual local Supabase Auth, PostgREST, email, proxy/session refresh, and the migrations together remain unverified in this environment.

Docker and Podman were unavailable here; the Supabase CLI was later run via npm, but could not start a local stack. A real Supabase Auth release binary was investigated, but GitHub release assets could not be downloaded because the redirected host is unavailable in this sandbox. Standalone PostgreSQL with a mock `auth.uid()` is useful for SQL testing, but does not constitute a real Supabase Auth integration test.

## Configuration (only after approving an isolated project)

1. Copy `.env.example` to `.env.local` and set **only** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (preferred) or `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legacy anon JWT), and `NEXT_PUBLIC_SITE_URL` to the exact trusted app origin. Never add a service-role or secret key to a public variable. An entirely unconfigured environment disables the forms and protected routes fail closed. Partial or invalid public configuration causes Next.js startup/build to fail without printing its values. The publishable variable takes precedence; every configured key is checked, and an invalid publishable key is not silently replaced by the anon key. Never place private credentials in a `NEXT_PUBLIC_*` variable: those values are included in client bundles. All `.env*` files except the placeholder example are ignored by Git. `NEXT_PUBLIC_*` values are build-time variables, so rebuild after changing them.
2. Start an isolated local Supabase stack and apply all migrations as described in `database-testing.md`. Do not connect to existing cloud projects or run remote migrations without separate approval.
3. Enable email confirmations in Supabase Auth, configure a reliable sender and add the exact `/auth/callback` URLs (including both `flow=verify` and `flow=recovery`) to the Auth redirect allow-list. The included local configuration requests confirmations and local redirect patterns, but has not been tested with the CLI here. The callback only redirects to a fixed internal destination and uses the configured site origin, never an arbitrary `next` parameter.
4. PKCE verification/reset links should be opened in the same browser/device that initiated the request, so the verifier is present. Explain expired/cross-device links to users. Review provider password and rate-limit settings before launch.
5. Generate full database types from the verified local Supabase schema; `database.types.ts` currently describes only the hand-maintained Step 1C surface.

## Transaction and access

Migration `20261107000600_auth_onboarding.sql` adds profile creation from `auth.users`, a default-business membership FK, optional business district/Udyam fields, and `onboard_business`. It revokes authenticated access to the older minimal `create_business` RPC. The new RPC requires an email-confirmed authenticated user, validates inputs, takes a per-user transaction lock, creates the business, owner membership, free plan, preferences, default business and audit event in one transaction. Its client-generated idempotency key is stored for a retry in session storage; the database rejects different details with the same key. The initial onboarding flow permits only one active initial workspace, preventing different-key double submissions; a separate, explicit multi-business creation flow is future work. Existing members can switch among active businesses with `set_default_business`; the server rechecks membership and does not trust the submitted ID.

A GSTIN is optional during onboarding; a registered business without one cannot issue a GST invoice. GSTIN and Udyam checks are format checks, not official verification. The app cannot issue invoices in this step.

`requireUser` validates the session with the Auth server and requires a confirmed email. Workspace loading uses RLS-scoped active memberships and only chooses an accessible business. A stale/suspended default is ignored. A user without an active membership is routed to onboarding; suspension never grants access to the old workspace. SQL tests exercise authorization using a mock auth schema, not real JWT validation. Email confirmation policies must remain enabled for meaningful verification.

## Required verification before considering Step 1C complete

- Run `supabase db reset --local` and `tests/database/supabase-rls.sql` against real local Supabase; verify the profile trigger and onboarding RPC under real roles.
- Exercise signup, confirmation email/link, login, invalid credentials, logout, refresh/expiry, password reset, bad and cross-device links using local Auth and the local mail inbox. Test callback allow-list and trusted origin behavior with the actual preview/production domain.
- Run authenticated Playwright journeys for initial onboarding, membership/defaults, competing submissions, error rollback, mobile and desktop workspace navigation. Test switching between two real businesses, another tenant and suspended membership, and compare server guards to RLS.
- Review authentication throttling, email delivery, cookie/security settings, session revocation, incident response and backups before production. The public publishable key is not authorization; database RLS remains mandatory.

## Step 1D infrastructure check

Supabase CLI 3.0.0 was run via npm, but `supabase start` could not start: neither Docker nor Podman nor a container socket was available. The GitHub Auth release redirected to `release-assets.githubusercontent.com`, which this sandbox cannot access. The `@supabase/lite` package is an alternative implementation, not real Supabase Auth/PostgREST, and was not used as a substitute. No cloud project was modified. Actual Supabase and Storage verification, full type generation, and authenticated UI testing remain blocked.

## Recovery flow review item

The current callback sets a short-lived recovery marker when `flow=recovery` is supplied and a code exchange succeeds. The marker itself does not prove the exchanged code was issued for recovery or bind itself to a specific session. The reset action still calls `getUser()` and updates that authenticated account, but the recovery-only guarantee must be reviewed against real Supabase Auth behavior and tested before launch. No exploitation claim or fix is asserted here.
