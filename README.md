# HomeFlow

Post-sales operating system for Pranava’s villa and apartment projects.

After a family books a unit, HomeFlow is the system that collects money, generates papers, tracks that exact home’s construction, handles customer changes (kitchen, flooring), registers the sale, hands over keys, and supports the home after move-in.

This is **not** the office-leasing / FMWork product in `pranavaPortal`. Same company, different product.

## What’s in this repo

| Path | What it is |
|---|---|
| [docs/CONTEXT.md](docs/CONTEXT.md) | Plain-English product story and how the flow works |
| [docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf](docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf) | Full design spec v8 (source of truth) |
| [canvases/homeflow-2-design-spec.canvas.tsx](canvases/homeflow-2-design-spec.canvas.tsx) | Interactive canvas of the full spec — keywords, journey, modules, gates, Emergent build rules |

## How to open the canvas

In Cursor, open this folder as the workspace, then open `canvases/homeflow-2-design-spec.canvas.tsx` beside chat. Start on the **Plain English** tab.

## Three things that never mix

- **Project** — East Crest (or any site). All reporting rolls up here.
- **Unit** — the physical villa/flat. Exists before it is sold. Keeps history if the buyer changes.
- **Booking** — this customer + this unit + this ownership period.
