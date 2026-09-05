# HomeFlow — Engineering Rules

Production-grade, scalable, maintainable. This is a real product we will scale and operate, not a prototype. Every change follows these rules. When in doubt, favour clarity and long-term maintainability over cleverness or speed.

**Spec is authoritative.** The build contract lives in `docs/spec/`. `docs/spec/foundation/` wins over any role file; `docs/spec/technical/` (how it is built: layout, DDL, RLS, auth, events/jobs, endpoints, infra) wins over role files on mechanics; role files win over ad-hoc code. Read the relevant spec before implementing. **HomeFlow 2.0 is built on HomeFlow v1** (`Pranava-V2/HomeFlow`): carry its modules, slide the foundation underneath — see `docs/spec/00-REVIEW.md` and `docs/spec/foundation/v1-reuse.md`.

---

## Architecture principles

- **Local-first, AWS-parity.** Everything runs on a laptop (`make dev`: Postgres 16.4 + MinIO + the FastAPI image) and deploys to AWS unchanged by re-pointing env (`docs/spec/foundation/architecture.md` §7). Never make a cloud service a hard dependency of a core workflow.
- **Modules = role folders.** `project_site, sales, crm_rm, accounts, legal, qa, post_handover, customer_portal, management` under `services/api/modules/`. One system of record: a module may **read** any table, **writes** only its own, and cross-writes through the owning module's handshake function, which emits an event (H1–H12).
- **Project-partitioned.** Every downstream row carries a derived `project_id`; enforce RLS. Never ask a user for a value that can be derived.
- **Event-sourced audit.** Consequential changes emit an immutable event (`docs/spec/foundation/event-log.md`). Append-only by DB grant; no hard deletes of financial/legal/commitment/spec history.
- **Postgres is the platform.** Records, events, the job queue, sessions and search live in one Postgres. No SQS/EventBridge/Redis/OpenSearch/Cognito unless `architecture.md` §11 says the trigger has been hit.
- **Config over code.** Journey/SLA/gates/templates/copy are data (Policy Studio). Never hard-code East Crest values (durations, charges, stage names).

## SOLID + system design

- **Single Responsibility.** One reason to change per module. Split files >200 lines. UI: separate container (data) from presentation (render).
- **Open/Closed.** Extend via configuration and composition, not by editing core logic. Gate rules, journey stages, scores are data-driven.
- **Liskov / interfaces.** Program to interfaces. Domain functions in `domain/` return plain results; FastAPI routers adapt them. `domain/` must not import FastAPI, SQLAlchemy or boto3.
- **Interface Segregation.** Small, purposeful contracts. API payloads match `data-model.md`; don't leak internal fields across a handshake.
- **Dependency Inversion.** Domain logic depends on abstractions (a `db` session, an `events` port, a `files` port), not concretes. The same code runs locally and in ECS because endpoints come from env, never from code.
- **DRY via shared packages.** Cross-app frontend code lives in `packages/ui`. Backend shared code lives in `services/api/kernel/`. No copy-paste between apps.
- **Explicit boundaries.** Pure domain logic (gate engine, forecast math) is framework-free and unit-tested in isolation.

## Code standards

- **Backend: Python 3.12 + FastAPI**, type hints everywhere, `mypy --strict` on `domain/` and `kernel/`, Pydantic models on every boundary, no bare `except`. **Frontend: TypeScript strict**, no `any` without a written reason. No unused exports.
- **Naming:** `PascalCase` components/types, `camelCase` values, `SCREAMING_SNAKE` domain enums mirroring the spec (`HARD_CLOSED`). API/DB fields `snake_case`.
- **No magic values.** Colours/spacing/radii come from design tokens; domain constants are named.
- **Errors are handled**, not swallowed. Return structured errors (`{ code, message, source_ref? }`).
- **Comments explain _why_.** Each module/component has a one-line doc tying it to its spec section.

## UI quality bar (no "vibe-coded" look)

Follows `docs/spec/foundation/design-language.md` (Apple-homely) + the `frontend-ui-engineering` skill. **Banned AI-aesthetic tells:** purple/indigo defaults, excessive gradients, rounded-everything, shadow-heavy layers, oversized uniform padding, generic hero/card-grid filler, lorem-ipsum.

Required:
- **Design tokens only** — Tailwind theme tokens; never arbitrary hex/px. One consistent spacing scale, radii scale, type scale.
- **Type hierarchy** — one `h1` per page; don't skip levels; don't use heading styles for body.
- **Real content** — realistic names/amounts/dates, never placeholder filler.
- **Every list has loading / empty / error states.** Skeletons for content, not spinners.
- **Accessibility WCAG 2.1 AA** — keyboard nav, focus states, ARIA labels, 4.5:1 contrast, status never by colour alone (icon + label).
- **Responsive** — verify 320 / 768 / 1024 / 1440.
- **No glassmorphism / translucency.**

## Repository structure

Monorepo, **one concern per top-level folder**. Each package is self-contained (own `package.json`, `tsconfig`, tests). No cross-package relative imports — share via `packages/` (added at app #2) or the API.

```
HomeFlow/
├── docs/spec/            # THE BUILD CONTRACT — 00-REVIEW.md · foundation/ (incl. v1-reuse.md) · technical/ · roles/
├── apps/
│   ├── workspace/        # internal React app — v1's frontend, migrated CRA → Vite
│   └── my-pranava-home/  # customer React app
├── packages/ui/          # shared tokens + components
├── services/
│   └── api/              # Python / FastAPI — v1's backend on Postgres
│       ├── kernel/       #   identity · action · journey · documents · events · files · notifications · aws
│       ├── modules/      #   one folder per role (routers + services)
│       ├── domain/       #   pure engines: gates · collections · clearance · readiness · handover · tower · legal
│       ├── migrations/   #   Alembic
│       └── seeds/        #   config seed (always) · demo seed (HOMEFLOW_DEMO=1)
├── infra/                # AWS CDK — data stack (VPC, RDS Postgres, S3) + service stack (ECS Fargate, ALB, DNS)
├── docker-compose.yml · Makefile · .env.example
└── CLAUDE.md
```

- Domain logic (gate engine, forecast math) is **pure and framework-free** in `services/api/domain/` so it unit-tests in isolation.

## Testing discipline

- **TDD for behaviour** — failing test first for domain logic (gates, money, validators, handlers).
- **Levels:** unit (Vitest), component (RTL), contract (OpenAPI), integration (local mirror), **visual/E2E (Playwright)**.
- **Playwright after every slice** — screenshot the new/changed screens at 1440 + 768 + 375, review them, and only advance when they genuinely look professional. Screenshots live in `e2e/__screenshots__/`.
- Coverage ≥80% on domain logic. Every role acceptance test maps to ≥1 automated test as its slice is built.

### Test suite layout

| Layer | Location | Runner |
|---|---|---|
| Backend unit (pure engine) | `services/api/domain/test_*.py` | pytest |
| Backend integration (compose Postgres) | `services/api/modules/**/test_*.py` | pytest |
| Frontend component | `apps/workspace/src/**/*.test.tsx` | Vitest + RTL |
| Visual / E2E | `apps/workspace/e2e/*.spec.ts` | Playwright (3 breakpoints) |

**Run everything from root:** `make test` (pytest + Vitest) · `npm run test:e2e` (Playwright) · `npm run build` · `npm run synth` (CDK). Tests live next to the code they cover.

## Definition of done (per slice)

A slice is done only when **all** are true:
1. `npm run build` + typecheck clean.
2. Unit/component tests pass; new behaviour has tests.
3. Playwright screenshots reviewed at 3 breakpoints — looks professional, matches design-language, no console errors.
4. Loading/empty/error states exist.
5. No spec drift (or the spec was updated first, foundation-first).
6. Local stack (`make dev`) still boots and every v1 screen still renders.

## Boundaries

**Always:** run tests + build before finishing a slice; use design tokens; derive `project_id` + RLS; keep the local stack green; screenshot-verify UI.
**Ask first:** DB schema/migrations; new dependency; changing a foundation spec; CI/infra changes; widening customer-visible data.
**Never:** commit secrets; let Sales/CRM code mutate unit physics/gates; auto-send consequential customer comms from AI; hard-delete material history; hard-code project-specific values; introduce glass/translucency.

## Commands

Root: `make dev | down | reset | test`.
API `services/api`: `uvicorn app:app --reload --port 8001` · `alembic upgrade head` · `pytest` · `ruff check . && mypy .`.
Frontends `apps/workspace`, `apps/my-pranava-home`: `npm run dev | build | test | lint | e2e`.
Infra `infra`: `npm run synth | deploy | destroy` (AWS; see `infra/README.md`).
