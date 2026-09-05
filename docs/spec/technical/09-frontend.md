# 09 · Frontend

Two React apps, one shared package, served by the API container. The workspace is v1's frontend moved from CRA to Vite and from JavaScript to TypeScript incrementally; My Pranava Home is the customer app already in this repo. Design rules: [`../foundation/design-language.md`](../foundation/design-language.md) (customer skin as written; workspace keeps v1's density on shared tokens until the design decision lands).

---

## 1. Layout

```
apps/workspace/                 apps/my-pranava-home/            packages/ui/
├── index.html                  ├── index.html                   ├── src/
├── vite.config.ts              ├── vite.config.ts               │   ├── tokens.css        # the only place colours/spacing/radii/type are defined
├── src/                        ├── src/                         │   ├── api/              # client.ts (axios + envelope + errors), types generated from OpenAPI
│   ├── main.tsx · App.tsx      │   ├── main.tsx · App.tsx       │   ├── auth/             # useSession(), SignInGate, realm-aware
│   ├── routes/                 │   ├── routes/                  │   ├── components/       # Button, Field, Table, Skeleton, EmptyState, ErrorState, StatusChip, GateChip, Money, DateText…
│   ├── modules/<role>/         │   ├── features/<t1..t6>/       │   ├── states/           # <Async> wrapper: loading / empty / error / data
│   │   ├── pages/ (containers) │   └── …                        │   └── format/           # inr(), date(), relativeTime() (from v1 lib/format.js)
│   │   └── components/ (pure)  └── e2e/                         ├── package.json · tsconfig.json · vitest.config.ts
│   └── lib/  (v1 lib/*.js → .ts)
└── e2e/                        (Playwright, 3 breakpoints)
```

`packages/ui` is a workspace package (`"@homeflow/ui"`), consumed by both apps; no relative imports across apps. Root `package.json` workspaces: `apps/*`, `packages/*`, `infra`.

---

## 2. Stack and allowed dependencies

React 19 · TypeScript `strict` · Vite 6 · Tailwind 3 (theme = `tokens.css` variables only; no arbitrary values — an ESLint rule bans `[#…]` and `[…px]`) · react-router 7 · axios · react-hook-form + zod · recharts · date-fns · lucide-react. Test: Vitest + React Testing Library + `@testing-library/user-event`; Playwright. That is v1's list plus Vite; nothing else without asking. shadcn components already in v1 move into `packages/ui/components` as they are touched.

No data-fetching library: `packages/ui/api/client.ts` + a small `useQuery(key, fn)` hook (cache map, stale-while-revalidate, invalidation by key prefix) — ~80 lines. Revisit TanStack Query only if the hook grows past that.

---

## 3. API client

```ts
export const api = axios.create({ baseURL: "/api/v1", withCredentials: true, headers: { "X-Requested-With": "HomeFlow" } });
api.interceptors.response.use(r => r.data.data ?? r.data, e => Promise.reject(toApiError(e)));   // unwraps { data, meta }; typed ApiError { code, message, field?, source_ref? }
```

- `401` → `useSession()` flips to signed-out → `<SignInGate>` renders the sign-in screen (workspace: "Continue with Google"; customer: phone + OTP) and returns to the current route after.
- `409 GATE_FAILED` / `422 SOURCE_FIELD_INVALID` are rendered as structured blockers with links to the source record (never a toast with a raw message).
- Types: `npm run gen:api` runs `openapi-typescript` (dev dependency) against the running API's `openapi.json` into `packages/ui/src/api/types.ts`; committed; CI fails if stale.

---

## 4. Auth state and realms

`useSession()` calls `GET /me/session` once on load → `{ realm, display_name, role_ids, project_ids, all_projects }` or 401. The workspace stores the **selected project** in `localStorage` (limited to `project_ids`) and sends it as `X-Project-Id` for selector context; the server still derives scope. Customers get a booking switcher from `GET /me`.

Route guards are by role: `<RequireRole roles={["sales"]}>` hides navigation and redirects, but authorisation is the server's; the UI never trusts its own guard.

---

## 5. Routing (workspace)

One route tree, one `h1` per page, module folders map to nav sections. v1's 27 pages migrate in place under `modules/<role>/pages` with their paths preserved so bookmarks keep working:

`/my-day` · `/projects/:id/units` (inventory) · `/units/:id` (Unit 360: identity, spec, progress, changeability, QA, snags, as-built, passport, events) · `/bookings/:id` (Booking 360) · `/customers/:id` (Customer 360, 12 tabs from v1) · `/collections` · `/forecast` · `/documents` · `/registration` · `/qa` · `/handover` · `/warranty` · `/control-tower` · `/admin/*` (Policy Studio) · `/search`.

Customer app: `/` (home = T1–T6), `/journey`, `/payments`, `/documents`, `/personalise`, `/passport`, `/keys`, `/requests`, `/settings`.

---

## 6. Required states and patterns

- Every list and every 360 tab renders through `<Async>`: **skeleton** (shape of the content), **empty** (real copy, a next action), **error** (code + retry + request id), data. A page without all four fails review.
- Container/presentation split: `pages/*` fetch and hold state; `components/*` are pure and story-testable.
- Status is never colour-only: `<StatusChip>`/`<GateChip>` always pair icon + label; contrast ≥ 4.5:1 from tokens.
- Forms: react-hook-form + zod schemas mirrored from the OpenAPI types; server field errors map onto fields by `field`.
- Money via `<Money>` (INR lakh/crore formatting from v1's `format.js`); dates via `<DateText>` in IST with UTC in `title`.
- Realtime: none. Lists poll on focus + every 60 s (My Day every 30 s). SSE is the upgrade path ([`../foundation/architecture.md`](../foundation/architecture.md) §11).
- Uploads: `presign → PUT → confirm` in `packages/ui/api/upload.ts` with progress; images downscaled client-side before upload (max 2000 px).
- Accessibility: keyboard reachable, visible focus, labelled controls, `aria-live` for async results; checked by `@axe-core/playwright` in e2e.

---

## 7. Build and serving

`npm run build` in each app → `dist/`; the Dockerfile copies them to `services/api/static/workspace` and `static/customer`. `app.py` mounts them with `StaticFiles(html=True)` selected by `Host` (`WORKSPACE_HOST` / `CUSTOMER_HOST`); unknown paths fall back to `index.html` so client routing works; `/api/*` and `/auth/*` are matched first. Cache headers: hashed assets `immutable, max-age=1y`; `index.html` `no-cache`.

Dev: `npm run dev` per app (Vite on `:5173` / `:5174`) proxying `/api` and `/auth` to `:8001`, so cookies stay same-origin through the proxy.

---

## 8. Tests

| Level | Tool | Bar |
|---|---|---|
| Component | Vitest + RTL, `*.test.tsx` beside the component | every `packages/ui` component; every page's four states |
| App | Vitest, route-level with mocked `api` | happy path per module page |
| E2E / visual | Playwright, `apps/*/e2e/*.spec.ts`, 1440 / 768 / 375, against `make dev` with demo seed | every slice: screenshots to `e2e/__screenshots__/`, zero console errors, axe clean |

`npm run build` + `tsc --noEmit` + `npm run lint` + `npm test` must pass before a slice is done (CLAUDE.md definition of done).
