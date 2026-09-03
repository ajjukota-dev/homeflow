# Role · Management — Control Tower

**Module id:** `management` · **Depends on:** `foundation` + all roles · **Build order:** #8 (last)

Management does not want fifty charts. It wants **five problems that need intervention today** — a customer, cash, a handover, reputation, a margin — each ranked, with owner, rupee/customer impact, and the decision required. The Control Tower is *manage-by-exception*: it surfaces breached commitments, forecast slippage, and at-risk handovers, not raw task lists.

> Read alongside: [`handshakes.md`](../../foundation/handshakes.md) (H11 + decision pack), [`universal-action.md`](../../foundation/universal-action.md) (SLA ladder L4), [`HOMEFLOW-OS.md`](../../HOMEFLOW-OS.md) §11 (Control Tower) / §12 (KPI framework).

---

## Part 1 · Flow

### 1.1 What this role does

| Job | Outcome |
|---|---|
| See the five interventions | System-generated, ranked: **customer · cash · handover · reputation · margin.** |
| Drill on exception | Each intervention opens a decision pack (H11) → act, assign, or escalate. |
| Watch the portfolio | Roll-up across projects; drill Portfolio → Project → Unit → Booking. |
| Track KPIs | The §12 KPI framework by project/team/role — trends, not vanity metrics. |
| Govern | Approve configured exception overrides (never safety/statutory hard gates). |

### 1.2 The one question this role answers
> *"Where must I intervene to protect customers, cash, schedule, reputation, and margin?"*

### 1.3 The five-intervention flow (functional steps)

```
function buildControlTower(scope = authorized_projects):
  candidates = collectExceptions(scope):            # from H11 across all roles
     customer   ← sentiment breach, broken promise, escalation
     cash       ← true-risk spike, forecast slippage, big overdue
     handover   ← at-risk / blocked handover in next 30/60/90d
     reputation ← complaint cluster, NPS drop, repeat defect going public
     margin     ← leakage (rework/concession/delay), contribution erosion
  for each category: pick the TOP-ranked item by impact(rupee, customer, urgency)
  return exactly 5 interventions, each with:
     { what_happened, impact{customer,rupee,schedule,reputation},
       owner, dependencies, recommended_decision, evidence_links }   # the decision pack
```

Ranking is transparent and rule-first (impact × urgency × recovery-window). AI may refine ranking but **cannot hide drivers**.

### 1.4 Gates: reads vs owns

| Gate | This role |
|---|---|
| All gates | **Read** (roll-up view). |
| Configured exception overrides | **Owns** (authority-controlled) — **never** safety/statutory hard gates. |

### 1.5 Hard rules
1. **Five interventions, not fifty charts** — the tower always resolves to the ranked five.
2. Every intervention carries a **decision pack** (H11) — no raw alert without context.
3. Management sees **only material exceptions** above configured thresholds (no noise).
4. Overrides require named authority + reason + evidence; safety/statutory gates reject override.
5. Everything drills to the contributing Unit/Booking — no dead-end numbers.

---

## Part 2 · Data Flow

### 2.1 Twin surface
**Read-only roll-up** across both twins and all role entities. Writes only override/decision records.

### 2.2 Entities owned
- **Intervention** — `id, category{customer|cash|handover|reputation|margin}, rank, decision_pack(json), owner_id, status{open|acted|assigned|escalated|closed}, project_id, created_at`.
- **OverrideDecision** — `id, gate_ref, authority_id, reason_code, evidence_ids[], outcome, timestamp` (for authority-controlled overrides).
- **KpiSnapshot** — periodic derived KPI values by dimension (read model), never a source of truth.

### 2.3 KPI framework (§12) — read models rolled up

Hierarchy: **Portfolio → Project → Phase/Tower/Block → Unit**; org: Portfolio → Team → Role → Owner. **Project is a mandatory dimension.**

| Domain | Core KPIs |
|---|---|
| Customer experience | NPS, CSAT, response SLA, sentiment trend, escalation rate, referral rate |
| Commitments | on-time %, pre-breach recovery %, broken promises by root cause |
| Finance | collection efficiency, overdue %, true-risk amount, forecast accuracy, PTP conversion |
| Legal/registration | agreement TAT, deviation TAT, registration readiness/predictability |
| Quality | first-pass QA, critical/repeat snag rate, closure TAT, rework cost |
| Handover | predictability, on-time %, first-time-right %, hard-gate overrides |
| Operations | SLA compliance, action ageing, reassignments, dependency delay, queue health |
| Profitability | concession leakage, rework, delay cost, compensation, cost-to-serve, margin erosion |
| Customer changes | request-to-feasibility TAT, quote TAT, approval conversion, post-freeze %, variation margin |
| Changeability | % units with fresh gate data, gate forecast accuracy, match conversion, hold conversion |
| Journey health | on-track/at-risk/overdue, bottleneck stages, cycle time, plan-vs-forecast-vs-actual variance |

### 2.4 APIs

```
GET  /projects/{id}/control-tower                    → the five ranked interventions + decision packs
GET  /portfolio/control-tower                        → portfolio roll-up (authorized projects)
POST /interventions/{id}/act | /assign | /escalate   → dispositions
GET  /portfolio/kpis?domain=&dimension=&period=      → KPI read models with drill-down
POST /overrides                                      → authority-controlled override (+ reason/evidence)
GET  /portfolio/cashflow                             → project + portfolio forecast roll-up (from accounts)
```

### 2.5 Handshakes

| id | Direction | This role's part |
|---|---|---|
| **H11** | ← any role | **Consumes.** Escalations/exceptions with decision packs feed the five interventions. |
| (reads) | ← accounts | Project cash-flow + true-risk roll-up. |
| (reads) | ← qa | Handover risk, critical/repeat snags. |
| (reads) | ← crm-rm | Customer health, sentiment, broken commitments. |

### 2.6 Events emitted
`escalation.created/upgraded/recovery_plan.created/closed` (dispositions) · `gate.overridden` (with authority) · KPI snapshot generation events.

### 2.7 Lenses (§11 Control Tower)
Portfolio · Cash · Project Cash Flow · Project Performance · Experience · Execution · Profitability — each a drill-down lens, all resolving up to the five interventions.

---

## Part 3 · UI/UX

Applies [`design-language.md`](../../foundation/design-language.md) — **workspace skin**, but deliberately **sparse**: five cards, not chart walls.

### 3.1 Screens
- **A · Control Tower (landing)** — **exactly five** `Intervention` cards (customer/cash/handover/reputation/margin), each: headline, impact (₹ + customer), owner avatar, recommended decision, one-click act/assign/escalate. This is the whole point — calm, ranked, decisive.
- **B · Decision Pack** — expand an intervention: what happened, impact, dependencies, actions already taken, evidence links, recommended decision.
- **C · Portfolio Roll-up** — projects with health/cash/handover/experience/execution/profitability; drill Portfolio → Project → Unit → Booking.
- **D · Project Cash Flow** (from accounts) — current-month actual, next-month forecast, 90-day, prior actual, variance, confidence, portfolio total.
- **E · KPI Explorer** — the §12 framework; trends + root cause; every metric drills down. No decorative badges — each KPI is explainable.

### 3.2 Homely touches
Even management stays human: interventions name the **customer and the home** ("The Nairs, Villa V104 — handover slipping, they've been patient"), not just a metric — keeping leadership connected to real families, not abstractions.

### 3.3 Confidentiality & authority
Full internal visibility (this is leadership) but sensitive financial fields still respect field-level role masking; overrides are logged immutably; safety/statutory hard gates are rejected at the API regardless of role.

---

## Part 4 · Acceptance tests (role-scoped)

1. Management identifies the top five portfolio interventions **without navigating multiple reports**. (#8)
2. Each intervention carries a decision pack (what/impact/dependencies/recommended decision/evidence). (§11, H11)
3. Every forecast and operational figure drills Portfolio → Project → Unit → Booking with no duplicate project tagging. (#9)
4. Management can view last-period actual, current actual-to-date, next-month and 30/60/90-day forecast by project + portfolio. (#11)
5. A configured override is authority-controlled, logged with reason/evidence; safety/statutory hard gates cannot be overridden by any role. (#5, #27)
6. Only material exceptions above threshold reach the tower — no noise. (§13 notification rules)
7. KPIs are explainable (drivers/trend), never decorative badges. (§11)
