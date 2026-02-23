<p align="center">
  <img src="resources/heroImage.png" alt="BlackBox Landscaper" width="360">
</p>

<h1 align="center">BlackBox Landscaper</h1>

<p align="center">
  <a href="https://poqpoq.com/landscaper/"><img src="https://img.shields.io/badge/live%20demo-poqpoq.com%2Flandscaper-66cc88?style=flat-square" alt="Live Demo"></a>
  <img src="https://img.shields.io/badge/three.js-%E2%89%A50.160-blue?style=flat-square" alt="Three.js >=0.160">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License">
  <img src="https://img.shields.io/badge/phase-2%20%E2%80%94%20scatter%20system-orange?style=flat-square" alt="Phase 2">
</p>

<p align="center">
  Procedural world population for Three.js — trees, rocks, NPCs, particles, and general object decoration.
  <br>
  Layer-based scatter system with terrain-aware placement.
</p>

---

## Features

- **26 species** — 21 OpenSim-compatible trees + 5 procedural rock types
- **4 scatter algorithms** — Poisson disk, clustered, density map, and grid
- **Interactive brush tools** — paint, erase, and select with brush cursor
- **Transform gizmo** — rotate, move, and scale selected instances (R/G/S keys)
- **Species preview** — real-time rotating 3D preview of each species
- **Terrain-aware placement** — slope constraints, height sampling, spacing rules
- **Save/export** — download vegetation manifest as JSON, or push directly to poqpoq World
- **Embeddable** — runs standalone or as an iframe inside poqpoq World with postMessage bridge

## Generators

| Generator | Species | Method |
|-----------|---------|--------|
| **ez-tree** | 14 species | Procedural L-system trees via [@dgreenheck/ez-tree](https://github.com/dgreenheck/ez-tree) |
| **rock** | 5 species | Procedural scrape + noise rocks (boulder, river stone, cliff, mossy, slab) |
| **billboard** | 5 species | Textured quad billboards |
| **palm** | 2 species | Stub (planned) |
| **fern** | 1 species | Stub (planned) |

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173` — click the spinning cube to enter the app.

### Controls

| Key / Action | Effect |
|---|---|
| **Spacebar** | Cycle tool modes (orbit / paint / erase / select) |
| **Click + drag** (paint) | Place trees within brush radius |
| **Click + drag** (erase) | Remove trees within brush radius |
| **Click** (select) | Pick a tree, shows transform gizmo |
| **Shift + click** | Multi-select |
| **R** / **G** / **S** | Rotate / Grab (translate) / Scale gizmo mode |
| **Delete** / **Backspace** | Remove selected trees |

## Architecture

```
src/
├── demo/              Dev harness (main.ts, BrushController, splash screen)
├── generators/        Tree mesh generators (ez-tree adapter, billboard)
├── scatter/           Core scatter system + algorithms
│   └── algorithms/    Clustered, Poisson, density, grid
├── species/           Species registry + OpenSim species definitions
├── rendering/         Scene populator, LOD builder, instance pool
└── types/             Core type definitions
```

**Design principle:** Layer-based scatter — the same pipeline handles trees, rocks, NPCs, particles, and any other decoration type. Each layer defines species, algorithm, count, spacing, and constraints.

## Integration with poqpoq World

When embedded as an iframe inside [poqpoq World](https://poqpoq.com/world/), Landscaper communicates via `postMessage`:

- **Landscaper → World:** `ready`, `save-manifest`, `request-terraformer`, `close`
- **World → Landscaper:** `init-context`, `terrain-data`

The splash screen auto-skips when embedded. World-only action buttons (Save to World, Open Terraformer, Return to World) appear only in embedded mode.

## Performance Budget

For a 256x256m region:
- Under 1M triangles
- ~30–40 draw calls
- Generation under 1 second
- Memory ~20–30MB

## Scripts

```bash
npm run dev        # Vite dev server
npm run build      # Production build (demo app)
npm run build:lib  # Library build (npm package)
npm run lint       # TypeScript type check
npm run test       # Run tests
```

## Part of the BlackBox Creative Suite

[World](https://poqpoq.com/world/) · [Legacy](https://poqpoq.com/legacy/) · [Animator](https://poqpoq.com/animator/) · [Skinner](https://poqpoq.com/skinner/) · [Terraformer](https://poqpoq.com/terraformer/) · [Landscaper](https://poqpoq.com/landscaper/)

## License

MIT — Allen Partridge ([increasinglyHuman](https://github.com/increasinglyHuman))
