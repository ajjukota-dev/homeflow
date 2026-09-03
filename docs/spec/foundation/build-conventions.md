# Foundation · Build Conventions

The operational contract for building HomeFlow — commands, code style, testing, and guardrails. Closes the "how to build" half of the spec so a coding agent (or human) works consistently. Complements [`architecture.md`](architecture.md) (the "what runs where").

---

## 1. Commands

### Frontend — `apps/workspace` (and later `apps/my-pranava-home`)
```
npm install            # install deps
npm run dev            # Vite dev server (hot reload) → http://localhost:5173
npm run build          # typecheck (tsc -b) + production build
npm run preview        # serve the production build
npm test               # Vitest run (CI mode)
npm run test:watch     # Vitest watch
npm run lint           # ESLint
```

### Local backend stack (added in later slices — see architecture §6b)
```
docker compose up      # Postgres + LocalStack (EventBridge/SQS/S3/Cognito) + OpenSearch
npm run dev:api        # SAM local / serverless-offline — Lambda handlers as local HTTP
make dev               # boots the full local mirror + seeds East Crest sample config
```

> **Local-first rule:** everything runs on a laptop with no AWS account; the same code deploys to AWS by re-pointing env ([`architecture.md`](architecture.md) §6b).

---

## 2. Code style

- **Language:** TypeScript everywhere, `strict: true`. No `any` without a written reason.
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
| Unit | **Vitest** | Pure logic (gate derivation, forecast math, INR formatting, validators). |
| Component | **Vitest + React Testing Library** | Components render + behave; accessibility (labels, roles). |
| Contract | Vitest against **OpenAPI** | API request/response shapes match the spec; handshake payloads. |
| Integration | Vitest + local Postgres/LocalStack | A handshake end-to-end against the local mirror. |
| E2E (later) | Playwright | A full vertical slice through the real UI. |

- **Behaviour-first:** for new behaviour, write the failing test first (TDD), then implement. Presentational scaffolding (tokens, static gallery) is exempt.
- Tests live next to code: `Thing.tsx` → `Thing.test.tsx`.
- **Coverage bar:** ≥80% on domain logic (gates, money, validators, handshake handlers). UI-only files are not chased for coverage.
- Every **acceptance test** in a role spec must map to at least one automated test as that slice is built.
- Colour-never-sole-signal and RLS/visibility rules get explicit tests (they are trust guarantees).

---

## 4. Boundaries

**Always**
- Run `npm test` + `npm run build` before committing a slice.
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

Each slice = a little UI + a little backend + DB, runnable locally and demoable:

| Slice | Delivers | Visible outcome |
|---|---|---|
| **0. Skeleton + UI kit** ✅ | Repo, Vite app, design system gallery, test setup, these conventions | The homely Apple UI, clickable |
| 1. Changeability magic | Unit progress → gate engine → sales inventory (H1) | Set progress → gate flips in sales |
| 2. Booking + handoff | Sales books → CRM completeness gate → Customer Twin (H2) | Booking wizard, CRM accept, Customer 360 |
| 3. Customer home | My Pranava Home + progress tracker (T1, H10) | Buyer's warm portal |
| 4. Money | Demands → true-risk collections | Payment "why now", collections |
| 5+ | Legal, QA/handover, post-handover, management | Each a new visible slice |

Status: **Slice 0 complete** — app builds, tests pass, runs at `http://localhost:5173`.
