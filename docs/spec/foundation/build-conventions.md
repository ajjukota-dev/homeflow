# Foundation · Build Conventions

The operational contract for building HomeFlow — commands, code style, testing, and guardrails. Closes the "how to build" half of the spec so a coding agent (or human) works consistently. Complements [`architecture.md`](architecture.md) (the "what runs where").

---

## 1. Commands

### Whole stack (from repo root)
```
make dev               # docker compose up (Postgres 16 + MinIO + Mailpit + API) → migrate → bucket → seed
make down              # stop
make reset             # wipe volumes, re-seed
make test              # backend pytest + frontend vitest
```

### Backend — `services/api` (Python / FastAPI, from v1)
```
uv sync                # or: pip install -r requirements.txt
uvicorn app:app --reload --port 8001
alembic upgrade head   # migrations
alembic revision -m "…" --autogenerate
pytest                 # unit + integration (integration uses the compose Postgres)
ruff check . && mypy . # lint + types
```

### Frontends — `apps/workspace`, `apps/my-pranava-home` (React + Vite, TypeScript)
```
npm install
npm run dev            # Vite → :5173 (workspace) / :5174 (customer); /api proxied to :8001
npm run build          # tsc -b + vite build
npm test               # Vitest (excludes e2e/)
npm run e2e            # Playwright
npm run lint
```

> **Local-first rule:** everything runs on a laptop with no AWS account; the same image deploys to AWS by re-pointing env ([`architecture.md`](architecture.md) §7).

---

## 2. Code style

- **Backend language:** Python 3.12, FastAPI, `from __future__ import annotations`, type hints everywhere, `mypy --strict` on `domain/` and `kernel/`. Pydantic models for every request/response. No bare `except:` — v1's `write_audit` swallowing errors is the anti-pattern.
- **Frontend language:** TypeScript, `strict: true`. No `any` without a written reason.
- **React:** function components + hooks. One component per file; the file is named for the component (`GateChip.tsx`).
- **Naming:** `PascalCase` components/types, `camelCase` values/functions, `SCREAMING_SNAKE` domain enums that mirror the spec (`HARD_CLOSED`). API/JSON fields are `snake_case` to match [`data-model.md`](data-model.md).
- **Design system:** never hard-code colours/spacing/radii — use the tokens in `styles/tokens.css` (mirrors [`design-language.md`](design-language.md) §3). A raw hex in a component is a bug.
- **Components** live in `src/ui/` (extractable to `packages/ui` when the second app lands) and are exported through `src/ui/index.ts`.
- **Imports:** absolute from `src` where configured; otherwise relative. Group external → internal → styles.
- **Formatting:** Prettier defaults (2-space, double quotes, trailing commas). Lint must pass before commit.
- **Comments:** explain *why*, not *what*. Each component has a one-line doc tying it to the spec section it implements.

Example (the house style):
```tsx
/** The 5 changeability gate states (foundation/gates.md A.1) as warm chips.
 *  Icon never sole signal — colour + label always paired. */
export function GateChip({ state, note }: { state: GateState; note?: string }) { ... }
```

---

## 3. Testing strategy

| Level | Tool | What it covers |
|---|---|---|
| Unit | **pytest** (backend `domain/`), **Vitest** (frontend) | Pure logic (gate derivation, forecast math, INR formatting, validators). |
| Component | **Vitest + React Testing Library** | Components render + behave; accessibility (labels, roles). |
| Contract | **schemathesis** against FastAPI's OpenAPI | API request/response shapes match the spec; handshake payloads. |
| Integration | pytest + compose Postgres/MinIO | A handshake end-to-end against the local mirror. Tests never hit a hosted preview URL (v1's did). |
| E2E (later) | Playwright | A full vertical slice through the real UI. |

- **Behaviour-first:** for new behaviour, write the failing test first (TDD), then implement. Presentational scaffolding (tokens, static gallery) is exempt.
- Tests live next to code: `Thing.tsx` → `Thing.test.tsx`.
- **Coverage bar:** ≥80% on domain logic (gates, money, validators, handshake handlers). UI-only files are not chased for coverage.
- Every **acceptance test** in a role spec must map to at least one automated test as that slice is built.
- Colour-never-sole-signal and RLS/visibility rules get explicit tests (they are trust guarantees).

---

## 4. Boundaries

**Always**
- Run `make test` + `npm run build` (both apps) before committing a slice.
- Use design tokens; keep customer-facing surfaces behind the H10 visibility filter.
- Derive `project_id` and enforce RLS on every data path.
- Keep the local stack working (`make dev` must stay green).

**Ask first**
- Database schema changes / migrations.
- Adding a dependency.
- Changing a foundation spec file (twins, gates, handshakes, data-model) — foundation is authoritative.
- Changing CI or infra (CDK) config.
- Anything that widens what a customer can see.

**Never**
- Commit secrets or `.env` values.
- Let Sales/CRM code mutate unit physical state or technical gates.
- Auto-send consequential customer communication from AI.
- Hard-delete financial/legal/commitment/spec history (use superseded/cancelled states).
- Hard-code East Crest values (durations, charges, stage names) — they are Policy Studio config.
- Introduce glassmorphism/translucency (design-language §9).

---

## 5. Build order (incremental slices)

Migration first, then slices. See [`v1-reuse.md`](v1-reuse.md) §5 for the migration order.

| Slice | Delivers | Visible outcome |
|---|---|---|
| **M. Migration** | v1 in this repo on Postgres + RLS + S3; engines ported; event log + jobs; Action kernel; Google OIDC + OTP sessions | Every v1 screen renders from Postgres for every role |
| 1. Changeability | Unit-scoped progress → gate engine → sales inventory (H1) | Set progress → gate flips in sales |
| 2. Booking + handoff | v1 sales handover on the new Booking model (H2) | Completeness gate, return taxonomy, Customer Twin |
| 3. Customer home | My Pranava Home (T1–T6, H10) | Buyer's portal on real data |
| 4. Money | Demands → true-risk + forecasting | Payment "why now", cash-flow planner |
| 5+ | Legal factory, QA/handover, post-handover, management | Each a new visible slice |
