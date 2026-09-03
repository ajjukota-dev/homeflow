# HomeFlow — context for agents and humans

Source: `Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf` (48 pages, 35 sections + 2 appendices). Interactive reading copy: `canvases/homeflow-2-design-spec.canvas.tsx`. Full structured markdown: `docs/HOMEFLOW-OS.md`.

## What Pranava is doing

Pranava is a real-estate developer. It takes up **projects** (example in the spec: East Crest), builds **villas or apartments**, and sells those **units** to families.

HomeFlow is the software for **everything after a unit is booked** — until keys, and after move-in. It is not the construction drawing tool and not the accounting ledger. It is the operating system that keeps the customer, the unit, and the money in one story.

This repo is **not** the commercial office-leasing product (FMWork / Pranava Portal). Same company, different product.

## The three things that never mix

| Thing | Meaning |
|---|---|
| **Project** | The site (East Crest). Land + towers/villas + teams. All reporting rolls up here. |
| **Unit** | The physical home (Villa V104). Exists before anyone buys it. Permanent history even if the buyer changes. |
| **Booking** | This family + this unit + this ownership period. Cancel or transfer? Booking closes. Unit stays. |

Attach commercial and lifecycle facts to the **Booking**, not directly to the customer or the unit.

## How the flow works

1. **Before sale** — Site is building. Project team updates the Unit Digital Twin. Sales can already see: this villa can still change the kitchen; that one cannot. No customer required.
2. **They book** — Token, applicants, sales-to-CRM handover. Booking links the Customer Twin to the existing Unit Twin.
3. **Money + papers run together** — Loan or self-pay, KYC, Agreement of Sale, later Sale Deed. Not “finish money then start papers.”
4. **Construction continues** — Masonry, MEP first-fix, flooring PO. Each physical event can close a customisation gate.
5. **They want a change** — Formal Change Request (feasibility, cost, schedule, quote, payment, released drawing). Not a WhatsApp promise.
6. **Collections** — Milestone dues, bank release, promise-to-pay. Split due / overdue / disputed / loan-stuck / true risk. Forecast by project.
7. **Registration** — SRO slot, challan, sale deed, registered copy. Gate until money/docs/legal are ready.
8. **Keys** — Handover only when physical + customer + hard gates pass (money, legal, registration, QA, critical snags). Named override + reason only.
9. **They live there** — Warranty, Home Passport, service history stay on that unit forever.

## Changeability gates (Sales may read, never edit)

OPEN → CLOSING → CONDITIONAL → EXCEPTION ONLY → HARD CLOSED

Derived from live unit physics, not booking date or a project-wide cutoff. Safety/statutory hard gates are never overridden.

## Who opens what

- **Customer** — My Pranava Home: what is happening, what I must pay/sign, when keys look likely. Never internal blame or vendor prices.
- **Employee** — My Day: ranked work for today, with “why now.”
- **Management** — Control Tower: five interventions (customer, cash, handover, reputation, margin), not fifty charts.

## Five tests before any feature

1. Improve customer trust?
2. Eliminate chasing?
3. Expose accountability?
4. Predict earlier?
5. Protect / improve margin?

If none is yes, do not build. For customisations add a sixth: does this preserve the permanent as-built truth while protecting schedule and margin?

## System independence

HomeFlow must run standalone. External CRM, ERP, construction, DMS, or FM systems are optional adapters. They must never be required for core workflows or dictate the domain model.

## What not to build yet

Generic chatbot first. Unexplained scores. A second chat stream. Manual progress percentages. Chart-stuffed executive dashboards. AI auto-sending consequential customer communication. One-project custom branches (East Crest is configuration, not code).
