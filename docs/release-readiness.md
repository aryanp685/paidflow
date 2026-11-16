# Release readiness

**BLOCKED — not approved for production, migration, merge or launch.** Updated 2026-11-06. Local branch contains substantial uncommitted/untracked candidates and an incomplete roadmap; previous deployments and PR merges do not establish current release readiness.

| Gate | Status | Evidence / required action |
|---|---|---|
| Baseline local quality | PARTIAL | Unit 123, lint, typecheck and build passed; isolated PostgreSQL suites observed expected results, but proof vulnerabilities make security acceptance FAIL. Offline staging improved after baseline; full details in `docs/roadmap-audit.md` and `docs/implementation-progress.md`. |
| Browser / accessibility / performance | NOT VERIFIED | 10 Playwright tests failed at startup due to missing Chromium; no browser assertions executed. Test full real flows, responsive behavior, keyboard, reduced motion and performance only with safe local setup. |
| Proof | BLOCKED | New attachment, upload, download and preview remain held; trusted scanner/byte binding/provider behavior and direct bypass tests required. Candidate 007 is not deployed. |
| GST / issuance / ledger | BLOCKED | Independent tax and accounting review, implemented rules, immutable history/reconciliation and concurrency/restore tests required; candidate issuance hold 009 is undeployed. |
| Identity / authorization | BLOCKED | Real provider Auth, RLS, PostgREST, session revocation, team legacy RPC bypass, audit and recovery security not verified. |
| Migrations / operations | BLOCKED | No authorized hosted changes. Independently review atomic fail-closed initial ordering and version history, privileged access, restore/rollback and preservation of existing financial records before separately requesting permission. |
| Dependency risk | OPEN | Production audit zero at baseline; full dev audit 4 findings. Assess emulator risk and update/replace safely, then retest. |
| Features / operational claims | INCOMPLETE | OCR only designed; reminders manual with no delivery; team/settings/subscriptions incomplete; no paid services activated. Confirm data retention, user support, consent and translations. |
| Independent acceptance | NOT VERIFIED | Security, financial, accessibility and operational review, real-provider isolated tests and explicit release authorization remain outstanding. |

No scanner/Garage installation, production deployment, hosted DB access, messaging/billing activation, recovery or proof enablement, merge or release occurred in this pass. Do not interpret test exit codes as authority to lift holds.
