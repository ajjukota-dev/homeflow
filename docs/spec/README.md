# HomeFlow 2.0 — Build Specification

This is the **build contract** for HomeFlow 2.0, Pranava's post-sales operating system for residential villas and apartments. It is written so a coding agent can build the system autonomously, slice by slice, to a production-ready standard.

- **Product story:** [`../CONTEXT.md`](../CONTEXT.md)
- **Full structured spec (the "what"):** [`../HOMEFLOW-OS.md`](../HOMEFLOW-OS.md)
- **Source of truth (design):** [`../Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`](../Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf)
- **This directory (the "how to build"):** `docs/spec/`

> `HOMEFLOW-OS.md` describes the product. **This spec set describes how to build it** — data model, APIs, handoffs, screens, and the exact contracts an agent needs to write code without guessing.

---

## Stack (fixed)

| Layer | Choice |
|---|---|
| Frontend | **React** (web app, Webpack), TypeScript |
| Backend | **AWS** — serverless-first (see [`foundation/architecture.md`](foundation/architecture.md)) |
| API | REST + JSON, versioned (`/api/v1`), OpenAPI-described |
| Data | PostgreSQL (Aurora) as system of record; event log append-only |
| Auth | Cognito + role/project-scoped access (RLS) |

Full detail: [`foundation/architecture.md`](foundation/architecture.md).

---

## How this spec set is organized

```
docs/spec/
├── README.md                     ← you are here: index, build order, conventions
├── foundation/                   ← shared base. Every role reads this.
│   ├── vocabulary.md             ← canonical terms (read first)
│   ├── data-model.md             ← Project / Booking / Applicant + relationships, keys, RLS
│   ├── unit-twin.md              ← ★ Unit Digital Twin — the physical noun
│   ├── customer-twin.md          ← ★ Customer Digital Twin — the relationship noun
│   ├── universal-action.md       ← the one Action object all work normalizes into
│   ├── gates.md                  ← 5-state changeability + hard/soft handover gates
│   ├── handshakes.md             ← ★ single source of truth for role-to-role handoffs
│   ├── customer-transparency.md  ← ★ Owner Transparency Surface (T1–T6 customer-facing views)
│   ├── event-log.md              ← audit/event taxonomy + envelope schema
│   ├── design-language.md        ← homely, warm, image-rich UI system (all roles inherit)
│   └── architecture.md           ← AWS + React target architecture
└── roles/                        ← one folder per role (built after foundation)
    ├── project-site/
    ├── sales/
    ├── crm-rm/
    ├── accounts/
    ├── legal/
    ├── qa/
    ├── post-handover/
    ├── customer/
    └── management/
```

Each **role** folder contains one `spec.md` with three sections:

1. **Flow** — what the role does, its states, which gates it *reads* vs *owns*.
2. **Data Flow** — entities touched, twin surface (read/write), API contracts, handoff payloads in/out, events emitted.
3. **UI/UX** — clickable screens, what shows where, applying `design-language.md`.

---

## The nouns vs the verbs

The single most important idea in this spec:

- **Twins are nouns** — permanent data records. `unit-twin.md` and `customer-twin.md` define them once.
- **Roles are verbs** — people who read or write *parts* of a twin. A role never owns its own copy of a twin.

This is "one truth, many views." If two role specs ever disagree about a twin field or a handoff payload, **`foundation/` wins** — the role file is wrong and must be corrected.

---

## Capability map & build order

| # | Module id | Responsibility | Depends on |
|---|---|---|---|
| 0 | `foundation` | Data model, twins, Universal Action, gates, handshakes, events, design, architecture | — |
| 1 | `project-site` | Owns Unit Twin physical truth; source of changeability gate data | foundation |
| 2 | `sales` | Reads changeability, requirement-to-unit match, holds, booking creation | foundation, project-site |
| 3 | `crm-rm` | Booking acceptance gate, Customer Twin, promise ledger, comms, orchestration | foundation, sales |
| 4 | `accounts` | Collections true-risk, demands, loans, forecast snapshots | foundation, crm-rm |
| 5 | `legal` | Legal Document Factory, clause library, agreements, registration | foundation, crm-rm |
| 6 | `qa` | Unit readiness scoring, snagging, evidence-based completion, handover gate feed | foundation, project-site |
| 7 | `qa` | (also owns the physical/quality handover gate + eligibility declaration) | foundation, project-site |
| 8 | `post-handover` | Warranty/DLP, service history, Home Passport, 7/30/90 check-ins, referral (§8.14) | foundation, qa, crm-rm |
| 9 | `customer` | My Pranava Home portal — aggregates approved views | foundation, crm-rm, accounts, legal, qa, post-handover |
| 10 | `management` | Control Tower — 5 ranked interventions, KPIs | foundation + all |

**Build order:** `foundation` → `project-site` → `sales` → `crm-rm` → (`accounts` ‖ `legal` ‖ `qa`) → `post-handover` → `customer` → `management`

`handover` is not a separate module: it is a gated readiness *event* owned jointly by `qa` (physical/QA gates) and `crm-rm` (finance/legal/registration convergence), surfaced as a Handover Team view. The lifecycle *after* keys (warranty, service, passport) is owned by `post-handover`.

---

## Document conventions

- **Field tables** use: `field` · type · required? · who writes · notes.
- **Types** are language-neutral (`string`, `uuid`, `enum{...}`, `money`, `timestamp`, `int`, `decimal`, `json`, `ref<Entity>`). The agent maps these to Postgres + TypeScript.
- **`money`** = `{ amount: decimal, currency: 'INR' }`. All money is INR unless stated.
- **`timestamp`** = ISO-8601 UTC. Display timezone is `Asia/Kolkata`.
- **Enums** are written inline `enum{ A | B | C }` and mirror Appendix A of `HOMEFLOW-OS.md`.
- **★** marks a headline/authority file — if in doubt, it wins.
- **API contracts** are written as `METHOD /path` with request/response shape. Full OpenAPI is generated during build, not hand-written here.
- **"MUST / MUST NOT / SHOULD"** carry RFC-2119 weight. MUST = acceptance-test-enforced.

---

## The five feature tests (apply to every spec decision)

Before any field, screen, or endpoint is added, it must pass at least one:

1. Improve customer trust?
2. Eliminate chasing?
3. Expose accountability?
4. Predict earlier?
5. Protect / improve margin?

For unit customisations, a sixth: does it preserve permanent as-built truth while protecting schedule and margin? If none apply — do not build it.

---

## Status

| Module | Spec status |
|---|---|
| `foundation` (12 files incl. transparency surface) | ✅ complete |
| `project-site` | ✅ complete |
| `sales` | ✅ complete |
| `crm-rm` | ✅ complete |
| `accounts` | ✅ complete |
| `legal` | ✅ complete |
| `qa` | ✅ complete |
| `post-handover` | ✅ complete |
| `customer` | ✅ complete |
| `management` | ✅ complete |

**All 8 role specs + foundation are written.** Each role file has Flow / Data Flow / UI-UX + role-scoped acceptance tests. Next phase: review, then implementation (Plan → Tasks → Build) in the documented build order.
