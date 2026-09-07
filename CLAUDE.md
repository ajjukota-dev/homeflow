# HomeFlow — Engineering Rules

Production-grade, scalable, maintainable. This is a real product we will scale and operate, not a prototype. Every change follows these rules. When in doubt, favour clarity and long-term maintainability over cleverness or speed.

**Spec is authoritative.** Requirement authority is the client PDF `docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`. The build contract is `docs/specs/` (one file per feature; `00-conventions.md` applies to all) with the plan and decisions in `TODO.md`. `docs/spec/` and `docs/HOMEFLOW-OS.md` are legacy AI-derived drafts — cross-check only; where they disagree with `docs/specs/`, `docs/specs/` wins. Read the feature's spec file before implementing and touch only the paths in its "Files" list.

---

## Architecture principles

- **Local-first, AWS-parity.** Everything runs on a laptop (PGlite + Express) and deploys to AWS unchanged by re-pointing env (`docs/spec/foundation/architecture.md` §6b). Never make a cloud service a hard dependency of a core workflow.
- **Bounded contexts = role modules.** `project-site, sales, crm-rm, accounts, legal, qa, post-handover, customer, management`. A context never reads another context's tables directly — only via its API or events (handshakes H1–H12).
- **Project-partitioned.** Every downstream row carries a derived `project_id`; enforce RLS. Never ask a user for a value that can be derived.
- **Event-sourced audit.** Consequential changes emit an immutable event (`docs/spec/foundation/event-log.md`). Append-only; no hard deletes of financial/legal/commitment/spec history.
- **Config over code.** Journey/SLA/gates/templates/copy are data (Policy Studio). Never hard-code East Crest values (durations, charges, stage names).

## SOLID + system design

- **Single Responsibility.** One reason to change per module. Split files >200 lines. UI: separate container (data) from presentation (render).
- **Open/Closed.** Extend via configuration and composition, not by editing core logic. Gate rules, journey stages, scores are data-driven.
- **Liskov / interfaces.** Program to interfaces. A handler returns a plain result; the transport (Express now, Lambda later) adapts it. Handlers must not import Express/AWS types.
- **Interface Segregation.** Small, purposeful contracts. API payloads match `data-model.md`; don't leak internal fields across a handshake.
- **Dependency Inversion.** Domain logic depends on abstractions (a `db` port, an `events` port), not concretes. The same handler runs under Express and Lambda because it depends on injected ports, not the runtime.
- **DRY via shared packages.** Cross-app code lives in `packages/` (UI, core types, event schemas). No copy-paste between apps/services.
- **Explicit boundaries.** Pure domain logic (gate engine, forecast math) is framework-free and unit-tested in isolation.

## Code standards

- **TypeScript strict**, no `any` without a written reason. No unused exports.
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
├── docs/spec/            # THE BUILD CONTRACT (foundation/ + roles/) — authoritative
├── apps/
│   └── workspace/        # internal React app (Vite + Tailwind + Radix)
│       ├── src/ui/       #   design-system components (→ extract to packages/ui at app #2)
│       ├── src/pages/    #   screens (one per role view)
│       ├── src/lib/      #   utilities (cn, …)
│       ├── src/api.ts    #   typed API client
│       └── e2e/          #   Playwright visual/E2E specs + __screenshots__
├── services/
│   └── api/              # backend domain service (Node/TS)
│       └── src/          #   db.ts · gates.ts (pure engine) · handlers.ts (Lambda-portable) · server.ts (Express shell)
├── infra/                # AWS CDK — bin/ · lib/ (stacks) · lambda/ — deploy-ready, synth-verified
├── package.json          # root: orchestration scripts (test/build/synth across packages)
└── CLAUDE.md             # these rules
```

- Future apps: `apps/my-pranava-home/` (customer). Future shared: `packages/ui`, `packages/core` (types + event schemas).
- Domain logic (gate engine, forecast math) is **pure and framework-free** so it unit-tests in isolation and ports from Express → Lambda unchanged.

## Testing discipline

- **TDD for behaviour** — failing test first for domain logic (gates, money, validators, handlers).
- **Levels:** unit (Vitest), component (RTL), contract (OpenAPI), integration (local mirror), **visual/E2E (Playwright)**.
- **Playwright after every slice** — screenshot the new/changed screens at 1440 + 768 + 375, review them, and only advance when they genuinely look professional. Screenshots live in `e2e/__screenshots__/`.
- Coverage ≥80% on domain logic. Every role acceptance test maps to ≥1 automated test as its slice is built.

### Test suite layout

| Layer | Location | Runner |
|---|---|---|
| Backend unit (pure engine) | `services/api/src/gates.test.ts` | Vitest |
| Backend integration (real PGlite) | `services/api/src/handlers.test.ts` | Vitest |
| Frontend component | `apps/workspace/src/**/*.test.tsx` | Vitest + RTL |
| Visual / E2E | `apps/workspace/e2e/*.spec.ts` | Playwright (3 breakpoints) |

**Run everything from root:** `npm test` (backend + frontend units) · `npm run test:e2e` (Playwright) · `npm run build` · `npm run synth` (CDK). Tests live next to the code they cover.

## Definition of done (per slice)

A slice is done only when **all** are true:
1. `npm run build` + typecheck clean.
2. Unit/component tests pass; new behaviour has tests.
3. Playwright screenshots reviewed at 3 breakpoints — looks professional, matches design-language, no console errors.
4. Loading/empty/error states exist.
5. No spec drift (or the spec was updated first, foundation-first).
6. Local stack (`make dev`) still boots.

## Boundaries

**Always:** run tests + build before finishing a slice; use design tokens; derive `project_id` + RLS; keep the local stack green; screenshot-verify UI.
**Ask first:** DB schema/migrations; new dependency; changing a foundation spec; CI/infra changes; widening customer-visible data.
**Never:** commit secrets; let Sales/CRM code mutate unit physics/gates; auto-send consequential customer comms from AI; hard-delete material history; hard-code project-specific values; introduce glass/translucency.

## Autonomous build queue — continuation protocol

This repo is being built by an unattended agent working through `docs/specs/*.md` one spec at a
time, checkpointing state into `TODO.md` so the session can be picked up cold by anyone (a
different machine, a different person, a fresh Claude Code session with zero prior conversation).

**If your very first message in a session on this repo is just "continue" (or similarly bare):**
read `TODO.md`'s `## CONTINUE HERE` section (near the top) and resume from what it names — don't
ask what to do next, that section is written to answer it. If that section is stale (its own
timestamp is old and the work it describes already looks done), fall back to: scan `TODO.md`'s
status board for the first spec not marked 🟩, read that spec's file in full, and build its
deferred piece (usually the UI — many specs shipped backend-only first and note their own UI as
"deferred" in their own Build note).

**Operational discipline that got the build this far — keep following it:**
- **One agent/fork per spec, sequentially.** Before launching a subagent for a spec, check nothing
  is already running on it (`ListAgents`, or check `git status`/recent `git log` for uncommitted
  or freshly-committed work touching that spec's files) — launching a duplicate risks two agents
  editing the same files concurrently.
- **`advisor()` (or an equivalent independent review) before declaring any slice done.** Every use
  of it in this build has surfaced a real defect worth fixing before landing.
- **Never claim a test suite "passed" or a flow "works" without having actually run it to
  completion and read the real output.** Run the full backend vitest suite AND the full Playwright
  suite from a freshly-reset DB (`npm run db:reset` in `services/api` — stop any live API server
  cleanly first) before calling a slice done.
- **Watch for two recurring bug classes**, found repeatedly across specs: a raw DB id (`unit_id`,
  `user.id`) displayed instead of a joined friendly label; and a GET/compute-on-read handler that
  unconditionally writes an audit/snapshot row on every read (use a side-effect-free read variant).
- **`page.getByRole` substring-matches by default in Playwright.** Scope to
  `page.locator("main")` and/or pass `{ exact: true }` for short action-verb labels ("Save",
  "Accept", "Send") to avoid false matches against sidebar nav.
- **ALTER a pre-existing table rather than creating a parallel one** for the same concept; check
  what already exists before adding a migration.
- **An external auto-checkpoint mechanism sometimes commits in-progress working-tree changes
  directly to `main`** (message pattern `claude: update <files>`), outside any branch/PR/CI gate.
  Check `git log --oneline -10 main` before assuming a clean starting point. If found: don't
  rewrite history (the content is usually legitimate finished or in-progress work) — verify the
  diff matches what was intended (`git show --stat <sha>`), then land normally on top of it (a
  follow-up commit direct to `main` is acceptable for doc-only changes, matching this repo's own
  convention of small doc commits landing without a PR).
- **After landing a spec, push `main` to the `Amarsh` branch** (`git push origin main:Amarsh`) so
  progress stays visible to whoever is watching it on GitHub.
- **TODO.md is a living doc** — fold every non-trivial finding into it (the owning spec's
  status-board row, plus a "Found while building" entry in its Record section) as it happens, not
  at the end. Some of its lines exceed normal editor/tool read limits (70,000+ characters) — if a
  line is too long to read or edit directly, read/edit it as a line array (e.g.
  `Get-Content -Encoding UTF8` in PowerShell, `[regex]::Matches` to find row markers,
  `[System.IO.File]::WriteAllLines` with a BOM-less UTF8 encoding to write back) rather than
  giving up on updating it.

## Commands

Frontend `apps/workspace`: `npm run dev | build | test | lint`.
API `services/api`: `npm start | test`.
Infra `infra`: `npm run synth | deploy | destroy` (AWS; see `infra/README.md`).
E2E: `npm run e2e` (Playwright) from `apps/workspace`.
