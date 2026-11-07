# PAIDFLOW

PAIDFLOW is a planned India-first receivables workspace. This repository currently contains **Steps 1A–1C in progress**: a marketing preview, frontend components, local-only database migrations and a Supabase Auth/onboarding implementation awaiting real local Supabase integration testing. All financial figures and activities displayed are illustrative, not business records. Features, prices, and security controls described on the page are planned, not yet operational.

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

The Playwright suite uses an existing server on port 3000 if one is already running. To use a separately installed Chromium binary, set `CHROMIUM_PATH` before running it. The marketing page is statically rendered. Auth and onboarding use Supabase when configured, but are disabled without configuration and remain unverified against real Supabase. Business modules are not implemented.

## Structure

- `src/app/` — App Router, metadata, global CSS, and marketing route.
- `src/styles/tokens.css` — theme tokens.
- `src/components/ui/` — reusable shadcn-style Radix UI primitives.
- `src/components/marketing/` — page sections and interactive preview.
- `src/components/shared/` — future product interface foundations.
- `supabase/migrations/` — local-only PostgreSQL schema, RLS and transactional functions.
- `docs/database-architecture.md`, `docs/database-security.md`, `docs/database-testing.md` — design and verification guidance.
- `tests/unit/`, `tests/e2e/` and `tests/database/` — unit, browser and database checks.

## Availability and security

Signup and login routes require an explicitly configured Supabase environment; contact details, privacy policy and terms are not published. No fake authentication is provided. Security copy describes design intentions only. No deployment or Supabase resources are configured in this step.

## Database foundation

No cloud database is connected. See [database testing](docs/database-testing.md) for the disposable local PostgreSQL test runner, local Supabase instructions and explicit limitations. Demo seeding is disabled by default.

## Auth and onboarding

See [authentication and onboarding](docs/auth-onboarding.md) for public-only environment configuration, local setup and outstanding real-Supabase tests. No cloud project has been configured.
