# Role · QA / Handover

**Module id:** `qa` · **Depends on:** `foundation`, `project-site` · **Build order:** #6 (parallel-eligible with `accounts`, `legal`)

QA replaces subjective "90% done" with **evidence-based readiness** — checklists, photos, tests — and runs snagging from discovery to *verified* closure with root cause. It owns the physical/quality half of the handover gate. Keys only go out when the flat is *provably* ready.

> Read alongside: [`unit-twin.md`](../../foundation/unit-twin.md) (QA evidence, snags, handover), [`gates.md`](../../foundation/gates.md) (Part B), [`handshakes.md`](../../foundation/handshakes.md) (H9, H12), [`HOMEFLOW-OS.md`](../../HOMEFLOW-OS.md) §8.8/§8.9/§8.10.

---

## Part 1 · Flow

### 1.1 What this role does

| Job | Outcome |
|---|---|
| Verify readiness | Component checklists with mandatory photos/tests/certificates; independent QA verification. |
| Run snagging | Discovery → assign → rectify → QA verify → close, with root cause + repeat flag. |
| Score readiness | Unit Readiness derived from **evidence**, not typed %. |
| Feed handover | Physical + Quality hard-gate inputs; declare handover eligibility (H9). |
| Complete handover | Walkthrough checklist, keys/meters/manuals, then hand to post-handover (H12). |

### 1.2 The one question this role answers
> *"Which villas are actually eligible for keys, and which snag is still critical?"*

### 1.3 The readiness + handover flow (functional steps)

```
function evaluateUnitReadiness(unit_id):
  for each component in ComponentDefinition(unit):
     checklist = QAChecklist(component)
     require mandatory evidence (photos/tests/certificates)
     siteDeclares(state) ; qaVerifies(state)      # two SEPARATE states
  readiness_score = weighted(verified components, statutory/common-area deps, open snags)
  return explainable(readiness_score, drivers)

function evaluateHandoverEligibility(booking_id):     # H9
  physical = readiness ≥ threshold AND utilities available AND no safety-critical open
  quality  = QA approved AND critical_snags == 0 AND minor_snags within policy
  if physical AND quality:
     emit unit.readiness.reached → contribute to Handover Readiness Score
     if ALL hard gates pass (physical, quality, + financial[H7], legal[H8], commitments):
        handover.eligibility.reached → open appointment workflow
     else handover.blocked(list blockers)
```

Snagging:
```
function snag(...): Open → Assigned → In Progress → Ready for QA → (QA Verified | Reopened) → Closed
  each with before/after evidence; critical severity blocks handover; repeat flag + cost captured
```

### 1.4 Gates: reads vs owns

| Gate | This role |
|---|---|
| Handover **Physical** + **Quality** hard gates | **Owns.** Safety-critical physical items never overridable. |
| Handover overall eligibility (H9) | **Declares** when its gates pass; convergence with finance/legal owned with `crm-rm`. |
| Changeability gates | read (QA verification can advance a component's state feeding gates). |

### 1.5 Hard rules
1. Readiness comes from **evidence**, never a typed percentage.
2. **Site declaration and QA verification are separate states** — QA is independent.
3. **Zero critical snags** to be handover-eligible; minor snags within policy only.
4. Safety-critical physical items are **never** overridable.
5. Every snag closure needs before/after evidence + QA verification (customer verification where appropriate).

### 1.6 States
- Snag: `Open → Assigned → In Progress → Ready for QA → Reopened → Verified → Closed`.
- Handover: `Not Eligible → At Risk → Eligible → Appointment Booked → In Progress → Completed → Reopened`.
- Unit readiness component: `passed / failed / reverified`.

---

## Part 2 · Data Flow

### 2.1 Twin surface

| Twin layer | Access |
|---|---|
| Unit Twin · QA evidence | **write** |
| Unit Twin · Snag history | **write** |
| Unit Twin · Handover evidence | **write** (with crm-rm) |
| Unit Twin · Home Passport | write (as-installed equipment/finishes) |
| Unit Twin · construction progress | read (project-site owns) |

### 2.2 Entities owned
- **QAChecklist** — `id, component_id, items[{ label, mandatory_evidence_type }], project_config`.
- **QAEvidence** ([`unit-twin.md`](../../foundation/unit-twin.md) §2.5) — result, photos, test certificates, inspector, `is_independent_verification`.
- **Snag** ([`unit-twin.md`](../../foundation/unit-twin.md) §2.6) — severity, location, trade, vendor, root_cause_code, before/after photos, is_repeat, rectification_cost, sla_due_at.
- **ReadinessScore** — `unit_id, value, drivers[], computed_at` (explainable, derived).
- **HandoverRecord** ([`unit-twin.md`](../../foundation/unit-twin.md) §2.8) — readiness snapshot, meter readings, keys, manuals, signatures, appointment ref, final photos.

### 2.3 APIs

```
# Readiness & QA
GET  /units/{id}/readiness                           → score + drivers (explainable)
POST /units/{id}/qa/{component}/verify                → independent QA verify (+ evidence)
GET  /units/{id}/qa/exceptions                        → failed/repeat inspections

# Snagging
POST /snags                                           → create (severity, location, trade, vendor)
POST /snags/{id}/assign | /rectify | /verify | /reopen | /close
GET  /projects/{id}/snags/analytics                   → by contractor/trade/root-cause/cost

# Handover
GET  /bookings/{id}/handover/readiness                → Handover Readiness Score + blockers + predicted date
POST /bookings/{id}/handover/declare-eligible         → H9 (physical+quality pass)
POST /bookings/{id}/handover/appointment              → schedule
POST /bookings/{id}/handover/complete                 → checklist done → H12
```

### 2.4 Handshakes

| id | Direction | This role's part |
|---|---|---|
| **H9** | → crm-rm/handover | **Emits.** Readiness + physical/quality gate pass → eligibility (needs all hard gates to open keys). |
| **H12** | → post-handover | **Emits.** Handover completed → Home Passport finalized, warranty/DLP window opens, service history begins. |
| (feeds) | → customer via H10 | **T6** predicted keys window (approved by crm-rm); **T4** passport items. |
| (feeds) | → management H11 | Critical/repeat snags, at-risk handovers. |

### 2.5 Events emitted
`unit.readiness.component_passed/failed/reverified` · `unit.readiness.reached` · `snag.created/assigned/rectified/verified/reopened/closed` · `handover.eligibility.reached` · `handover.blocked` · `handover.appointment.booked` · `handover.completed`

### 2.6 AI (bounded)
**Quality root-cause** engine finds recurring defects/patterns (e.g. "waterproofing repeat rate concentrated with contractor X") → `ai_recommendation` Action. Does not close snags or override gates.

---

## Part 3 · UI/UX

Applies [`design-language.md`](../../foundation/design-language.md) — **workspace skin**, **photo-forward** (evidence is the point). Uses `PhotoGrid` / `BeforeAfter`.

### 3.1 Screens
- **A · Unit Readiness** — component tree with evidence status; **ScoreDial** (value + drivers, no bare %); exception queue for failed/repeat.
- **B · Snagging Board** — Kanban by state; each snag card photo-forward with severity chip, trade, SLA; before/after capture; repeat + cost flags.
- **C · Handover Readiness** — the convergence view: physical/quality (owned) + finance[H7]/legal[H8]/commitments status; **predicted keys date + confidence**; blocker list; declare-eligible when gates pass.
- **D · Handover Day Checklist** — keys, meters, manuals, warranties, signatures, photos; appointment-led; completes to Home Passport.
- **E · Snag Analytics** — by contractor/trade/project/root-cause/cost (feeds vendor learning + management).

### 3.2 Homely touches
Handover Day is a **warm milestone** (the one tasteful "welcome home" moment in [`design-language.md`](../../foundation/design-language.md) §3.5) — a guided walkthrough, family moment, digital Home Passport handed over, not a form.

### 3.3 Confidentiality
Internal readiness %, QA/snag detail, hard-gate blockers never cross to the customer — only the approved **T6** window + their own to-dos, via crm-rm/H10.

---

## Part 4 · Acceptance tests (role-scoped)

1. Readiness is derived from evidence (photos/tests), not a typed percentage. (§8.8)
2. Site declaration and QA verification are separate states; QA is independent. (§8.8)
3. A unit cannot be handover-eligible with any critical snag open. (§8.10)
4. Handover eligibility (H9) requires all hard gates; override needs named authority + reason; safety items never override. (#5, gates B)
5. Every snag closure has before/after evidence + QA verification. (§8.9)
6. Repeat defects are flagged and surface in analytics by contractor/root-cause. (§8.9)
7. Handover completion (H12) finalizes Home Passport and opens the warranty window. (§8.14)
8. The predicted keys view to the customer shows a window + their own to-dos only. (T6)
