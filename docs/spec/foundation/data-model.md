# Foundation · Data Model

The canonical relational model. This is the **system of record** — twins ([`unit-twin.md`](unit-twin.md), [`customer-twin.md`](customer-twin.md)) are views composed from these entities plus their sub-tables.

Store: **PostgreSQL (Aurora)**. All money in INR. All timestamps ISO-8601 UTC. All ids are `uuid` (v7, time-sortable) unless noted.

---

## 1. Entity relationship overview

```
Portfolio (implicit: the org)
   │
   ▼
Project ──< ProjectHierarchyNode (Phase/Tower/Block/Cluster/Floor, self-nesting)
   │            │
   │            ▼
   │          Unit ──────────────< UnitProgressState, UnitChangeGate, QA evidence,
   │            │                   Snag, HomePassportItem, AsBuiltRevision  (see unit-twin.md)
   │            │
   │            ▼
   │          Booking ──< BookingApplicant >── Customer  (many-to-many via applicants)
   │            │                                  │
   │            │                                  ▼
   │            │                          (Customer Twin sub-tables: see customer-twin.md)
   │            ▼
   │          Demand, Receipt, LoanCase, ChangeRequest, GeneratedDocument,
   │          Commitment, Communication, Escalation, JourneyInstance
   │
   ▼
Team ──< ProjectTeamAssignment >── UserRoleAssignment ── User
```

Every entity below **Project** carries a derived, immutable-once-set `project_id`.

---

## 2. Core entities

### 2.1 Project

The operating partition.

| field | type | req | writes | notes |
|---|---|---|---|---|
| `id` | uuid | ✔ | system | |
| `code` | string | ✔ | admin | Short unique code, e.g. `EASTCREST`. |
| `name` | string | ✔ | admin | Display name. |
| `product_type` | enum{ villa \| apartment \| plotted \| office } | ✔ | admin | Drives template defaults. |
| `legal_entity` | string | ✔ | admin | Selling entity — used by Legal Document Factory. |
| `jurisdiction` | string | ✔ | admin | State/SRO jurisdiction. |
| `journey_template_version_id` | ref<JourneyTemplateVersion> | ✔ | admin | The active journey config. |
| `status` | enum{ planning \| active \| selling \| handover \| closed } | ✔ | admin | |
| `calendar_id` | ref<WorkingCalendar> | ✔ | admin | Holidays/working days for SLA math. |
| `rera_reg_no` | string | | admin | RERA registration number — customer-safe (feeds transparency T5). |
| `statutory_approvals` | json | | admin | `[{ name, authority, status }]` — customer-safe statutory/approval facts (T5). |
| `escrow_assurance_note` | string | | admin | Customer-safe escrow/fund-safety note (T5). |
| `config` | json | | admin | Project overrides (SLAs, gates, approval matrix, freeze dates) — see `Admin/Policy Studio`. |
| `created_at` / `updated_at` | timestamp | ✔ | system | |

### 2.2 ProjectHierarchyNode

Self-nesting physical hierarchy (Phase → Tower → Block/Cluster → Floor). Units hang off leaf nodes.

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `project_id` | ref<Project> | ✔ | |
| `parent_id` | ref<ProjectHierarchyNode> | | null at top level |
| `node_type` | enum{ phase \| tower \| block \| cluster \| floor \| zone } | ✔ | |
| `code` | string | ✔ | e.g. `T3`, `F08` |
| `name` | string | ✔ | |
| `sort_order` | int | ✔ | |

### 2.3 Unit

Permanent property identity. Physical/spec detail is in [`unit-twin.md`](unit-twin.md); this is the master row.

| field | type | req | writes | notes |
|---|---|---|---|---|
| `id` | uuid | ✔ | system | |
| `project_id` | ref<Project> | ✔ | admin | **Immutable** after controlled creation (audited correction only). |
| `hierarchy_node_id` | ref<ProjectHierarchyNode> | ✔ | admin | Leaf node (floor/cluster). |
| `unit_number` | string | ✔ | admin | e.g. `V104`, `8-12`. Unique within project. |
| `unit_type` | string | ✔ | admin | e.g. `3BHK-A`, `Villa-Type-2`. |
| `carpet_area` / `built_up_area` / `saleable_area` | decimal | ✔ | admin | sq ft. |
| `facing` | enum{ N\|S\|E\|W\|NE\|NW\|SE\|SW } | | admin | |
| `parking_count` | int | | admin | |
| `uds_land_share` | decimal | | admin | Undivided land share. |
| `sale_status` | enum{ available \| held \| booked \| registered \| handed_over } | ✔ | derived | Derived from Booking + Hold state. |
| `created_at` / `updated_at` | timestamp | ✔ | system | |

> A Unit exists and is fully modelled **before any Booking**. `sale_status = available` with a complete Unit Twin is the pre-sales state.

### 2.4 Booking

The bridge. Commercial/lifecycle facts attach here.

| field | type | req | writes | notes |
|---|---|---|---|---|
| `id` | uuid | ✔ | system | |
| `project_id` | ref<Project> | ✔ | derived | From Unit. |
| `unit_id` | ref<Unit> | ✔ | sales | The booked Unit. |
| `booking_number` | string | ✔ | system | Human-readable. |
| `status` | enum{ draft \| submitted \| crm_accepted \| active \| cancelled \| transferred } | ✔ | sales→crm | See handshake `sales→crm-rm`. |
| `booking_date` | date | ✔ | sales | |
| `token_amount` | money | | sales | Booking/token amount. |
| `total_consideration` | money | ✔ | sales | Agreed sale value. |
| `payment_plan_id` | ref<PaymentPlan> | ✔ | sales | Milestone schedule template. |
| `sales_owner_id` | ref<User> | ✔ | sales | Salesperson. |
| `rm_owner_id` | ref<User> | | crm | Assigned on CRM acceptance. |
| `source_channel` | string | | sales | Direct/broker/referral. |
| `completeness_score` | decimal | ✔ | derived | Sales-handover gate (0–100). |
| `predecessor_booking_id` | ref<Booking> | | system | For transfers — links to closed booking. |
| `created_at` / `updated_at` | timestamp | ✔ | system | |

**Lifecycle rule:** cancel/transfer sets `status` and closes the Booking; the Unit's twin history is untouched. A transfer opens a *new* Booking with `predecessor_booking_id` set.

### 2.5 Customer

Person/family/entity. Relationship detail is in [`customer-twin.md`](customer-twin.md); this is the master row.

| field | type | req | writes | notes |
|---|---|---|---|---|
| `id` | uuid | ✔ | system | |
| `customer_type` | enum{ individual \| joint \| company \| huf \| nri } | ✔ | crm | |
| `display_name` | string | ✔ | crm | |
| `primary_phone` / `primary_email` | string | ✔ | crm | |
| `preferred_language` | string | | crm | For customer-facing comms. |
| `preferred_channels` | json | | crm | Ordered list: whatsapp/email/sms/call. |
| `consent` | json | ✔ | crm | Privacy/marketing consent + timestamps. |
| `kyc_status` | enum{ pending \| partial \| verified \| flagged } | ✔ | derived | |
| `created_at` / `updated_at` | timestamp | ✔ | system | |

> A Customer is **not** project-scoped — the same family may buy in multiple Projects. Project scoping applies through their Bookings. Customer master supports **dedup/merge without losing history**.

### 2.6 BookingApplicant

Join between Booking and Customer, with per-applicant role in that booking.

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `booking_id` | ref<Booking> | ✔ | |
| `customer_id` | ref<Customer> | ✔ | |
| `role` | enum{ primary \| co_applicant \| co_owner \| nominee \| guarantor } | ✔ | Exactly one `primary` per booking. |
| `ownership_pct` | decimal | | For co-owners. |
| `pan` | string | | Cross-checked by Legal Document Factory. |
| `kyc_document_ids` | ref<GeneratedDocument>[] | | |

---

## 3. Team & access

### 3.1 Team, ProjectTeamAssignment, UserRoleAssignment

Supports "one team → many projects" and "one project → many teams," effective-dated.

**ProjectTeamAssignment**

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `project_id` | ref<Project> | ✔ | |
| `team_id` | ref<Team> | ✔ | |
| `department` | enum{ sales \| crm \| accounts \| legal \| project \| qa \| post_handover \| management } | ✔ | Maps to role ids (`project`→project-site, `crm`→crm-rm, `post_handover`→post-handover). |
| `assignment_type` | enum{ dedicated \| shared \| central } | ✔ | |
| `primary_owner_id` / `backup_owner_id` | ref<User> | | |
| `escalation_manager_id` | ref<User> | | SLA ladder target. |
| `effective_from` / `effective_to` | date | ✔/– | **Effective-dated** — changing team next month must not rewrite historic ownership. |
| `capacity_weight` | decimal | | Workload balancing. |
| `permissions` | json | | Field-level/sensitivity overrides. |

**UserRoleAssignment** binds a User to one or more role ids within authorized Projects; drives default Project selector and RLS.

---

## 4. Project partition & security (RLS)

| Rule | Requirement |
|---|---|
| **Derived project_id** | Every downstream entity stores `project_id`, derived from Unit/Booking, validated against source on write. Never asked from the user when derivable. |
| **Row-level security** | Postgres RLS keyed on `project_id` ∩ the user's authorized Projects (from UserRoleAssignment). Enforced at the DB layer, not just the API. |
| **Default Project** | A user assigned to one Project sees it by default; shared-team users get a Project selector limited to authorized Projects and keep correct task/escalation context on switch. |
| **Immutability** | `Unit.project_id` immutable after controlled creation. Downstream `project_id` is derived and re-validated, never hand-edited. |
| **Roll-up** | Every analytic drills Portfolio → Project → Phase/Tower → Unit → Booking/Customer with no duplicate manual project tagging. |

---

## 5. Cross-cutting rules

| Rule | Requirement |
|---|---|
| **Single master ids** | One canonical id per Project, Unit, Booking, Customer, Applicant. |
| **No hard deletes** | Material financial/legal/commitment/spec history is never deleted — use `cancelled` / `superseded` / `transferred` states. |
| **Effective dating** | Ownership changes, commercial revisions, and policy changes are effective-dated, never overwritten. |
| **Reason codes** | Returns, delays, overrides, waivers, cancellations, escalations require a structured reason code (+ optional narrative). |
| **Audit** | Every consequential change emits an event (see [`event-log.md`](event-log.md)) and is timestamped with actor. |
| **Derived vs stored** | Scores and `sale_status` are derived and cached with a `computed_at`; never authoritative source of truth. |

---

## 6. Reference sub-entities (defined in their owning specs)

| Entity | Defined in |
|---|---|
| `UnitProgressState`, `UnitChangeGate`, `ChangeCategory`, `ChangeGateRule`, `AsBuiltRevision`, `HomePassportItem` | [`unit-twin.md`](unit-twin.md) / [`gates.md`](gates.md) |
| `FinancialBehaviour`, `Commitment`, `Communication`, `ExperienceSignal` | [`customer-twin.md`](customer-twin.md) |
| `Action`, `Escalation` | [`universal-action.md`](universal-action.md) |
| `PaymentPlan`, `PaymentPlanMilestone`, `Demand`, `Receipt`, `LoanCase`, `ForecastSnapshot`, `CollectionForecastLine` | `roles/accounts/spec.md` |
| `ChangeRequest`, `ChangeRequestLineItem`, `ChangeWindowHold` | `roles/sales/spec.md` + [`gates.md`](gates.md) |
| `DocumentTemplate`, `ClauseLibrary`, `GeneratedDocument`, `ExecutionRecord`, `RegistrationCase` | `roles/legal/spec.md` |
| `Snag`, `QAChecklist`, `ReadinessScore`, `HandoverGate` | `roles/qa/spec.md` + [`gates.md`](gates.md) B |
| `WarrantyCase`, `DLPWindow`, `ServiceHistory`, `CheckinRecord` | `roles/post-handover/spec.md` |
| `Intervention`, `KpiSnapshot` | `roles/management/spec.md` |
| `Opportunity`, `ProspectPersonalisationNeed`, `UnitRequirementMatch` | `roles/sales/spec.md` |
| `Commitment`, `Communication`, `ExperienceSignal` | [`customer-twin.md`](customer-twin.md) |
| `AutoPublishRule`, `CustomerUpdateApproval` | `roles/crm-rm/spec.md` |
| `JourneyTemplate`, `JourneyInstance`, `StageInstance`, `SlaPolicy` | `roles/*` + `architecture.md` |

Each of these MUST carry `project_id` (derived) and follow the cross-cutting rules above.
