# Specs — the build contract

One file per feature (index in `TODO.md §10`). Each is written so an agent can build it **without asking**: data model, rules, API, screens, acceptance tests, dependencies, what not to build. Requirement authority is the client PDF (`docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`, cited as `pNN §X`). Seed values marked **[E]** come from `docs/reference/emergent-business-rules.md` — Pranava's own decisions as encoded in their earlier app; they are editable defaults in Policy Studio, never code constants. Anything marked **[ours]** is an engineering choice.

`docs/spec/**` and `docs/HOMEFLOW-OS.md` are legacy (AI-derived, unreviewed). Where these files and those disagree, these win.

## Conventions every workstream follows

| Topic | Rule |
|---|---|
| Stack | TypeScript strict, Express handlers Express-free (plain `(input, ctx) => result`), React + Vite + Tailwind tokens, Vitest, Playwright. No `any` without a comment saying why. Files ≤ 200 lines. |
| Database | PostgreSQL. Local dev: PGlite persisted to `./.data/pglite` **[ours]**; tests: PGlite in-memory, one DB per test file; prod: RDS via `pg`. One `db` port (`query(sql, params)`), SQL migrations in `services/api/migrations/NNNN_name.sql`, applied by `npm run migrate` and on API boot. Field names `snake_case`. Money `numeric(14,2)` INR. Times `timestamptz`; calendar dates `date`. |
| Identity | Every table that belongs to a project carries `project_id` **derived** from Unit/Booking, never user-supplied (p36 §31.1). Every write goes through `ctx.actor` (user id + roles + authorized project ids). |
| Codes | Human ids `PREFIX-000001` from a per-prefix sequence **[E]**: `CUS-`, `BKG-`, `UNT-`, `ACT-`, `CMT-` (commitment), `COM-` (communication), `CR-` (change request), `SNG-`, `ESC-`, `DOC-`, `REG-`, `LN-`, `HO-`. |
| Events | Every consequential mutation appends to `event` (workstream A) with the Appendix B taxonomy (p42). Append-only. No hard deletes of financial/legal/commitment/spec history — `status = 'cancelled'` + reason. |
| Dates | "Today" = IST calendar day via one `todayIst()`; project working-day calendar (F) for SLA math. Never `new Date().toISOString().slice(0,10)`. |
| Errors | `{ code, message, field?, source_ref? }`. `validation` → 400, `forbidden` → 403, `not_found` → 404 (also for rows outside the actor's project scope **[E]**), `conflict` → 409, `gate_blocked` → 422 with `blockers[]`. |
| Status vocabularies | Appendix A (p41–42) verbatim for Action, Change Request, Commitment, Document, Snag, Handover. `SCREAMING_SNAKE` in code (`HARD_CLOSED`), human labels via `apps/workspace/src/lib/labels.ts`. |
| Demo data | Each feature's seed extends `seed/demo-*.ts` only as far as its own screens need to show every state (e.g. bookings across all journey stages, a commitment per status, an overdue demand with reason, a CR per state). Numbers must reconcile (demands = agreement value, receipts ≤ demands, forecast = outstanding) — journeys assert it. Existing data that already covers a state is left alone. |
| No dead ends | A nav entry, button or tab appears only when its feature is merged and its journey is green. Unbuilt features are listed on Management → Roadmap (27) with spec + PDF refs — never as greyed controls. |
| Config over code | Anything the PDF lists in §21 Policy Studio (p26–27) is a table with `effective_from/effective_to`, `version`, `changed_by`, never a constant. Seed via `services/api/src/seed/*.ts`, one file per config family. East Crest values live only in `seed/demo-east-crest.ts`. |
| UI | Everything comes from `packages/ui` per `32-design-system.md`: tokens only (lint-enforced), Geist/Newsreader self-hosted, 4 px spacing scale, one authored motion moment per surface, seven control states, loading/empty/error on every list; WCAG AA via axe in E2E; screenshots at 1440/768/375 reviewed before merge; no purple/indigo, no glass, no filler text, no eyebrows, no ghost cards. One `h1` per page. Read `~/claude-setup/reference/impeccable/README.md` + `craft-floor.md` before any UI work. |
| Clean code | ESLint (strict TS rules, no unused, no floating promises, token rule) + Prettier as CI gates; `knip` for dead exports; handlers pure and ≤ 200 lines; one module = one reason to change; names from the PDF's vocabulary; comments say *why* and cite the spec section. |
| End-to-end testing | Every feature ships `apps/*/e2e/<feature>.spec.ts`: a Playwright **journey** that drives the real UI against the API with seeded data (not mocks) at 375 and 1440, asserts the feature's acceptance items, takes screenshots and a trace. Cross-feature journeys live in `e2e/journeys/` (e.g. `sale-to-handover.spec.ts`). After every deploy the same journeys run against the App Runner URL as smoke. Claude reviews screenshots/traces before merging — unit tests alone never close a feature. |
| Explainability | Every score/flag exposes `value, trend, drivers[3], confidence, actions[]` (p8 §6). No number without a "why". |
| Product awareness | `product_type ∈ {APARTMENT, VILLA, PLOT}` on Project (default for units) and Unit; templates, change categories, checklists and readiness components are keyed by product type. Plots have no interior components. |

## Definition of done (per PR)

1. Failing test first for every rule below the "Rules" heading; `npm test` green in `services/api`, `apps/workspace`, `apps/my-pranava-home`; `tsc` 0 errors, ESLint 0 errors, `knip` clean everywhere.
2. Acceptance tests listed in the spec exist as automated tests, named after their PDF reference (e.g. `p35-30.5-t4`).
3. The feature's Playwright journey passes at 375 and 1440 with axe clean; screenshots committed under `e2e/__screenshots__/` and reviewed against `craft-floor.md` "Verify"; the review note is in the PR.
4. Migration is additive and applied on boot; seed updated; demo data still loads.
5. Events emitted and asserted for every mutation named in the workstream's Events list.
6. `TODO.md` §0 status board and §9 record updated; `docs/demo/run-log.md` gets an entry (what landed, evidence, deviations, open issues); `docs/demo/click-path.md` reflects the deployed state; anything found while building and new client questions logged.

## Spec file layout

Every `NN-feature.md` has the same headings so agents and reviewers know where to look: **Purpose** (PDF words + refs) · **Data** (tables/columns; migrations additive) · **Rules** (numbered; each becomes ≥1 test) · **API** (handler signatures; Express-free) · **Screens** (workspace and/or portal; states) · **Events** (Appendix B names emitted) · **Config** (what lands in Policy Studio) · **Acceptance** (PDF tests by reference + rule tests) · **Depends on / Feeds** · **Files** (the only paths the agent may touch) · **Not in this feature**.

## Shared ports (defined in `03-platform-deploy.md`, used everywhere)

`db` (query/transaction), `events` (append), `files` (put/get presigned), `mailer` (send), `pdf` (render HTML → PDF), `clock` (nowIst/todayIst, injectable in tests), `llm` (complete/classify, provider-agnostic). Handlers receive `ctx = { db, events, files, mailer, pdf, clock, llm, actor }`.

## Actor and authorization (defined in `01-identity-access.md`)

`ctx.actor = { user_id, roles[], project_ids[] | 'ALL', display_name }`. Every handler calls `authorize(ctx, module, level)` first; project-scoped reads filter by `actor.project_ids`; reads of a row outside scope return `not_found`, writes return `forbidden` **[E]**.
