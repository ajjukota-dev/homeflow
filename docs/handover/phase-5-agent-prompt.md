# Phase 5 agent prompt — copy everything below the line into a new chat

Paste the block from `BEGIN PROMPT` through `END PROMPT` as the first message of a **new** Cursor chat on this repo. Do not add extra goals. When that chat finishes, paste its `## Phase 5 report` back into the planning chat for exit verification.

Phases 1–4 (including leftover 2.12 and 4.1b / 4.2b / 4.4–4.10) are **closed** on `main`. This chat is **Phase 5 only: prove and hand over**. Do not start a chatbot, AWS, or occupant rewrite.

---

BEGIN PROMPT

You are implementing **HomeFlow Phase 5 only** (prove and hand over). This is a finished-product handover track, not a brainstorm. Phases 1–4 are closed on `main` (`9c6b982` and earlier). Do not reopen 2.12 or 4.x as new engines.

Read first, in this order, before writing code:

1. `CLAUDE.md`
2. `docs/CONTEXT.md`
3. `docs/specs/00-conventions.md`
4. This prompt in full
5. Exit boxes `e51`–`e56`, `e5-rls`, `e5-gates`, `e5-out` in `docs/handover/phase-work-map.md`
6. The nine handover gates in `docs/handover/client-readiness.md` (“We hand over when”)
7. Specs you actually touch: `docs/specs/01-identity-access.md` (invite), `docs/specs/26-customer-portal.md` (§26), `docs/specs/07-unit-progress-control.md` + `docs/specs/08-changeability-engine.md` (§33.6 Sales-cannot-edit-Site), `docs/specs/06-timeline-sla-engine.md` (§34.7), `docs/specs/22-document-factory.md` (§32.11), `docs/specs/16-handover-gates.md` / `docs/specs/20-cash-forecast.md` as needed for named §26 / §31.5 coverage
8. Copy, do **not** reimplement: `initDb` seed, `seed-occupants.test.ts`, `seed-phase2-leftover.test.ts`, `progress/core.test.ts` (SALES refused), `authz/authorize.test.ts` `p44-33.6-t3`, `auth/invite.test.ts`, workspace `e2e/auth.spec.ts` invite, `e2e/journeys/sale-to-handover.spec.ts`, portal `apps/my-pranava-home/e2e/auth.spec.ts`, `docs/demo/click-path.md`, `HANDOFF.md`
9. Do **not** book `u_v101` / `u_v104` / `u_v108`. Occupants already exist — prove them.

Follow TDD: failing test first for any new 5.1 / 5.6 behaviour. Do not commit or push unless I ask. Do not deploy. Do not call paid APIs. **Ask me before any AWS, CDK deploy, App Runner, RDS, or billed service.** Default 5.5 is a checked-in local-first Postgres 16 runbook, not a live deploy.

Do not start a chatbot, WhatsApp runtime, vendor portal, Google OIDC, East-Crest-only code, or invent SOP day counts. Do not “fix GitHub Actions / the failing `ci` and `deploy` workflows” in this chat — those have been red since before Phase 4 and are not a Phase 5 ID.

---

## Product

HomeFlow is Pranava’s post-booking OS. Spec: `docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`. Local: API `:3001`, workspace `:5173`, portal `:5174`. Reset: **stop API first**, `npm run db:reset` in `services/api`. Logins `*@demo.pranava` / `Demo@2026`. Roster: `docs/demo/click-path.md`.

---

## Why this chat exists

Phases 1–4 seeded the desks and closed product holes. The client still cannot take the product because **proof, operator pack, invite-a-stranger, and deploy-or-runbook** are open. This phase is the handover gate, not a new OS.

Much of 5.1 / 5.2 / 5.6 already exists as scattered tests. **Finish and prove against the seeded roster.** Do not rebuild seed, RLS, Queues, or the factory.

---

## Must-do this chat (stop here if the clock runs out)

Do **5.1 → 5.6 (My Day invite if missing) → 5.2 → 5.3**. If 5.3 is no (you did not run reset + suites and read the output), the day is **not complete**. Then 5.4 and 5.5.

| ID | Do this | Done when |
|---|---|---|
| **5.1** | Occupant-state unit tests vs the **seeded roster**, not empty fixtures | One automated test per seeded PDF §34.2 stage on click-path people (packets submitted/returned, CR in flight, hold/prospect, Meadows apt+plot, AOS draft, registration slot, handover in progress, NRI+loan, default/legal, cancelled, pre-reg blocked, CRITICAL snag, construction/cash, post-handover). Named coverage for PDF **§26**, **§31.5**, **§32.11**, **§33.6**, **§34.7**. **Sales cannot PATCH site gates** (extend existing SALES/`unit_readiness` 403 — do not duplicate a second matrix). **Two projects, different durations, same code** — assert East Crest vs Meadows duration/SLA come from Studio/seed **rows** and are not one in-code constant. File next to the tests it extends (`seed-occupants.test.ts` / leftover / a new `occupant-states.test.ts`). |
| **5.6** | Invite a new **staff** user end-to-end; they land in **My Day** | `createUser` + file-mailer invite + set password already exist (`auth/invite.test.ts`, `e2e/auth.spec.ts` invites MANAGEMENT → Control tower). That is **not** e56. Invite a role whose home is My Day (e.g. CRM), set password, land on **My Day**, not an `INSERT INTO users` in seed. Playwright on `main`; `{ exact: true }` on short verbs. |
| **5.2** | Playwright click-path: staff sale-to-handover desks + portal Ananya + portal Rohan | Do **not** book a spare unit through the whole OS. Extend `e2e/journeys/sale-to-handover.spec.ts` (today it is a **read-only** walk of seeded desks — keep it that way unless a gap needs a click). Locators `page.locator("main")`. Screenshots 1440 / 768 / 375, reviewed (tokens, no console errors). Portal: Ananya `customer@` and Rohan `rohan@` on `:5174` see **their** home, no vendor price / internal note / unapproved forecast. |
| **5.3** | Fresh reset + full suites + walk | Stop API → `npm run db:reset` in `services/api` → start stack. Full `services/api` `npm test`. Playwright for 5.2 / 5.6 plus the files you touch. Click-path as staff (`crm@`) + Ananya + Rohan (and one Phase 2 accepted portal, e.g. `nisha@`). **You have the real log in the report.** Chromium in sandbox SIGSEGVs — run Playwright unsandboxed. |

Then:

| ID | Do this | Done when |
|---|---|---|
| **5.4** | `HANDOFF.md` + `docs/demo/click-path.md` are **this** product | Operator pack: current logins, occupant roster, empty/error behaviour, reset order (stop API first). A stranger can follow click-path after reset. Rewrite the R0-era bits of `HANDOFF.md` (it still says workspace has no login / portal is Karthik-only / customer app read-only — those are false). Document known gaps: forecast still equals baseline after plan revision; Queues may still show raw `user_*` owner ids. |
| **5.5** | Local-first Postgres 16 runbook **unless I have said yes to AWS spend** | Default: a written runbook in `docs/` (e.g. `docs/handover/local-postgres.md`) — PGlite vs Postgres 16, env, migrate, seed, how to boot both UIs, backups = the `.data` / Postgres volume, health. **Ask before** CDK/App Runner/RDS. Do not treat the old App Runner URL as this main. Do not “fix” GitHub `deploy.yml` AWS credentials in this chat. |
| **e5-rls** | 4.1 still on `main` | `wrapWithRls` + `0047` + pg pin still on the request path; `rls-request.test.ts` still green as part of 5.3. Do not hand over if you stripped RLS to make a test pass. |
| **e5-gates** | The nine gates in client-readiness | Tick or no each gate in the report with one prove sentence. |
| **e5-out** | Nothing from Out of all phases shipped | Grep: no chatbot, WhatsApp runtime, vendor portal, East-Crest-only branches, invented SOP days, Google OIDC without a client, AWS without spend yes. |

---

## How to build 5.1 (do not invent a second roster)

1. Tests call `initDb()` (or the existing leftover setup) and assert **named people** from click-path (`b_v110`, `b_mt201`, `b_mv01`, …). Not `booking-fixture-1`.
2. Reuse leftover tests; add only the named PDF coverage that is missing. Search before writing a parallel file that re-proves Karthik has a journey.
3. §33.6 t3: SALES `updateProgress` / gate rule write → forbidden. `progress/core.test.ts` already refuses SALES — cite it or extend; do not copy-paste a third copy.
4. Two projects / different durations: query `journey_stage_template` / SLA / policy rows for `p_eastcrest` vs `p_meadows` (or product-type rows). Assert at least one duration (or equivalent config number) **differs**, and that scorers/journey engine read those rows. Do not invent new East Crest day counts.
5. GET 360 / scores must **not** newly persist snapshots on every read.

---

## How to build 5.6

1. Do not rewrite Admin → Users. Extend Playwright: `superadmin@` invites a **CRM** (or other My Day role) email → file mailer token → `/invite/:token` → password → **My Day** heading visible.
2. Existing MANAGEMENT invite → Control tower may stay; it does not close e56.

---

## How to prove 5.3

1. Stop any live API on `:3001`. Then `npm run db:reset` in `services/api`. Then start API + workspace + portal.
2. `cd services/api && npm test` — real counts in the report.
3. Playwright from `apps/workspace` (and portal project if 5.2 lives there). Name the files. Real pass/fail counts.
4. Walk: `crm@` 360 Journey non-empty for Karthik; desks from click-path not “No items” for claimed occupants; portal Ananya + Rohan + one Phase 2 login.
5. Do not claim green from a dirty `.data/pglite`.

---

## Invariants

1. No `INSERT INTO booking` for occupants. No occupant rewrite.
2. Do not book V101 / V104 / V108.
3. Do not invent SOP days/charges.
4. GET 360 / scores: persist-on-change only.
5. No new npm packages without asking.
6. Handlers stay Express-free. Files ≤200 lines.
7. Playwright: `page.locator("main")`; `{ exact: true }` on Save / Accept / Send / Claim / Invite.
8. Do not start a chatbot. Do not generate PDFs via Chromium inside `initDb`.
9. Do not create billed cloud resources. 5.5 default is a runbook.

---

## Allowed files

- `services/api/src/**/*.test.ts` for 5.1 (prefer extending occupant/leftover/progress/authorize tests)
- `apps/workspace/e2e/journeys/sale-to-handover.spec.ts`, `apps/workspace/e2e/auth.spec.ts`, `apps/my-pranava-home/e2e/**`
- `apps/workspace/e2e/__screenshots__/` for 5.2
- `HANDOFF.md`, `docs/demo/click-path.md`, `docs/handover/client-readiness.md`, `docs/handover/phase-work-map.md` (tick 5.x only after prove)
- `docs/handover/local-postgres.md` (or similar) for 5.5 runbook
- `TODO.md` — CONTINUE HERE leftover + one Found while building bullet. Do not rewrite the status-board table
- Invite UI **only** if the existing Admin → Users path cannot land a CRM in My Day (minimal fix)

Out of bounds: occupant rewrite, chatbot, infra/CDK deploy, GitHub Actions AWS credentials, new npm deps, Queues rewrite, forecast-revision engine (document the gap in 5.4; do not invent a handler).

---

## Tests (fail first)

1. 5.1: named roster tests + §26 / §31.5 / §32.11 / §33.6 / §34.7 names in test titles or describe blocks.
2. 5.6: Playwright invite → My Day.
3. 5.2: sale-to-handover (seeded walk) + Ananya portal + Rohan portal; screenshots.
4. 5.3: real reset + suite output in the report.
5. Spare pool still unbooked; leftover occupants still present.

Run `npm test` in `services/api` unsandboxed. Run Playwright unsandboxed. Real counts in the report.

---

## Forbidden claims

- Do not mark 5.1 done because `gates.test.ts` is green on synthetic rules.
- Do not mark 5.2 done because `sale-to-handover.spec.ts` already screenshots V110 — prove locators on `main`, Ananya **and** Rohan portal, three breakpoints reviewed.
- Do not mark 5.3 done without reset, or without pasting real pass/fail counts.
- Do not mark 5.4 done if `HANDOFF.md` still says there is no login.
- Do not mark 5.5 done by pointing at `https://we947t2rq2.ap-south-1.awsapprunner.com`.
- Do not mark 5.6 done because MANAGEMENT invite lands on Control tower.
- Do not mark e5-rls done because occupants look good.
- Do not deploy AWS “to finish the product.”
- Do not reopen 2.12 by writing a forecast-revision engine.

---

## Your last message MUST be exactly this shape

```
## Phase 5 report

### Accomplished
- 5.1: [yes/no + one sentence]
- 5.2: …
- 5.3: …
- 5.4: …
- 5.5: … (runbook path, or AWS only if I said yes)
- 5.6: …
- e5-rls: …
- e5-gates: gate 1–9 yes/no one line each
- e5-out: …

### Proof run
- Commands run (verbatim)
- API vitest: N passed / N failed
- Playwright files run: …
- Browser walk: done / not done / why (crm@ + Ananya + Rohan + which Phase 2 portal)

### Assumptions
Numbered. If none: `None.`

### Leftover still
IDs that are no.

### Out of scope
Chatbot, WhatsApp, vendor portal, Google OIDC, AWS without spend yes, GitHub Actions deploy credentials, occupant rewrite, forecast-revision engine.

### Files changed
Paths only.

### Known gaps vs Phase 5 exit
```

If 5.3 is no, say the day is **not complete**. Later IDs may be no.

END PROMPT
