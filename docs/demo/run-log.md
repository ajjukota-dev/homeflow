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

## 08:37 IST — R0-32 (design system) merged
- Jost + Geist Sans/Mono self-hosted, real sampled/scraped brand colours (packages/ui), 8 primitives + preview pages, ESLint token-literal rule (already caught and fixed real rounded-[6px] violations before this session), axe/font/reduced-motion e2e.
- Only merge conflict: root package.json (kept both the `workspaces` field and platform PR's updated description text). Re-verified: tsc clean (3 packages), 61/61 workspace unit tests, 50/50 Playwright e2e including the new design.spec.ts (24 tests: fonts load, axe 0 violations on 4 preview pages, reduced-motion collapses to <=120ms).
- Re-confirmed on freshly pulled `main`: tsc clean, 184 API + 61 workspace tests green.
- **R0 status: all four lanes (02/04 events+canonical, 03 platform/deploy, 32 design system) now merged.** Remaining R0 lane: 01 identity/access (PR #13, in progress — has a flagged security gap: authorize()/mask() only wired into a few routes).

## 09:00 IST — R0-01 (identity/access) merged. All four R0 lanes complete.
- Login, sessions (argon2id, httpOnly cookies), 33-module permission matrix, demo accounts (`<role>@demo.pranava` / `Demo@2026`, all PDF §13 roles + a customer login), invite/reset flows. Fixed a live cross-customer PII leak in /api/me/home during the build.
- Two merge rounds against 02/04, 03, 32: resolved App.tsx/Workspace.tsx nav restructuring (origin main's Projects/Units/Customers admin page spliced into identity's own ADMIN_NAV as a 4th entry), db.ts/server.ts/package-lock.json/.gitignore conflicts.
- Found and fixed 2 real bugs while re-verifying: mobile header had no way to reach any admin screen at all; one axe test raced a 440ms stagger animation and flagged mid-fade text as a contrast failure.
- Also found and fixed (unrelated to this PR): an auto-commit process swept an orphaned, already-merged worktree directory into `main` as 86 stray files, including a syntactically broken canvas file caught by an independent Codex review. Untracked all of it, gitignored `.claude/worktrees/`, `.claude/direction-last-check`, `infra/cdk.out/`. This auto-commit mechanism is outside this session's control — worth Amarsh's attention since it can silently commit things.
- Re-verified independently on freshly pulled `main` (not the pre-merge worktree): tsc clean x3 packages, 232 API + 65 workspace tests, live boot + real login smoke test against a seeded demo account.
- **R0 status: DONE. All four lanes (01, 02/04, 03, 32) merged and verified on main.** Live URL: https://we947t2rq2.ap-south-1.awsapprunner.com
- **Known gap tracked as R0.6** (not yet closed): authorize()/mask()/assertProjectScope() only wired into /api/admin/* and part of /api/me/home — every other route trusts any authenticated user regardless of role. Next up.
