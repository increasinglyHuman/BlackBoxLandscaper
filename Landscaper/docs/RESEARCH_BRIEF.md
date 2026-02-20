# BlackBox Landscaper — Research Brief

**Date:** 2026-02-20
**From:** Legacy team (OAR converter)
**For:** Landscaper team bootstrapping

---

## What This Is

BlackBox Landscaper is a standalone Three.js library for procedural world population. It started as "BlackBox Gardener" — a tree generation system to replace billboard sprites from OpenSim OAR files — but the architecture is far more general. **The scatter system is content-agnostic.** Trees are just Layer 0.

This brief covers two research phases:
1. **Vegetation research** — algorithms, libraries, species mapping, performance budgets
2. **Expanded scatter** — rocks, NPCs, particles, sci-fi, weather, general object decoration

Full technical details: see `BLACKBOX_LANDSCAPER_RESEARCH.md` (in Legacy repo at `docs/features/`) and the expanded analysis below.

---

## Context: What Legacy Provides

The OAR converter (`blackbox/Legacy`) produces:
- **GLB scene** with all geometry, materials, textures
- **manifest.json** with object metadata, permissions, positions
- **Terrain heightmap** (.r32 format, 256x256 grid)
- **Linden tree data**: PCode 255/95 nodes with `State` field (species ID 0-20) + position + scale

Currently, Linden trees render as **crossed billboard sprites** (two perpendicular textured quads). The Landscaper replaces these with procedural 3D vegetation and extends the system to populate entire worlds.

### OpenSim Tree Species (21 types + 5 grass)

| State | Species | Recommended Generator |
|-------|---------|----------------------|
| 0 | Pine 1 | ez-tree (conical preset) |
| 1 | **Oak** | ez-tree (wide dome) |
| 2 | Tropical Bush 1 | ez-tree (bush) |
| 3 | Palm 1 | Custom (trunk + frond fan) |
| 4 | Dogwood | ez-tree (small dome) |
| 5 | Tropical Bush 2 | ez-tree (bush variant) |
| 6 | Palm 2 | Custom |
| 7-8 | Cypress 1/2 | ez-tree (tight angles, upward force) |
| 9 | Pine 2 | ez-tree (pine variant) |
| 10 | Plumeria | ez-tree (small, flowering) |
| 11 | Winter Aspen | ez-tree (no leaves, white bark) |
| 12-13 | Winter Pine 1/2 | ez-tree (pine + snow) |
| 14 | Eucalyptus | ez-tree (tall trunk, sparse) |
| 15 | Fern | Custom (radial rosette) |
| 16-18 | Kelp/Eelgrass/Sea Sword | Billboard strips |
| 19 | Beach Grass | Billboard cluster |
| 20 | Kelp 2 | Billboard strips |

**Coverage:** ez-tree handles ~70%, custom generators ~20%, enhanced billboards ~10%.

---

## Core Architecture

```
BlackBox Landscaper (npm package)
├── Layer Registry          # Ordered decoration layers with cross-exclusion
├── Species Registry        # OpenSim State ID -> generator params (JSON)
│
├── Generators
│   ├── EzTreeAdapter       # @dgreenheck/ez-tree wrapper (~70% of trees)
│   ├── PalmGenerator       # Straight trunk + frond fan
│   ├── BushGenerator       # Fern rosette, hedge
│   ├── RockGenerator       # Erkaman scraping + noise displacement
│   ├── CrystalGenerator    # Hexagonal prism clusters
│   ├── MushroomGenerator   # Cylinder + LatheGeometry cap
│   ├── BillboardGenerator  # Underwater plants, grass, distant LOD
│   └── LODBuilder          # THREE.LOD from any generator output
│
├── Scatter System
│   ├── PoissonScatter      # Natural distribution (trees, rocks)
│   ├── ClusteredScatter    # Group distribution (ruins, market stalls)
│   ├── DensityScatter      # Probability-weighted (grass near water)
│   ├── GridScatter         # Regular with jitter (fences, lanterns)
│   ├── TerrainSampler      # Heightmap queries, slope calculation
│   ├── BiomeMap            # Region -> vegetation palette
│   └── ExclusionManager    # Cross-layer exclusion zones
│
├── Rendering
│   ├── InstancePool        # InstancedMesh / BatchedMesh management
│   ├── WindShader          # Vertex displacement (sinusoidal + noise)
│   ├── LeafMaterial        # Translucency via wrap lighting
│   ├── GrassRenderer       # Frustum-local grass blade system
│   └── EmissiveMaterial    # Bioluminescence for sci-fi vegetation
│
├── Atmosphere
│   ├── ParticleLayer       # Fireflies, dust, pollen, rain, snow
│   ├── BoidsSystem         # Flocking for butterflies, birds, insects
│   ├── FogLayer            # Valley mist, volumetric fog
│   └── WeatherController   # Rain/snow/fog layer orchestration
│
├── NPCs
│   ├── PatrolAgent         # Yuka.js waypoint patrol
│   ├── CrowdManager        # InstancedSkinnedMesh for 50+ NPCs
│   └── AnimationPool       # Shared AnimationMixer management
│
└── Editor Tools
    ├── VegetationBrush     # Paint/erase vegetation
    ├── BiomePainter        # Define biome regions
    ├── SeasonController    # Spring/summer/autumn/winter preview
    ├── WindController      # Direction, strength, gustiness
    └── LayerInspector      # Toggle layers, adjust density
```

### Core Dependencies

```json
{
  "@dgreenheck/ez-tree": "^1.1.0",
  "poisson-disk-sampling": "^2.3.1",
  "simplex-noise": "^4.0.1",
  "three": ">=0.160.0",
  "yuka": "^0.7.0"
}
```

---

## The Key Insight: Layers, Not Types

The scatter system is **layer-based**, not type-based. Each layer defines:

```typescript
interface DecorationLayer {
    id: string;
    name: string;                      // "Ancient Ruins", "Campfires", "Gnome Patrol"
    instanceTypes: InstanceType[];     // Asset pool with weights
    algorithm: 'poisson' | 'clustered' | 'density' | 'grid';
    count: number;
    minDistance: number;
    constraints: Constraint[];         // Slope, height, exclusion
    priority: number;                  // Higher places first
    excludesLayers?: string[];         // "Don't place trees where ruins are"
    animate?: AnimationConfig;         // Wind, patrol AI, particles
}
```

Any mesh goes through the same pipeline:
1. **Generate** or **load** the mesh
2. **Scatter** positions using layer's algorithm
3. **Constrain** to terrain + neighboring layers
4. **Instance** for performance
5. **Animate** if needed (wind, patrol, particles)

---

## What Can Be Scattered

| Category | Examples | Algorithm | Special Handling |
|----------|---------|-----------|-----------------|
| Trees | Oak, pine, palm, alien | Poisson | LOD, wind shader |
| Rocks | Boulders, pebbles | Poisson | Tilt to slope, partial burial |
| Ground cover | Grass, flowers, ferns | Density | Frustum-culled instancing |
| Ruins | Broken walls, columns | Clustered | Group objects, cross-layer exclusion |
| Props | Barrels, crates, signs | Clustered/Grid | Near buildings |
| Lights | Lanterns, campfires | Grid/Poisson | Attach point light per instance |
| NPCs | Gnomes, merchants | Poisson + waypoints | Yuka.js patrol AI |
| Particles | Firefly zones, dust | Density | Emitter per scatter point |
| Weather | Rain, snow, fog | Grid/Density | Height constraints |
| Sci-fi | Crystals, bioluminescent plants | Poisson | Emissive materials + bloom |

---

## Performance Budgets (256x256m region)

| Category | Count | Triangles | Draw Calls |
|----------|-------|-----------|------------|
| Terrain | 1 | 130,000 | 1 |
| Close trees (0-50m) | ~10 | 50,000 | 1/species |
| Mid trees (50-200m) | ~30 | 30,000 | 1/species |
| Far trees (200m+) | ~100 | 800 | 1/species |
| Grass | ~20,000 | 120,000 | 1 |
| Rocks | ~50 | 25,000 | 1/variant |
| Props/ruins | ~30 | 15,000 | 1/type |
| NPCs | 5-15 | 10,000 | 1/each |
| Particles | ~2,000 | N/A | 1-3 |
| **Total** | | **~380,000** | **~30-40** |

**Budget:** Under 1M triangles. Generation time under 1 second. Memory ~20-30MB.

---

## ez-tree: What It Can (and Can't) Do

### CAN do:
- **Standard trees** (oak, pine, aspen, ash, bush) — 17 built-in presets
- **Dead/spooky trees** — leaves.count=0, high gnarliness, dark tint
- **Bonsai** — trunk.length=0.1, many levels, small scale
- **Alien tentacle plants** — extreme gnarliness (0.8+), high twist, downward force, no leaves
- **Coral structures** — no leaves, flat shading, high gnarliness, organic tint
- **Sci-fi vegetation** — parameter abuse + custom emissive materials + bloom pass

### CANNOT do (need custom generators):
- **Mushrooms** — need stem + cap (LatheGeometry)
- **Crystals** — need faceted prisms (extruded hexagons)
- **Palms** — need straight trunk + frond fan (special case)
- **Ferns** — need radial rosette (no branching)
- **Geometric flora** — recursive polyhedra, impossible shapes

### Parameter space is wider than presets suggest:
- 50+ parameters across structure, deformation, bark, leaves, force
- Pine preset uses 100 children at level 0; bush uses trunk.length=0.1
- The presets are conservative — extreme values create things the author never intended

---

## NPC Feasibility: "Roving Gangs of Gnomes"

| Scale | Approach | Performance |
|-------|----------|-------------|
| **5-15 NPCs** | Standard SkinnedMesh + Yuka.js AI | Easy, 60fps |
| **50-100 NPCs** | Animation texture approach (bake frames to DataTexture) | Medium effort, 60fps |
| **200+ NPCs** | LOD (distant = billboard) + WebGPU compute | Hard, future |

**Yuka.js** (github.com/Mugen87/yuka) is the AI library:
- Steering behaviors: seek, flee, arrive, wander, pursuit, evade, obstacle avoidance
- Navmesh pathfinding (A*)
- State machines for complex behavior
- Engine-agnostic, works with Three.js directly

For 10-20 gnomes with patrol waypoints and idle/walk animation blending — trivially within budget.

---

## Atmospheric Particles

| Effect | Particle Count | Technique | Performance |
|--------|---------------|-----------|-------------|
| Fireflies | 200-500 | Points + additive blend + bloom | Trivial |
| Dust motes | 1,000-5,000 | Points in light beams | Trivial |
| Butterflies | 50-200 | Boids + sprite sheet | Low |
| Rain | 5,000-10,000 | Recycling particle pool | Low |
| Snow | 3,000-5,000 | Same + horizontal drift | Low |
| Pollen | 500-2,000 | Points with upward drift | Trivial |

Total atmospheric particles: ~2,000-5,000 active. Completely within budget.

---

## Existing Poqpoq World Code to Reuse

**`SpatialDistributor.ts`** in `blackbox/World/src/environment/` already implements:
- Poisson disc, clustered, density, grid distribution
- Terrain-aware placement with slope constraints
- Exclusion zones
- Batched creation with thin instances
- `InstanceType` interface (assetPath, weight, scaleMin/Max, yOffset, rotation)

The distribution algorithms are pure math — engine-agnostic. A Three.js port of the scatter logic is nearly mechanical. The rendering layer (InstancedMesh vs Babylon ThinInstances) is the only engine-specific part.

---

## Implementation Roadmap

### Phase 1 — Foundation (1-2 weeks)
- npm package scaffold
- ez-tree integration + species registry (21 OpenSim species as JSON)
- LOD system (LOD 0 = ez-tree, LOD 2 = current billboard)
- InstancedMesh pooling

### Phase 2 — Scatter (1 week)
- Port SpatialDistributor distribution algorithms to Three.js
- Terrain heightmap sampling (reuse OAR .r32 data)
- Cross-layer exclusion zones
- Biome support

### Phase 3 — Visual Polish (1-2 weeks)
- Vertex shader wind animation
- Leaf translucency material
- Bark/leaf texture atlases
- Seasonal tint uniforms

### Phase 4 — Extended Generators (1 week)
- Palm, fern, underwater plant generators
- Rock generator (Erkaman scraping method)
- Crystal, mushroom generators

### Phase 5 — Atmosphere & NPCs (1-2 weeks)
- Particle layer system (fireflies, dust, rain, snow)
- Boids for butterfly/bird flocking
- Yuka.js patrol AI for NPC scatter
- Valley fog planes

### Phase 6 — Editor Tools (1-2 weeks)
- Vegetation brush for poqpoq World
- Layer inspector with density controls
- Season preview slider
- Wind/weather controls

### Phase 7 — Advanced (future)
- WebGPU compute grass renderer
- GPU frustum culling
- Impostor billboards (multi-angle pre-render)
- BatchedMesh for mixed-species single-draw-call
- InstancedSkinnedMesh for crowd NPCs

---

## Key References

### Tree Generation
- **ez-tree:** https://github.com/dgreenheck/ez-tree (1,200 stars, MIT, Three.js native)
- **ez-tree demo:** https://eztree.dev
- **proctree.js:** https://github.com/supereggbert/proctree.js (190 stars, reference only)

### Rock Generation
- **gl-rock:** https://github.com/Erkaman/gl-rock (Erkaman scraping method)

### Scatter/Distribution
- **poisson-disk-sampling:** https://github.com/kchapelier/poisson-disk-sampling (npm, 246 stars)
- **fast-2d-poisson-disk-sampling:** https://github.com/kchapelier/fast-2d-poisson-disk-sampling

### Particles & Atmosphere
- **Three Nebula:** https://github.com/creativelifeform/three-nebula (particle engine)
- **terra:** https://github.com/spacejack/terra (WebGL grass, 521 stars)
- **three-volumetric-pass:** https://github.com/Ameobea/three-volumetric-pass

### NPC/AI
- **Yuka.js:** https://github.com/Mugen87/yuka (game AI: steering, navmesh, FSM)
- **three-pathfinding:** https://github.com/donmccurdy/three-pathfinding

### Noise
- **FastNoiseLite:** https://github.com/Auburn/FastNoiseLite (3,300 stars, multi-language + GLSL)
- **simplex-noise.js:** https://github.com/jwagner/simplex-noise.js (1,800 stars)

### Three.js Built-ins
- `InstancedMesh`, `BatchedMesh`, `LOD`, `MeshSurfaceSampler`, `SimplexNoise`
