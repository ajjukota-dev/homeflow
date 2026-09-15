# Phase 4 agent prompt — copy everything below the line into a new chat

Paste the block from `BEGIN PROMPT` through `END PROMPT` as the first message of a **new** Cursor chat on this repo. Do not add extra goals. When that chat finishes, paste its `## Phase 4 report` back into the planning chat for exit verification.

Phases 1–3 and Phase 2 leftover must-do are **closed**. This chat is **4.1–4.3 only** (RLS on the request path, project scope, field masking). Do not rewrite occupants. Do not start Queues / Action Types / files / QA factory / scorers / 2.12.

---

BEGIN PROMPT

You are implementing **HomeFlow Phase 4.1–4.3 only** (RLS + project scope + field masking). This is a finished-product handover track, not a brainstorm. **Do not hand over an open database.**

Read first, in this order, before writing code:

1. `CLAUDE.md`
2. `docs/CONTEXT.md`
3. `docs/specs/00-conventions.md`
4. This prompt in full
5. `services/api/migrations/0025_rls.sql` (header comments are the audit — read them)
6. `services/api/src/rls.test.ts` (policies work under manual `SET ROLE`; GUCs are **not** on the request path)
7. `services/api/src/authz/scope.ts` (`resolveProjectIds`, `assertProjectScope` — **not wired into routes**)
8. `services/api/src/authz/mask.ts` (`mask()` — **not wired into GET handlers** except possibly `/api/admin/*`)
9. `services/api/src/auth/middleware.ts` (`requireSession` sets `req.actor`, then handlers query as superuser)
10. `services/api/src/db/pglite-adapter.ts` + `pg-adapter.ts` + `services/api/src/events/append.ts` (`withTx` already uses `AsyncLocalStorage` for pending events — copy that idiom for actor/GUC, do not invent a second bus)
11. `TODO.md` R2.5 P1b row (AsyncLocalStorage + named `runAsSystem`; missed call site must fail-closed, not unrestricted)
12. Specs you will actually touch: `docs/specs/01-identity-access.md` (RLS / mask / scope), PDF §4.4 / §22

Follow TDD: failing test first. Do not commit or push unless I ask. Do not deploy. Do not call paid APIs. Do not start Phase 5. **Do not implement 4.4–4.10, 2.12, chatbot, WhatsApp, vendor portal, Google OIDC, AWS, East-Crest-only code.**

---

## Product

HomeFlow is Pranava’s post-booking OS. Spec: `docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`. Local: API `:3001`, workspace `:5173`, portal `:5174`. Reset: **stop API first**, `npm run db:reset` in `services/api`. Demo logins `*@demo.pranava` / `Demo@2026`.

Two live projects already exist: `p_eastcrest` and `p_meadows`. Staff other than MANAGEMENT/SUPER_ADMIN are assigned via `project_team_assignment`. Portal customers are scoped by `customer_login`.

---

## Why this chat exists

`0025_rls.sql` created `homeflow_app` + policies. Every request still runs as the superuser `db` connection, so RLS is inert. `assertProjectScope` exists and is unused on product routes. `mask()` exists; `field_sensitivity` is seeded for `customer_overview` / `customer_financials` / `collections`; GET handlers still return raw amounts/PII. PDF §4.4 / §22 fail until a request from `crm@` cannot read another project and `customer@` cannot read another customer’s booking.

Leftover occupants (Kavya, Deepak, Farhan, …) are already on main via handlers. **Do not rewrite seed.** Use those people as proof fixtures.

---

## Must-do this chat (stop here if the clock runs out)

Do **4.1**, then **4.2**, then **4.3**. If 4.1 is not on the live request path, the day is not complete. Roll back a half-wired GUC rather than leave “sometimes superuser”.

| ID | Do this | Done when |
|---|---|---|
| 4.1 | RLS on every authenticated request + policies on tables created after `0025` | Each API request sets `app.realm` / `app.user_id` / `app.customer_id` / `app.project_ids` / `app.all_projects` from `ctx.actor` (fed by existing `resolveProjectIds`). Request queries run as `homeflow_app` (NOBYPASSRLS), not superuser. Login as customer A (`customer@` / Ananya BK-V112) and GET customer B’s booking (e.g. Karthik `b_v110` / BK-V110) → denied (404, empty, or `forbidden` — never 200 with the other home). Tables added after 0025 that carry `project_id` have `ENABLE ROW LEVEL SECURITY` + a policy (same USING pattern as 0025). Seed / migrate / journey subscribers / scheduler `runOnce` use a named `runAsSystem(fn)` — **not** “no actor = unrestricted”. |
| 4.2 | `assertProjectScope` on product handlers | Session scoped to East Crest: GET a Meadows booking id (e.g. BK-MT201 / BK-MP01) → **404**. Write → **403**. Reverse (Meadows-scoped actor, East Crest id) also holds. MANAGEMENT/SUPER_ADMIN still `project_ids === "ALL"`. Do not skip this because RLS exists — defense in depth. |
| 4.3 | `mask()` on financial/PII GET responses; UI tolerates nulls | A role without finance (`READ_LIMITED` / `NONE` on `customer_financials` / `collections`) sees `null` amounts, not rupees. Workspace screens that render those fields do not white-screen (`?? "—"` or equivalent). Portal still has no vendor price, internal note, staff name-as-blame, unapproved forecast. |

Pinned people / ids (already seeded — do not recreate):

| Proof | Login / id |
|---|---|
| Customer A | `customer@demo.pranava` · Ananya · BK-V112 · `b_v112` |
| Customer B | `karthik@demo.pranava` · BK-V110 · `b_v110` (or any other accepted leftover booking) |
| East Crest staff | `crm@` (assigned East Crest; confirm in `project_team_assignment` before asserting) |
| Meadows booking | BK-MT201 Nisha · BK-MP01 Suresh · BK-MT502 Kavya · BK-MP02 Deepak |
| Spare pool | **Do not book `u_v101` / `u_v104` / `u_v108`** |

---

## How to build 4.1 (do not invent a second security model)

1. **Actor store.** Add `AsyncLocalStorage` for the current `Actor` (or a small `{ actor, realm }` record). Set it in `requireSession` after `req.actor` is known, `res.on("finish")` / `finally` to clear. Handlers stay Express-free; they keep receiving `ctx`. The **db port** reads the store.
2. **GUCs + role.** On the request path, before queries: `SET ROLE homeflow_app` (or connect as that role on pg) then `SET LOCAL` (inside a transaction) or equivalent `set_config(..., true)` for `app.realm`, `app.user_id`, `app.customer_id`, `app.project_ids` (comma-separated ids matching 0025’s `string_to_array` policy), `app.all_projects` (`true` iff `actor.project_ids === "ALL"`). Realm: `staff` vs `customer` matching 0025’s `current_setting('app.realm')`. Read 0025’s exact setting names — do not rename them.
3. **PGlite is one session.** `SET ROLE` leaking into the next test/request is a defect. Always `RESET ROLE` (and clear GUCs) in `finally`. Tests that open `initDb` then query as superuser for setup must `RESET ROLE` first. Do not leave the vitest process stuck as `homeflow_app`.
4. **`runAsSystem(fn)`.** Named, explicit. Use for: migrations, `seed()`, `registerJourneySubscribers` / `dispatchAll` side effects that must see all rows, scheduler `runOnce`, and test `beforeAll` fixtures that insert across projects. A bare `db.query` with **no** actor store and **no** `runAsSystem` must fail-closed (zero rows or throw) — not superuser-bypass. Document the choice under Assumptions if you must keep a boot-time superuser window before listen.
5. **Policies after 0025.** New migration (next number after the latest in `services/api/migrations/`). Do **not** edit 0025 in place if that rewrites applied history — additive migration. ENABLE RLS + policy on every post-0025 table with `project_id` (at least: `loan_case` / `loan_event`, `escalation`, `commitment`, `sales_handover`, `doc_factory_document` / `doc_factory_template` if it has `project_id`, `forecast_*` with `project_id`, `change_request`, `post_handover_case`, `communication` if it has `project_id`). Global config tables (no `project_id`, Studio) stay visible to staff the same way 0025 treated nullable-global rows — do not invent a lockout of `action_type`. Customer-realm: 0025 deferred it as P1c. **It is in scope here** because e41 requires customer A ↛ customer B. Add customer policies (own booking via `customer_login` / `booking_applicant`) or prove an equivalent deny at the db for customer-realm SELECTs on `booking` / `demand` / `customer`. Do not “handler check only” and call RLS done.
6. **Keep `rls.test.ts`.** It still proves policies under `SET ROLE`. Add **request-path** tests that go through handlers/`requireSession` (or the db helper the middleware uses), not only raw SQL.

---

## How to build 4.2

1. Extract `project_id` from the resource (booking/unit/demand already have it — load then assert; never trust a client-supplied `project_id` as the scope).
2. Call `assertProjectScope(ctx.actor, projectId, "read"|"write")` on product GET/POST/PATCH/DELETE that take an entity id. Start with booking 360, unit 360, collections, registration case, handover case, customer 360 — enough that East Crest ↛ Meadows is proven, then sweep remaining `routes-*.ts` handlers that take ids. A helper used by every route file is better than 200 copy-pastes.
3. Tests: build a staff actor with `project_ids: ["p_eastcrest"]` (or use a real `crm@` session if assignments are East Crest–only). GET Meadows booking → 404. POST/PATCH → 403. Do not use SUPER_ADMIN for the deny test.

---

## How to build 4.3

1. Wire existing `mask(ctx, module, row)` on GET responses for modules that have `field_sensitivity` rows (`customer_overview`, `customer_financials`, `collections`). Lists: mask each row.
2. Tests: actor whose effective level is below `READ_LIMITED` on `customer_financials` gets `null` for amount fields; `accounts@` still sees numbers.
3. UI: any workspace/portal screen that rendered those fields must tolerate `null` (em dash / hidden). Do not add glass, hex, or new pages. `apps/` only for null-safety on screens you can name in the report. Portal must still not grow vendor cost or internal notes.

---

## Invariants

1. Do not rewrite Phase 1/2/leftover seed. No `INSERT INTO booking` for occupants. `rls.test.ts` may keep its minimal `p_rls_test2` SQL fixture.
2. Do not book V101 / V104 / V108.
3. Do not invent SOP days/charges. Do not hard-code East Crest.
4. GET 360 / scores / forecast must not newly persist snapshots (Phase 1 e1-get still holds).
5. Nested `withTx` still hangs on PGlite — do not add a second transaction around GUC setup if one is already open; set LOCAL on the existing tx.
6. No new npm packages without asking in this chat.
7. Handlers stay Express-free. Files ≤200 lines; split if the ALS/GUC helper grows.
8. Scheduler (`HOMEFLOW_SCHEDULER`) and quiet hours stay as Phase 3 left them; `runOnce` must call `runAsSystem`.

---

## Allowed files

- `services/api/src/db/**` — adapters + a small `runAs` / GUC helper
- `services/api/src/auth/middleware.ts` — enter/exit actor store
- `services/api/src/authz/**` — scope helper used by routes; do not change `assertProjectScope` semantics (read 404 / write 403)
- `services/api/src/routes*.ts` + handler files that need `assertProjectScope` / `mask`
- `services/api/migrations/NNNN_rls_followup.sql` (next free number) — policies for post-0025 tables + customer-realm if needed
- `services/api/src/rls.test.ts` **and** new `rls-request.test.ts` (or equivalent)
- `services/api/src/authz/scope.test.ts` / `mask` tests
- `apps/workspace` / `apps/my-pranava-home` **only** for null-safe render of masked fields
- `docs/demo/click-path.md` — one paragraph: RLS is on; cross-project / cross-customer denials
- `TODO.md` — CONTINUE HERE leftover + one Found while building bullet. Do not rewrite the status-board table.

Out of bounds: occupant seed files, `Queues.tsx` claim/reassign, Action Types Studio, `approval_authority_rule` bands / ₹200k, files-port photo rewrite, QA exception queue, document factory families, `score_weight` scorers, chatbot, infra/CDK, new npm deps.

---

## Tests (fail first)

1. Authenticated request path sets GUCs (assert `current_setting('app.realm')` inside a handler query, or a test hook on the db helper).
2. `customer@` GET `/api/me/home` (or the portal home handler) for Ananya succeeds; the same session GET Karthik booking 360 / customer B home → not 200-with-body.
3. East Crest–scoped staff GET Meadows booking id → 404; write → 403.
4. A post-0025 table with `project_id` (e.g. `loan_case` or `commitment`) does not return the other project’s rows under `homeflow_app` + East Crest GUCs.
5. Empty/missing realm fail-closed (keep 0025 behaviour).
6. `runAsSystem` can still `seed()` / `initDb`; vitest suite does not hang as the wrong ROLE.
7. Mask: financial field is null for a non-finance role; UI test or handler test proves no throw on null.
8. Phase 1 leftover occupants still exist after `initDb` (BK-V110–V113, BK-MT201, BK-V116, etc.). No booking on `u_v101`/`u_v104`/`u_v108`.

Run full `npm test` in `services/api` unsandboxed. Real counts in the report. Fix failures in this phase — do not leave them “for Phase 5”.

---

## Forbidden claims

- Do not mark 4.1 done because `0025_rls.sql` exists or `rls.test.ts` still passes under manual `SET ROLE`.
- Do not mark 4.1 done if the API process still queries as superuser after `requireSession`.
- Do not mark 4.2 done because SUPER_ADMIN can see both projects.
- Do not mark 4.3 done because Studio can edit `field_sensitivity`.
- Do not start `Queues.tsx` “because you had an hour”.
- Do not seed 2.12 delay_reason here.

---

## Your last message MUST be exactly this shape

```
## Phase 4 report

### Accomplished
- 4.1: [yes/no + one sentence]
- e41-guc: …
- e41-customer: … (customer A ↛ B)
- e41-post0025: … (which tables gained policies)
- 4.2: …
- e42-eastcrest-meadows: …
- 4.3: …
- e43-mask: …
- e43-ui-nulls: …
- e4-tests: … (suite green with RLS on?)
- e4-seed: … (no INSERT INTO booking for occupants)

### Proof run
- Commands run (verbatim)
- API vitest: N passed / N failed
- Request-path RLS tests: …
- Browser walk: done / not done / why

### Assumptions
Numbered. If none: `None.`

### Leftover still for the team
4.4–4.10, 2.12. Any 4.1–4.3 item that is no.

### Out of scope
Queues, Action Types, files port, QA exception queue, document factory families, score_weight, chatbot, 2.12.

### Files changed
Paths only.

### Known gaps vs Phase 4.1–4.3 exit
```

If 4.1 is no, say the day is **not complete**. 4.2 / 4.3 may be no only after 4.1 is yes.

END PROMPT
