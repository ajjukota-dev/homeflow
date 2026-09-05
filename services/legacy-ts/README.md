# legacy-ts — the TypeScript prototype (porting reference only)

`services/legacy-ts/api` (Node/Express + PGlite) and `apps/legacy-ts/workspace` (React 18 + Vite, 8 screens)
are the pre-2.0 TypeScript prototype. They are kept **only as the porting checklist** and are not built,
tested or deployed by anything at the repo root. The pure engines in `services/legacy-ts/api/src/`
(`gates.ts`, `collections.ts`, `clearance.ts`, `readiness.ts`, `handover.ts`, `tower.ts`, `legal.ts`) and their
`*.test.ts` cases are ported to `services/api/domain/` per `docs/spec/technical/06-domain-engines.md`
(TASKS Vivek 11 / Amarsh 1); the eight workspace screens are ported to `apps/workspace/` per TASKS Vivek 8
and the front-half slices. Each file is deleted from here once its Vitest cases pass against the Python
engine or the Vite screen that replaces it, so this folder shrinks to nothing and is then removed.
