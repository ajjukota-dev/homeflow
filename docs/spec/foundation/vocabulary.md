# Foundation · Vocabulary

Read this first. Every other spec file uses these terms with **exactly** this meaning. If code, UI copy, or another spec uses a term differently, it is wrong.

The rule behind the vocabulary: **stable enterprise terms, configurable per-project wording.** "East Crest" names and durations are configuration, never code or type names.

---

## The four persistents (never mix)

| Term | Definition | Lives forever? |
|---|---|---|
| **Project** | A site (e.g. East Crest). Land + towers/villas + teams + policies. The operating partition — everything rolls up here. | Yes |
| **Unit** | One physical home (Villa V104 / Flat 8-12). Exists **before** it is sold. Keeps permanent history even if the buyer changes. | Yes |
| **Booking** | One customer(s) + one unit + one ownership period. The **bridge**. Commercial and lifecycle facts attach here. Cancel/transfer closes the Booking; the Unit survives. | Yes (as record; may be Cancelled/Transferred) |
| **Customer** | The person/family/entity. Relationship, money behaviour, docs, promises, comms, sentiment. | Yes |

> **Attachment rule:** a fact that belongs to a specific customer–unit ownership relationship attaches to the **Booking**, not directly to the Customer or the Unit. That is what survives cancellation, transfer, joint-ownership change, and resale.

---

## The two twins

| Term | Definition | Owned/written by | Read by |
|---|---|---|---|
| **Unit Digital Twin** | Live physical + spec truth of a Unit — progress, changeability gates, QA evidence, as-built config, snags, Home Passport. Detailed in [`unit-twin.md`](unit-twin.md). | `project-site` (physical), `qa` (quality) | `sales`, `crm-rm`, `customer`, `management` (read-only) |
| **Customer Digital Twin** | Relationship record — profile, bookings, financial behaviour, documents, commitments, comms, experience signals, consent. Detailed in [`customer-twin.md`](customer-twin.md). | `crm-rm` | `accounts`, `legal`, `customer`, `management` |

A twin is a **view over underlying entities**, not a duplicate store. No role holds its own copy.

---

## Hierarchy

```
Portfolio → Project → Phase / Tower / Block / Cluster → Floor → Unit → Booking → Customer/Applicant
```

Every downstream record carries a **derived `project_id`** for query, security (RLS), and roll-up. Users are never asked to pick Project when it can be derived from Unit/Booking.

---

## Changeability & gates

| Term | Definition |
|---|---|
| **Changeability** | Whether a Unit can still change a given category (kitchen, electrical, flooring…). Derived from **live unit physics**, not booking date or a project-wide cutoff. |
| **Change category** | A configurable unit of changeability (e.g. Kitchen Layout, Electrical Additions, Flooring Selection). Gates are per category, per unit. |
| **Gate state** | One of five: `OPEN → CLOSING → CONDITIONAL → EXCEPTION_ONLY → HARD_CLOSED`. Sales/CRM **read**, never edit. Detailed in [`gates.md`](gates.md). |
| **Gate rule** | Configurable rule mapping a physical/procurement event to a resulting gate state. |
| **Change Window Hold** | Time-boxed, Project-approved pause that keeps a closing gate open for a serious prospect. Auto-expires. |
| **Change Request (CR)** | A formal, governed request to change a Unit — feasibility, cost, schedule, quote, payment, released drawing. Not a comment or a WhatsApp promise. |
| **Hard gate** | A handover blocker (financial, legal, registration, QA, critical snag) that cannot pass without a named authority override + reason. Safety/statutory hard gates never override. |

---

## Work & time

| Term | Definition |
|---|---|
| **Action** | The universal work item. Every task, snag, approval, gap, delay, and AI recommendation normalizes into one Action object. Detailed in [`universal-action.md`](universal-action.md). |
| **My Day** | Per-employee ranked list of Actions with a plain-language "why now." Employees do not search for work. |
| **SLA** | Allowed service time for an Action (policy-driven). |
| **Plan** | When a record *should* occur per the Project journey. **SLA ≠ Plan** — computed independently. A task can be within SLA but late to plan. |
| **Baseline / Current plan / Forecast / Actual** | The four dates every timed record carries. Baseline is immutable (except controlled reset); revisions never overwrite history. |
| **SLA ladder (L0–L4)** | Escalation levels from "within SLA, dashboard only" (L0) to "critical, management decision pack" (L4). |
| **Journey Template** | The generic Pranava lifecycle each Project inherits. Stage durations, SLAs, owners, and customer wording are **data**, never code. |

---

## Money

| Term | Definition |
|---|---|
| **Demand** | A milestone-linked amount raised on a Booking. |
| **Receipt** | A reconciled incoming payment. |
| **Promise-to-Pay (PTP)** | A customer commitment to pay by a date. Affects forecast confidence; never becomes Actual until a reconciled Receipt. |
| **True risk** | The subset of outstanding that is genuinely at risk — separated from due, overdue, disputed, loan-dependent, and PTP. |
| **Forecast snapshot** | An immutable month-start (or as-of-date) forecast. Revisions are new versions; history is never overwritten. |
| **Contribution / leakage** | Planned margin vs current margin after discounts, waivers, rework, delay cost, cost-to-serve. |

---

## Promises & experience

| Term | Definition |
|---|---|
| **Promise Ledger** | Permanent ledger of every Pranava promise and every customer PTP — owner, due date, evidence, status. |
| **Commitment** | One entry in the Promise Ledger. States: `Draft → Approved → Active → At Risk → Fulfilled → Breached → Waived/Cancelled`. |
| **My Pranava Home** | The customer portal. Calm journey view. Never shows internal blame, vendor prices, or unapproved forecasts. |
| **Control Tower** | Management view — five ranked interventions (customer, cash, handover, reputation, margin), not fifty charts. |
| **Home Passport** | Permanent record of a Unit's equipment, serials, warranties, paint/tile codes, and service history. Lives with the Unit forever. |

---

## Governance

| Term | Definition |
|---|---|
| **System independence** | HomeFlow must run standalone. External CRM/ERP/construction/DMS/FM are optional adapters that must never dictate the domain model or block core workflows. |
| **Explainable score** | Any score (Unit Readiness, Customer/Booking Readiness, Handover Readiness, Customer Health, Financial Health) must show value, trend, top-3 drivers, and confidence. No decorative badges. |
| **Legal Document Factory** | Governed document generation from approved templates + clause library. Not free-form mail merge. |
| **Evidence over opinion** | Readiness/quality/handover derive from checklists, photos, tests — never typed percentages. |
| **Named authority override** | Any hard-gate override records who, why, and evidence. Immutable. |
| **Verification Required** | The state Sales/CRM see when unit physical data is stale past policy — instead of a falsely precise open/closed promise. |

---

## Role ids (used in `roles/` and `handshakes.md`)

`project-site` · `sales` · `crm-rm` · `accounts` · `legal` · `qa` · `post-handover` · `customer` · `management`

Where the spec references authority: **Project/Design own unit physics and gate rules; Sales/CRM read them. Finance owns forecast amounts; CRM updates promise signals only. Legal owns final document wording.**
