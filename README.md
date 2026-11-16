# PAIDFLOW

PAIDFLOW is a planned India-first receivables workspace. The checkout contains a marketing preview and unapproved local candidates for authentication, customer, invoice, payment, reminder, analytics and team workflows. Marketing figures are illustrative; workspace pages can display tenant records when configured and must not be treated as demo-only. The repository is **not approved for release**: Supabase Auth + Database is the selected target, but provider/source-of-truth verification is pending, Item 13 is not accepted, Item 14 is on hold and proof security has known failures. See [the execution checklist](docs/ROADMAP_EXECUTION_THROUGH_28.md), [security gaps](docs/security-gaps.md) and [release readiness](docs/release-readiness.md).

## Local development

Requires Node.js 22.17+ (the Next.js version in the lockfile requires a recent Node release).

```sh
npm ci
npm run dev
```

Open http://localhost:3000. No environment variables or cloud services are required to run the marketing site.

## Verification

[Step 2D.1’s local security remediation report](docs/security-remediation-step-2d1.md) documents the fixed regression cases, unscanned document policy and remaining production blockers. This is not production-ready.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium # browser and operating-system libraries required
npm run test:e2e               # serves the production build on port 3000
```

The default Playwright suite can reuse an existing server on port 3000; use only an isolated synthetic environment and inspect its configuration first. Authenticated customer browser verification additionally requires the pinned Playwright Chromium revision and an isolated fixture; see [browser prerequisites](docs/item-13.5-browser-prerequisites.md). Local business-module candidates and Supabase-based auth/onboarding exist, but their presence does not establish real-provider verification or deployment.

## Structure

- `src/app/` — App Router, metadata, global CSS, and marketing route.
- `src/styles/tokens.css` — theme tokens.
- `src/components/ui/` — reusable shadcn-style Radix UI primitives.
- `src/components/marketing/` — page sections and interactive preview.
- `src/components/shared/` — future product interface foundations.
- `supabase/migrations/` — local schema, RLS and transactional functions, including unapproved customer proposals 012–016. Local files do not establish hosted migration state.
- `docs/database-architecture.md`, `docs/database-security.md`, `docs/database-testing.md` — design and verification guidance.
- `tests/unit/`, `tests/e2e/` and `tests/database/` — unit, browser and database checks.

## Availability and security

Signup and login routes use the existing Supabase path when explicitly configured; contact details, privacy policy and terms are not published. No fake authentication is provided. Security copy describes design intentions only. No deployment or provider configuration is authorized by this README.

## Database foundation

Current hosted database state has not been inspected in this pass. See [database testing](docs/database-testing.md) for the disposable local PostgreSQL test runner, local Supabase instructions and explicit limitations. Demo seeding is disabled by default. Never use real customer data in the synthetic test runners.

## Auth and onboarding

See [authentication and onboarding](docs/auth-onboarding.md) for public-only environment configuration, local setup and outstanding real-provider tests. Historical cloud activity does not establish current provider configuration.
