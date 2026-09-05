# Run log — 2026-09-05

Chronological record of the autonomous run. One entry per merged lane: what landed, evidence (tests, screenshots, URL), decisions taken, deviations from spec, open issues.

## 06:20 IST — run start
- Grill-me complete; decisions in TODO.md §7 items 17–23. Status board in TODO.md §0.
- Docker engine 29.1.2 started; AWS profile `pranava` verified (account 975050032697); Claude Design project created.

## 06:30 IST — R0 launched
Amarsh switched session model to Sonnet 5, said GO. Launching 4 lanes: 03 (platform/deploy), 01 (identity), 32 (design system), 02+04 (event log + canonical model). Main thread stays on Sonnet 5 for this run (Amarsh switched it himself).

## 06:45 IST — Amarsh signed off
Amarsh going to sleep; a friend will monitor GitHub. Set up `Amarsh` branch (mirrors `main`, pushed at every checkpoint) at commit 024c82c. Continuing R0 autonomously: merging lanes as they land, running R0.5 schema reconciliation, then R1+.

## 08:00 IST — R0 lanes 2, 3, 4 also finished (all four now complete)
- **Live URL:** https://we947t2rq2.ap-south-1.awsapprunner.com — `/health` returns `{"ok":true,"db":true}` against real RDS. Verified by the platform agent via live Playwright: `/` shows real East Crest data, `/home` shows Karthik Iyer real payment plan. Cost estimate from AWS Pricing API: ~$35/mo typical, up to ~$84/mo (₹2,900-6,950) worst case; $60 budget alert set.
- PR #10 (event log + canonical model): reviewed independently by main session — 167 API + 61 workspace + 9 e2e tests all re-run and green, tsc clean both packages, migrations 0002/0003 non-colliding. MERGED to main at 0491af3.
- PR #11 (design system foundation): packages/ui, tokens, fonts, ESLint token rule, axe + font + reduced-motion e2e (15 tests). Not yet reviewed/merged.
- PR #12 (platform/deploy): the live URL above, ports (db/files/mailer/pdf/clock/llm), CI, 117 API tests on PGlite+Docker Postgres+live RDS. Flags: Gmail SMTP credential is STALE (535 auth error — needs Amarsh to regenerate the app password before the live-invite demo moment works), AWS key rotation still due, a second UTC-day bug found in warranty.ts. Not yet reviewed/merged.
- PR #13 (identity/access): email/password auth, roles, seeded demo accounts (`<role>@demo.pranava` / `Demo@2026`), fixed a live cross-customer PII leak in /api/me/home. **Important gap flagged, not yet fixed**: authorize()/mask()/project-scope checks are wired only into /auth, /admin and the customer portal home route — every other existing data route still relies on client-side UI hiding only, not server enforcement. Not yet reviewed/merged.

## 08:20 IST — R0-03 (platform/deploy) merged, with a self-caught process gap
- Reconciled r0/03-platform against merged main (PR #10): resolved db.ts deletion, seed.ts/seed-lifecycle.ts canonical-column conflicts, and a real functional gap the platform port abstraction had introduced — `DbClient` had no `transaction()` method, which the event-log`\s `withTx()` needs; also `seedEventTypes()` was not wired into boot/test-db setup. Fixed both, verified 184 API + 61 workspace + 35 Playwright e2e, tsc clean, live boot smoke test.
- **Process mistake, self-caught**: those two fixes were verified against the local worktree but never `git commit`-ed before push+merge, so PR #12 landed on main WITHOUT them — main was broken for a few minutes (tsc failures, 21/35 API test files failing on `event_type_fkey`). Caught immediately by re-verifying on the actual pulled `main` (not trusting the pre-merge worktree state) — shipped as hotfix PR #14, re-verified again after. Main is green now, confirmed by a fresh `git pull` + full suite run.
- **Lesson applied going forward**: after any push, always diff the pushed remote branch/commit content directly (not just the local worktree) before calling a merge done, and always re-verify on a freshly pulled `main`, not the pre-merge worktree.
