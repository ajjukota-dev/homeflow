# New-chat prompt — HomeFlow bugs (25 Sep 2026)

Copy everything below the line into a **new** chat. Open this repo as the workspace first.

**Workspace must be:** `/Users/lakshmiprajnapenmetsa/ExaverAI/HomeFlow`  
Not PayFlow. Not PranavaLeasing.

---

You are implementing the **HomeFlow 23 Sep bug list** in this repo. Workspace: `/Users/lakshmiprajnapenmetsa/ExaverAI/HomeFlow`.

Read first:

1. This file.
2. `docs/handover/BUGS-2026-09-SCOPE.md` (waves, items, repo findings, locked defaults).
3. `HANDOFF.md` — local URLs, demo login, do not treat the old App Runner URL as this product.
4. Source list (owner walk): `/Users/lakshmiprajnapenmetsa/Desktop/homeflow-bugs.md.txt`

I am the decision-maker. Locked defaults below are already signed. Do not ask the team for production frontend URLs, journey-rule inventories, or whether the old warranty HTTP close should come back — those were looked up in this repo.

**Spend:** do not `cdk deploy`. Ask before paid APIs / AWS. Local only unless I say yes.

**Local:** API `:3001`, workspace `:5173`, portal `:5174`. Demo password `Demo@2026`. Reset: stop API first, then `npm run db:reset` in `services/api`.

Implement **one wave at a time**. Start with **wave A**. Check, then the next. Do not fake statuses or empty actions.

## Waves

| Wave | Bugs | What |
| --- | --- | --- |
| **A** | 1, 5, 10, 9 | Project isolation, customer field leak, CORS, reset throttle |
| **B** | 8, 6, 11 | Scheduler lock, one URL owner, migration not edited in place |
| **C** | 2, 7 | Plan change updates forecast; queues show names |
| **D** | 3, 4 | Journey AT_RISK only from real data; action auto-close subscriber |
| **E** | 12 | CI green; do not deploy |

## Out of this pass

Google sign-in, customer OTP, unbuilt Studio screens, customer **Action Required** screen (`apps/my-pranava-home` has no such page), fake AT_RISK, placeholder actions, a full forecast-revision product (only the plan→forecast link in bug 2).

## Locked defaults (do not reopen)

- **CORS:** `origin: true` is in `services/api/src/server.ts`. Dev allow-list `http://localhost:5173` and `http://localhost:5174`. Prod: `ALLOWED_ORIGINS` env (empty until deploy). Vite already proxies `/api` so local browsers are same-origin. Unknown origin: no credentialed CORS. This `main` is **not** deployed; `https://we947t2rq2.ap-south-1.awsapprunner.com` is old R0 — ignore it.
- **AT_RISK:** `deriveStatus` exists but callers pass `atRisk: false` (`journey/instances.ts`, `task-detail.ts`). Do not show AT_RISK until it is computed (blocked / forecast > plan / dep overdue). After bug 2.
- **Actions:** Many modules already `createAction` in-process. Missing piece is spec 10 **rule 7** — subscriber that auto-closes an action when the source closes. Escalations already listen to `action.closed`. Do **not** build the customer Action Required screen.
- **Warranty close:** Spec 30 handler is the HTTP owner (`registerPostHandoverRoutes` first). Legacy `POST /api/warranty-cases/:id/close` in `routes-lifecycle.ts` is intentionally unreachable. **Delete that dead route.** Keep `closeWarranty()` for `lifecycle.test.ts` if tests call it directly. Do not bring the old HTTP close back.
- **Documents:** `registerDocumentRoutes` then lifecycle; spec 22 calls `next()` for the old body. Fold into one owner or delete the unused legacy path.
- **Reset throttle:** Same response whether the email exists. ~5 / hour per IP+email. Tokens still 1 hour.
- **Scheduler:** `scheduler/start.ts` has no lock. If `runOnce` is still running, **skip** the next tick.
- **Customer fields:** `portal/denylist.ts` is exact-name (+ `forecast_` prefix). `vendor_contact` is **not** blocked; portal Passport still renders it. Fix so close names cannot leak. Test that would have caught `vendor_contact`.
- **Project scope:** `assertProjectScope` exists (`authz/scope.ts`). Some routes only `requireRole`. Put project checks on every project-data read/write. Management / Super Admin still see all.
- **CI:** Fix the pipeline in repo. Do not `cdk deploy`.

## When a wave is done

Tests for that wave. `session_changes` or a short note in the PR. Then the next wave. Tell me what you could not verify.

Do not start a different product. Do not reopen PayFlow.
