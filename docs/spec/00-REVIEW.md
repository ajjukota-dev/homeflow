# Technical spec review — are the design choices right?

**Date:** 5 Sep 2026 · **Reviewed:** `docs/spec/` (this repo) against the PDF (`Pranava_HomeFlow_2.0_Full_Design_Spec_v8`) and against HomeFlow v1 (`C:\Users\Vivek\Pranava-V2\HomeFlow`).

**Method:** read every foundation file and role spec here; read v1's data model, RBAC, workflow engine, escalation rules, document generation, every router's endpoint list, its seed data, its design guide, its git history, and Emergent's own 16 Feb 2026 audit of v1 against the 2.0 PDF. I did not run v1 (it needs MongoDB and has no `.env`); the review is on code and documents.

---

## The finding that comes before all the others

**There are two HomeFlows, and the spec in this repo doesn't know about the other one.**

| | HomeFlow v1 (`Pranava-V2/HomeFlow`) | This repo (`Pranava-HomeFlow`) |
|---|---|---|
| Built by | Emergent agent, 42 commits, 12 Aug → **4 Sep 2026** (still active yesterday) | Claude, 3 commits |
| Stack | Python FastAPI · MongoDB (Motor) · React 19 CRA + shadcn · Expo shell | Node/Express → Lambda · PGlite → Aurora Postgres · React 18 Vite |
| Size | ~19k lines Python · ~21k lines React · 41 collections · 27 screens + 7 admin | ~7k lines TypeScript · 20 tables · 8 screens + 1 portal |
| Has | Auth + Google Sign-In, RBAC matrix + field redaction, audit log, comments/attachments/mentions, **workflow engine**, sales handover, payments/TDS/financial clearance, loans, legal + **PDF document generation**, registration, unit readiness, snags, handover **with override**, commitments, communications, escalation rules, reports, exec dashboard, Customer 360 with 12 tabs | Gate engine, true-risk buckets, financial clearance, handover gate evaluation, Control Tower five, customer portal T1–T6, AOS generation with snapshot + validation |
| Lacks | Postgres/RLS, event log, Universal Action, unit-scoped progress, changeability gates, customer portal, forecasting, date model | Everything in v1's "Has" column except the thin slices |

The PDF's very first paragraph says: *"The existing modules are a valuable base and should be retained. The next stage is to connect them through a common data model…"* Sections 30–35 are titled **"Emergent Build Instructions"** — the PDF was written *for the team building v1*. Emergent's own audit report (`Pranava-V2/HomeFlow/memory/audit_report.md`) is a 700-line gap analysis of v1 against this PDF with a KEEP / ENHANCE / REFACTOR verdict per module.

`docs/spec/` contains zero references to v1, MongoDB, FastAPI, Emergent, or "existing modules". It reinterpreted the PDF as a greenfield build. Whatever else is decided, that is the defect to fix first: **the spec must name what it is evolving and how.**

---

## Verdicts on each design choice

Legend: ✅ keep · 🔧 change · ⚖️ decision needed (not a spec fact — someone has to choose)

### Data & domain — the spec is right, and better than v1

| Choice | Verdict | Why |
|---|---|---|
| **Postgres as system of record, RLS by `project_id`** | ✅ (RDS, not Aurora) | v1 scopes by project in application code (`auth_scope.py`), re-implemented per router, bypassable, and Emergent's own audit notes *"everything below bookings is booking-scoped, not project-scoped"*. MongoDB cannot do row-level security or cross-collection transactions. The PDF's §4.4 "Project is a universal security dimension" is only enforceable at the DB. Keep. |
| **Append-only event log with a named catalogue** | ✅ | v1's `audit_logs` stores full before/after document diffs (Emergent's audit: *"contains PII / financials… not consumer-safe"*) and `write_audit()` ends in `except: pass` — an audit log that can fail silently is not an audit log. The spec's envelope + catalogue is the right design. Keep. |
| **Universal Action + My Day** | ✅ | v1 has four separate work-item types — `tasks`, `snags`, `customer_commitments`, `escalations` — each with its own status vocabulary, router and `/counts` endpoint. PDF §7 says every actionable item normalises into one Action. Keep. |
| **Unit-scoped progress, rule-derived changeability gates** | ✅ | v1's `unit_readiness` is per-*booking*, 14 components × hard-coded weights × **manually typed percent**. PDF §8.8: *"replace subjective percentages with evidence-based completion."* The gate engine in this repo (`gates.ts`) is the correct model and v1 has no equivalent. Keep. |
| **Four-date model (baseline / current / forecast / actual) + SLA ≠ Plan** | ✅ | v1 has `sla_days → due_date` and nothing else. PDF §16/§34 require both clocks. Keep. |
| **H10 transparency projection for the customer** | ✅ | v1 has scattered `customer_visible` booleans and the `customer` role's permission row is literally `{}` — "Portal unavailable". v1 has no customer portal at all. Keep. |
| **Config over code (Policy Studio)** | ✅ | v1 hard-codes 13 escalation rules in Python, 14 readiness weights in Python, 2 journey templates in `seed.py`, 3 document templates with no versioning. Keep the principle; note v1's *content* (the stage lists, the rules) is exactly the config to seed. |
| **Twins as composed views, Booking as the bridge** | ✅ | v1 already models `projects → units → bookings ← customers` correctly (Emergent's audit: *"model is clean"*). Same idea, both sides. Keep. |

### Architecture — the spec over-built, and the over-build is what made it ignore v1

| Choice | Verdict | Why |
|---|---|---|
| **Serverless-first: Lambda per domain, API Gateway, EventBridge + SQS, Step Functions, OpenSearch, Pinpoint** | 🔧 | The PDF never asks for serverless — it never names an AWS service. This was the spec author's choice. For a developer with a handful of projects and hundreds of units it is heavy: cold starts on a cross-domain read path, **OpenSearch to filter a few hundred villas**, per-domain Lambdas for a product whose entire thesis is cross-domain joins (handover eligibility reads six tables from four roles). And it is the *reason* the local mirror needs LocalStack + SAM + `cdklocal` + a client factory. Replace with **one containerised API on ECS Fargate + RDS Postgres + S3**, with events, jobs and sessions as Postgres tables — no queue, no bus. Identical AWS parity, a fraction of the plumbing, and v1's FastAPI runs unchanged. Full reasoning and rejected alternatives: [`foundation/architecture.md`](foundation/architecture.md) §3, §10. |
| **"Bounded contexts never read another context's tables"** (CLAUDE.md, architecture §2.1) | 🔧 | Contradicts the product. H1–H12 in the PDF are *transfers of responsibility*, not database isolation. Enforcing no-cross-reads inside one small monolith is ceremony that fights every roll-up screen. Keep handshakes as explicit functions that emit events; drop the DB-isolation rule. One schema, modules as folders, RLS by project. |
| **TypeScript everywhere / Node backend** | 🔧 | Not justified anywhere in the spec, and it is the single choice that discards 19k lines of working, tested Python domain logic. FastAPI + Python stays for the backend; TypeScript stays for the two frontends. (If Lambda is ever genuinely needed, FastAPI runs on it via Mangum in one line.) The good engines written here in TS — gates, true-risk, clearance, handover evaluation, tower `pickFive`, legal snapshot/validation — are small and pure; porting them to Python is days, not months. Port the small good engines into the big working system, not the reverse. |
| **CDK for infra** | ✅ | Keep. Two stacks: `data` (VPC, RDS, S3 — retained) and `service` (Fargate, ALB, DNS). |
| **Local-first with AWS parity (§6b)** | ✅ principle, 🔧 mechanics | The principle is exactly right. The mechanics simplify to `docker compose up` = Postgres 16 + MinIO + Mailpit + the API container. No LocalStack, no SAM, no cdklocal, no cognito-local — every AWS service used has a real local twin or is reached the same way from a laptop (Google). |
| **Webpack** in README vs **Vite** in code | 🔧 | Drift. Vite. (v1 is on CRA, which is deprecated — also Vite.) |

### Identity

| Choice | Verdict | Why |
|---|---|---|
| **Cognito + Google as federated IdP** | 🔧 Google yes, Cognito no | v1 already has "Continue with Google" — but through **Emergent's auth broker** (`auth.emergentagent.com` verifies the email, then v1 mints its own JWT). That is a vendor dependency on Emergent's hosted service, not on Google. Rambabu's ask is *Google login*; Cognito would put a second broker in the same place Emergent's sits today, plus a Hosted UI and a local stand-in that is not the real thing. Talk to Google directly, server-side (OIDC), keep sessions in Postgres, and give customers OTP on their booking mobile. No passwords stored anywhere. v1's RBAC matrix carries over. |

### Design

| Choice | Verdict | Why |
|---|---|---|
| **Apple-homely: warm neutrals, one accent, SF Pro only, no indigo, roomy** (`design-language.md`) | ⚖️ | The PDF does not specify a design system. It says the customer experience must be *"calm, premium, contextual"* (§11) and that's all. v1's `design_guidelines.json` records a **"locked choice from the human"**: *Swiss high-contrast enterprise, Operational Navy `#1E1B4B` (indigo-950), Chivo + IBM Plex Sans, dense 40px table rows.* `design-language.md` explicitly bans indigo, serif display and density. These are opposites and both claim authority. **This is a decision for Vivek and Rambabu, not a spec fact.** Recommendation below. |

**Design recommendation.** `design-language.md` already says *"two skins, one token set."* Resolve it that way:
- **My Pranava Home (customer):** Apple-homely as specified — warm, calm, photo-forward. This is what §11 asks for and v1 has nothing here to conflict with.
- **Workspace (staff):** keep v1's density and information architecture (its 27 screens work), re-tokenise onto the shared palette so status colours, spacing and type scale match — but do not force the customer skin's whitespace onto Accounts and Legal, who live in tables. Whether the accent stays navy or becomes the spec's blue is a one-line token change; pick one.

---

## What v1 gives us that we should not rewrite

Full ledger in [`foundation/v1-reuse.md`](foundation/v1-reuse.md). The headline items:

| v1 capability | Maps to PDF | Reuse verdict |
|---|---|---|
| Workflow engine (`workflow_engine.py`, 734 lines): template → stage → subprocess → task, DAG dependencies, conditional DSL (`customer.nri_status in ['NRI','OCI']`), blocker text, evidence-must-be-verified, self-verify guard, forward + **reverse** cascade | §34 Journey engine | **PORT** — this *is* the journey engine minus the date model and SLA clocks. Add those; keep the logic. |
| RBAC matrix (525 lines, 11 roles × ~40 modules × 6 levels) + financial/PII redactors | §17 permissions, field-level sensitivity | **PORT** as data (a `permission` table), keep redactor concept. RLS replaces `auth_scope.py`'s per-router scoping. |
| Document generation: Jinja + WeasyPrint, AOS / Sale Deed / Handover templates, DRAFT watermark until Legal approves | §32 Document Factory | **PORT** — add snapshot freeze, checksum, template versioning, clause library. The rendering pipeline is done. |
| Sales handover packet: sections → validate → submit → accept / return-with-reason → promote commitments | H2 | **PORT** — this is H2 with a return-reason path this repo lacks. |
| Handover: readiness roll-up + checklist + **override with reason and authority** + acknowledgement | Gates Part B, B.4 | **PORT** — add evidence, safety-gate rejection, event emission. Override already exists; this repo's `applyOverride()` is never called. |
| Financial clearance checklist → approve/reject · TDS · loans with sanction/disbursement events · registration availability → slot → executed → deed upload | H7, §8.4, H8 | **PORT** as-is. |
| Snags: create → assign → start → after-photo → verify → reopen, journey sync | §8.9 | **PORT**, add root-cause code + repeat flag. |
| Commitments state machine (Draft → Approval → In Progress → Complete → Customer Confirmed) | §8.11 Promise Ledger | **PORT**, add `direction`, `visibility`, pre-breach. |
| 13 escalation rules (commitment 3d/7d, payment 15d/30d, TDS 5d, loan 15d, legal 5d, slot 3d, critical snag 2d, handover 15d/7d, query 48h) | §16 SLA ladder, H11 | **PORT as config rows**, not Python. These become SLA-policy seeds. |
| Comments / attachments (versioned, verified) / mentions / notifications, polymorphic on `(entity_type, entity_id)` | §8.12 (partly) | **KEEP** — PDF §27 bans "another standalone chat stream"; entity-anchored comments are not that. |
| 8-stage Villa/Apartment journey templates (Sales Handover · Documentation · Legal · Payments · Registration · Unit Readiness · Snagging · Handover) with T1–T13 tasks | §35 East Crest as configuration | **PORT as the Pranava Standard Journey seed**. This is almost exactly PDF §35's East Crest mapping; it is missing stage 0 (pre-sales) and stage 10 (post-handover). |
| 27 screens + Customer 360 with 12 tabs (overview · journey · financials · documents · legal · loan · registration · snags · handover · commitments · communications · escalations) | §13, §20 | **KEEP** the information architecture; migrate CRA → Vite; re-tokenise per the design decision. |

**Do not carry:** MongoDB · the Emergent auth broker · `unit_readiness` as-is · `audit_logs` as-is · `users.assigned_project_ids` (→ `ProjectTeamAssignment`, which Emergent's audit also recommends) · CRA · the empty Expo scaffold · the ~15 vendor packages in `requirements.txt` with **zero imports** (`litellm`, `openai`, `google-genai`, `stripe`, `huggingface_hub`, `boto3`, `tiktoken`, `emergentintegrations`…) · tests that hit a live Emergent preview URL.

**Net-new (neither side has it):** Change Requests (H5/H6) · Change Window Hold · collections forecasting + snapshots · Policy Studio · data freshness · My Day · notifications engine · post-handover DLP/warranty (this repo has a thin slice) · customer portal (this repo has a thin slice; v1 has none).

---

## The one decision that gates everything

**Which codebase is HomeFlow 2.0 built in?**

| Option | What it means | Cost | Recommendation |
|---|---|---|---|
| **A. Evolve v1, port the engines from here** | Bring v1's FastAPI + React into this monorepo. Migrate Mongo → Postgres with RLS. Add the event log, Action, unit-scoped gates, date model, portal. Port `gates.ts`, `collections.ts`, `clearance.ts`, `handover.ts`, `tower.ts`, `legal.ts` to Python. | One migration (data + files), one language switch for Amarsh/Vivek on the backend, a design re-tokenisation. | **Yes.** It is what the PDF says. It keeps 40k working lines. The engines being ported are ~1.5k lines of pure logic. |
| **B. Continue here, port v1's *designs* not its code** | Keep Node/TS. Rewrite every v1 module by reading its Python. | Months of rewriting breadth that already works, and two teams building the same product in parallel until it is done. | No. This is the path the current spec implies by omission, and it violates PDF §1. |
| **C. Keep both** | — | Two products, two data sets, two truths. | No. |

If Option A: **stop v1's Emergent agent from adding features today.** Every commit it makes to Mongo is migration debt. Freeze v1 at commit `7854b05`, treat it as the source to migrate from.

---

## What changed in the spec as a result of this review

| File | Change |
|---|---|
| `00-REVIEW.md` | this file |
| `foundation/v1-reuse.md` | **new** — reuse ledger, Mongo → Postgres mapping, journey template mapping, data and file migration, broker replacement |
| `foundation/architecture.md` | **rewritten from first principles (5 Sep)** — Fargate + RDS Postgres 16 + S3; events, jobs, sessions in Postgres; Google OIDC + customer OTP; local = docker compose (Postgres, MinIO, Mailpit, API). Aurora, SQS/EventBridge, Cognito, Lambda, OpenSearch all rejected with reasons in §10 |
| `foundation/build-conventions.md` | commands and code style updated for a Python backend + TS frontends |
| `foundation/design-language.md` | decision banner added; content unchanged pending the decision |
| `README.md` | stack table, foundation list, build order ("migrate, then extend") |
| `../../CLAUDE.md` | bounded-context DB-isolation rule dropped; language rule split (Python backend / TS frontend); repo structure updated |
| `../TASKS.md` | Vivek's Phase A rewritten around the migration |

Unchanged and still authoritative: `vocabulary.md`, `data-model.md`, `unit-twin.md`, `customer-twin.md`, `universal-action.md`, `gates.md`, `handshakes.md`, `customer-transparency.md`, `event-log.md`, all `roles/*/spec.md`. The **what** was right. The **how** and the **from-what** were wrong.
