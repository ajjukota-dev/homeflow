# Phase 4 rest + leftover agent prompt — copy everything below the line into a new chat

Paste the block from `BEGIN PROMPT` through `END PROMPT` as the first message of a **new** Cursor chat on this repo. Do not add extra goals. When that chat finishes, paste its `## Phase 4 rest report` back into the planning chat for exit verification.

Phases 1–3, leftover occupants (except 2.12), and Phase 4.1–4.3 are **closed**. This chat is everything still open before Phase 5: **4.1b (pg Pool pin), 4.2b (remaining assertEntityScope), 4.4–4.10, and 2.12**. Do not start Phase 5, chatbot, AWS, or rewrite occupants.

---

BEGIN PROMPT

You are implementing **HomeFlow remaining Phase 4 + leftover 2.12** in one chat. This is a finished-product handover track, not a brainstorm. 4.1–4.3 already landed on PGlite. Do not reopen them except the named leftovers below.

Read first, in this order, before writing code:

1. `CLAUDE.md`
2. `docs/CONTEXT.md`
3. `docs/specs/00-conventions.md`
4. This prompt in full
5. Exit boxes `e44`–`e410` and `e212` in `docs/handover/phase-work-map.md`
6. Specs you actually touch: `docs/specs/10-universal-action.md` (Queues / action_type), `docs/specs/25-policy-studio.md` (approval matrix), `docs/specs/13-promise-ledger.md` (commitments), `docs/specs/16-handover-gates.md` (signatures), `docs/specs/15-qa-evidence-snags.md` (site vs QA + exception queue), `docs/specs/22-document-factory.md`, `docs/specs/14-readiness-scores.md`, `docs/specs/06-timeline-sla-engine.md` (`createPlanRevision`)
7. Copy, do **not** reimplement: `assertEntityScope` in `services/api/src/authz/entity-scope.ts`, `wrapWithRls` in `services/api/src/db/rls-port.ts`, `createPgClient` in `pg-adapter.ts`, `requiredApprovers` in `approvals/matrix.ts`, `files.putPresigned` / `putBuffer` (QA inspections and actions already upload this way), `listQaExceptions` in `qa/inspections.ts`, `createPlanRevision` in `journey/plan-revision.ts`, Studio generic editor `apps/workspace/src/pages/studio/GenericTableEditor.tsx` (`action_type` and `score_weight` already registered)
8. Do **not** book `u_v101` / `u_v104` / `u_v108`. Occupants already exist (Karthik BK-V110, Nisha BK-MT201, Ishaan BK-V114 handover-in-progress, …).

Follow TDD: failing test first. Do not commit or push unless I ask. Do not deploy. Do not call paid APIs. Do not start Phase 5, chatbot, WhatsApp, vendor portal, Google OIDC, AWS, East-Crest-only code.

---

## Product

HomeFlow is Pranava’s post-booking OS. Spec: `docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`. Local: API `:3001`, workspace `:5173`, portal `:5174`. Reset: **stop API first**, `npm run db:reset` in `services/api`. Logins `*@demo.pranava` / `Demo@2026`.

---

## Why this chat exists

4.1–4.3 closed the open database on **PGlite**. Remaining product holes still fail handover: departmental queues proof, Action Types persist, empty approval matrix + ₹200k commitment fallback, signatures as data-URLs, QA exception queue with no staff screen, AOS-only factory families, decorative `score_weight`, plan vs forecast still all-zero, and `pg.Pool.query` would still bypass RLS on RDS.

Many of these already have backend or a half-UI. **Finish and prove.** Do not rebuild Queues, Studio, QA inspections, or the document factory from scratch.

---

## Must-do this chat (stop here if the clock runs out)

Do **4.1b → 4.4 → 4.6**, then continue the rest in ID order. If 4.1b or 4.6 is no, the day is not complete for the must-do set. Roll back a half-wired Pool pin rather than “SET ROLE on a different client than the SELECT”.

| ID | Do this | Done when |
|---|---|---|
| **4.1b** | Pin `pg` Pool so `SET ROLE` + GUCs + the statement share one client | `createPgClient().query` under `wrapWithRls` cannot use two pool clients. Actor query on Postgres uses the same checkout as `SET ROLE` / `RESET ROLE`. Test: a unit/integration that mocks or uses `DATABASE_URL` postgres **or** a white-box test that `pg-adapter` `query` holds a client across SET ROLE + statement + RESET. PGlite path stays green. |
| **4.4** | Queues: claim, Management reassign, empty, error; locators on `main` | `Queues.tsx` already has claim / bulk reassign / EmptyState / error Retry / skeletons. **Do not rewrite it.** Add/fix Playwright in `apps/workspace/e2e/queues.spec.ts`: `page.locator("main")`, `{ exact: true }` on short verbs. Prove claim as a department user, reassign as `management@`, empty state (not spinner), error state (not spinner). Component tests already exist — extend if a gap. |
| **4.6** | Seed `approval_authority_rule` COMMITMENT bands; commitments call `requiredApprovers()`; drop in-code ₹200k | `commitments/core.ts` `COMMITMENT_MANAGEMENT_THRESHOLD_INR = 200000` and `defaultApproverRole` go away. Seed `domain=COMMITMENT`, `metric=INR` bands (config, not East Crest SOP). `requiredApprovers("COMMITMENT", "INR", value, projectId)` is the lookup. Grep `services/api/src` for in-code `200000` / `200k` / `2_00_000` **fallbacks** — none remain (seeded CR matrix `threshold: 200000` in `seed/change-requests.ts` is data, keep). Empty matrix still fail-closed via existing `requiredApprovers` conflict. |

Pinned leftover + remaining 4.x (continue in order after must-do):

| ID | Do this | Done when |
|---|---|---|
| **4.2b** | `assertEntityScope` on remaining id-taking handlers | Actions, CRs, QA inspections/snags, sales holds, portal writes that take a booking/unit/demand/customer/project id call `assertEntityScope` (or a tiny wrapper). East Crest actor still 404/403 on Meadows ids. Do not skip “because RLS exists”. |
| **4.5** | Action Types Studio actually edits `action_type` | Spec 10 already uses generic Studio (`TAB_TO_TABLE["10.action_types"]`). **Do not create `ActionTypes.tsx`.** Test: change `label` (or SLA) via `draftStudioRow`/`publishStudioRow` (or UI), reload, `action_type` row matches. |
| **4.7** | Photos, signatures, deeds through files port (file id, not data-URL) | `SignaturePad.tsx` currently passes a PNG **data URL** as `*_signature_file_id`. Copy QA/`routes-actions` `putPresigned` pattern: canvas → `image/png` → PUT `/api/files/...` → store the **key**. Handover checklist columns stay file ids. Ishaan BK-V114 in-progress handover uses a file, not `data:image`. New writes: grep seed/UI for `data:image` — gone. Existing `files.putBuffer` for generated PDFs stays. |
| **4.8** | QA: site declaration vs independent verification + exception queue **on a staff path** | Backend already has `qa_inspection` kinds + `listQaExceptions` (`qa/qa.test.ts` rule 1 and 3). **Do not rebuild the engine.** Ship a QA workspace screen (or extend the existing QA page) that shows: (1) site declaration as a distinct act from QA verify, (2) exception queue as a **row list**, not a comment. Empty/error/loading. Locators on `main`. |
| **4.9** | Document factory draft v1/v2 + sale families | Factory exists. Seed or Studio-create **APPROVED templates** (not Chromium `generateDocument` inside `initDb`) for families: AOS, Sale Deed, addendum, demand, receipt, handover letter, variation, cancellation. **Do not assign LEASE** unless you find a written “we lease” in this repo (you will not — skip LEASE). Test: create draft v1, edit, v2 exists, v1 not overwritten (`documents.test.ts` already has a v1/v2 pattern — extend to families). |
| **4.10** | Scorers read `score_weight` from Studio | `scores/booking-readiness.ts` and `handover-readiness.ts` (and unit if it has constants) use in-code `WEIGHTS`. Load effective `score_weight` rows (table already in Studio generic editor). Test: change a weight, recompute; value moves. Fallback if no rows: keep current constants as **seeded** `score_weight` data, not as live code constants. |
| **2.12** | Plan vs forecast vs actual non-zero on ≥2 occupants | `delay_reason` demo seed is empty; leftover skipped inventing SOP. **Allowed now:** seed **catalog** `delay_reason` rows (Studio table — labels/categories, not day counts) then `createPlanRevision` on **two existing** journeys (Karthik BK-V110 and Nisha BK-MT201 preferred). Shift `planned_end` via the handler so timeline plan ≠ baseline. Do not SQL-fake three identical timestamps. Do not invent East Crest durations. If forecast is a separate column and still equals plan, use the existing forecast-revision handler if one exists; otherwise report that under Assumptions and still prove plan ≠ baseline actual/plan on two journeys. |

---

## How to build 4.1b (do not invent a second pool)

`wrapWithRls` does `inner.query(SET ROLE)` then `inner.query(sql)` then `RESET ROLE`. PGlite is one session so tests pass. `createPgClient` uses `pool.query` per call → **two clients** → RLS inert on RDS.

Fix inside `pg-adapter.ts` (and only as needed `rls-port.ts`): checkout one client for the actor query (or make non-transaction `query`/`exec` use `pool.connect()` + try/finally `release`, applying SET ROLE on that client). `transaction()` already pins a client — keep that. Do not wrap every call in a second `BEGIN` if `withTx` already opened one (PGlite nested tx still hangs).

---

## Invariants

1. No `INSERT INTO booking` for occupants. Do not rewrite Phase 1/2/leftover seed except 2.12 plan revision + delay_reason **catalog**.
2. Do not book V101 / V104 / V108.
3. Do not invent SOP days/charges. Catalog codes and matrix bands are config.
4. GET 360 / scores must not newly persist snapshots on every read (`explain*` / existing persist-on-change only).
5. No new npm packages without asking in this chat.
6. Handlers stay Express-free. Files ≤200 lines.
7. Playwright: `page.locator("main")`; `{ exact: true }` on Save / Accept / Send / Claim.
8. Do not create `studio/ActionTypes.tsx`. Do not start a chatbot. Do not generate PDFs via Chromium inside `initDb`/`seed()`.

---

## Allowed files

- `services/api/src/db/pg-adapter.ts`, `rls-port.ts` (4.1b only)
- `services/api/src/authz/entity-scope.ts` + id-taking handler/route files (4.2b)
- `services/api/src/commitments/**`, `services/api/src/seed/**` for `approval_authority_rule` / `delay_reason` / `score_weight` / document templates (not occupant bookings)
- `services/api/src/scores/**`
- `services/api/src/documents/**` (templates/families; no Chromium in seed)
- `services/api/src/qa/**` only if the exception list needs a thin read DTO
- `apps/workspace/src/pages/Queues.tsx` (minimal locator/a11y fixes only)
- `apps/workspace/e2e/queues.spec.ts` + a QA e2e if you add a screen
- `apps/workspace/src/components/SignaturePad.tsx` + handover API client
- `apps/workspace/src/pages/` QA / Studio only as needed
- `docs/demo/click-path.md` — queues, exception queue, file signatures, delay catalog
- `TODO.md` — CONTINUE HERE leftover + one Found while building bullet. Do not rewrite the status-board table.

Out of bounds: occupant rewrite, chatbot, infra/CDK, AWS, Phase 5 click-path walk as the whole product, new npm deps.

---

## Tests (fail first)

1. 4.1b: pg client pin (see table). Existing `rls-request.test.ts` still 13 pass on PGlite.
2. 4.4: Playwright claim + management reassign + empty + error, locators on `main`.
3. 4.6: commitment above band needs MANAGEMENT via `requiredApprovers`; constant gone; grep clean of in-code fallbacks.
4. 4.5: `action_type.label` change persists.
5. 4.7: updateChecklist / sign path stores a key matching `project/...`; body is not `data:image`.
6. 4.8: UI or API-wired screen lists `listQaExceptions` rows; site declaration ≠ QA verify (existing backend tests stay green).
7. 4.9: templates for the named families; v2 does not clobber v1.
8. 4.10: mutate `score_weight`, readiness number changes.
9. 2.12: two journeys where plan vs baseline (or forecast vs actual) differs; `delay_reason` catalog used.
10. Leftover occupants still present; spare pool unbooked.

Run `npm test` in `services/api` unsandboxed. Run the Playwright files you touch from `apps/workspace`. Real counts in the report. Fix red tests in this chat.

---

## Forbidden claims

- Do not mark 4.1b done because PGlite `rls-request.test.ts` still passes.
- Do not mark 4.4 done because Queues.tsx already has a Claim button — prove Playwright on `main`.
- Do not mark 4.5 done because the Studio tab renders.
- Do not mark 4.6 done while `COMMITMENT_MANAGEMENT_THRESHOLD_INR` exists.
- Do not mark 4.7 done if the DB column contains a data-URL.
- Do not mark 4.8 done because `qa.test.ts` already has rule 3.
- Do not mark 4.9 done with AOS + SALE_DEED only.
- Do not mark 4.10 done because Studio can edit `score_weight` rows the scorer never reads.
- Do not mark 2.12 done by writing the same timestamp three times.
- Do not start Phase 5 “because the suite is green”.

---

## Your last message MUST be exactly this shape

```
## Phase 4 rest report

### Accomplished
- 4.1b: [yes/no + one sentence]
- 4.2b: …
- 4.4: …
- 4.5: …
- 4.6: …
- 4.7: …
- 4.8: …
- 4.9: … (families seeded)
- 4.10: …
- 2.12: …

### Proof run
- Commands run (verbatim)
- API vitest: N passed / N failed
- Playwright files run: …
- Browser walk: done / not done / why

### Assumptions
Numbered. If none: `None.`

### Leftover still
IDs that are no. Phase 5 stays for after exams.

### Out of scope
Chatbot, AWS, Phase 5 full click-path, occupant rewrite.

### Files changed
Paths only.

### Known gaps vs 4.4–4.10 / 2.12 / 4.1b exit
```

If 4.1b, 4.4, or 4.6 is no, say the day is **not complete** for the must-do set. Later IDs may be no.

END PROMPT
