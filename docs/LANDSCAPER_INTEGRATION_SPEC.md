# BlackBox Landscaper — Cross-Team Integration Spec

**Date:** 2026-02-20
**From:** Landscaper Team
**To:** World Team, Scripter Team, Legacy Team, Terraformer Team
**Status:** Phase 2 Complete (Scatter System) — defining integration contracts

---

## What Landscaper Is

BlackBox Landscaper is a standalone npm library (`@blackbox/landscaper`) for procedural world population. It has two halves:

| Half | What It Does | Three.js? |
|------|-------------|-----------|
| **ScatterSystem** | Generates spatial positions using distribution algorithms (poisson, clustered, density, grid). Applies constraints (slope, height, exclusion zones). Outputs pure data. | No |
| **ScenePopulator** | Takes scatter output, generates meshes, registers with InstancePool, renders instanced geometry. | Yes |

**Key principle:** ScatterSystem is engine-agnostic math. It produces `PlacedInstance[]` — positions, rotations, scales, species IDs. No meshes, no scene graph, no rendering. Any consumer (World, Terraformer, a CLI tool) can use the same scatter engine.

### What Landscaper Produces

```typescript
interface PlacedInstance {
    id: string
    speciesId: string
    position: { x: number; y: number; z: number }
    rotation: { x: number; y: number; z: number }
    scale: { x: number; y: number; z: number }
}

interface DistributionManifest {
    id: string
    layerId: string
    instances: PlacedInstance[]
    algorithm: 'poisson' | 'clustered' | 'density' | 'grid'
    region: Region
    createdAt: Date
}
```

This is the **data contract**. Everything downstream consumes this format.

---

## 1. World Team Integration

### 1.1 Launch Pattern

Landscaper follows the existing external tool pattern (like Terraformer, Animator):

```
World build panel
├── Transform tools
├── Object placement
├── Terrain      → opens Terraformer
├── Animation    → opens Animator
├── Landscape    → opens Landscaper    ← NEW (Tier 2)
└── Quick Plant  → inline scatter      ← NEW (Tier 1)
```

**Tier 1 (inline):** Simplified scatter controls directly in World's build panel. World imports `@blackbox/landscaper` as a library and calls `ScatterSystem.scatter()`. No separate app opens. Good for quick placement — "drop 20 oaks around this building."

**Tier 2 (dedicated app):** Full Landscaper UI for multi-layer landscape design. Opens in a modal/new tab like Terraformer. For designing entire biomes, constraint zones, mixed species, density painting.

### 1.2 Terrain Handoff

When World launches Landscaper (Tier 2), it passes:

| Data | Format | Purpose |
|------|--------|---------|
| Terrain heightmap | `.r32` URL or `Float32Array` + dimensions | Ground height/slope sampling |
| Region bounds | `Region` object | Parcel boundaries, build permissions |
| Instance ID | `string` | NEXUS instance to write manifest to |
| Existing manifest | `DistributionManifest[]` (optional) | Edit existing vegetation, not just create |

Landscaper's `HeightmapTerrainSampler` accepts the `.r32` format directly (bilinear interpolation, matching Legacy's terrain export). For procedural terrains without a stored heightmap, World can serialize the ground mesh vertex positions as a `Float32Array`.

### 1.3 Tier 1 API — Inline Quick Scatter

The minimal API surface World calls directly for the build panel "Quick Plant" button:

```typescript
import { ScatterSystem } from '@blackbox/landscaper'
import type { DecorationLayer, Region } from '@blackbox/landscaper'

const scatter = new ScatterSystem()

// World calls this when user clicks "Plant" in build panel
const result = scatter.scatter(layer, {
    terrain: worldTerrainSampler,   // World provides its own terrain adapter
    region: parcelBounds,           // From NEXUS parcel data
    seed: Date.now(),
})

// result.instances → PlacedInstance[] — World renders these
// result.manifest  → POST to NEXUS for persistence
```

World implements its own `TerrainSampler` adapter that wraps its existing terrain system (Babylon.js or Three.js ground mesh raycasting).

### 1.4 Manifest Persistence via NEXUS

```
Landscaper (authoring)                    NEXUS (storage)                World (runtime)

scatter() → PlacedInstance[]  ──POST──→  placed_objects table  ──GET──→  manifest JSON
                                          { layerId, algorithm,          │
                                            instances[], region,         ▼
                                            seed, createdAt }      ScenePopulator
                                                                   + InstancePool
                                                                   + MeshGenerators
                                                                        │
                                                                        ▼
                                                                   InstancedMesh
                                                                   in scene
```

**NEXUS endpoints (proposed):**

| Method | Endpoint | Body/Response |
|--------|----------|---------------|
| `POST` | `/nexus/instances/:id/vegetation` | `{ manifests: DistributionManifest[] }` |
| `GET` | `/nexus/instances/:id/vegetation` | Returns stored manifests |
| `DELETE` | `/nexus/instances/:id/vegetation/:layerId` | Remove a layer |
| `PATCH` | `/nexus/instances/:id/vegetation/:layerId` | Update layer (re-scatter) |

World fetches manifests on region load. Landscaper writes them on save. Manifests are compact — 200 trees is ~15KB of JSON, not megabytes of geometry.

### 1.5 World Renders Locally

**Landscaper never sends meshes to World.** It sends the manifest. World imports `@blackbox/landscaper` for `ScenePopulator` + generators + `InstancePool` and renders client-side. This means:

- No mesh transfer over the network
- Each client generates identical trees from the same seed
- LOD, culling, and instancing happen locally
- World can swap generators or quality levels without touching the manifest

---

## 2. Scripter Team Integration

### 2.1 Answering Your Open Questions

From the [Scripter cross-team brief](CROSS_TEAM_SCRIPTER_DEPLOYMENT_2026-02-20.md):

> **Per-layer scripts:** Should scatter layers support a `script` property that auto-attaches to spawned objects?

**Yes — but with a nuance.** Instanced vegetation (InstancedMesh) can't have per-instance scripts because instances share a single draw call. Scripts attach at the **layer** level, not the instance level.

```typescript
interface DecorationLayer {
    // ... existing fields ...

    /** Script class name to attach to this layer's instances */
    scriptClass?: string
    /** Script parameters passed to constructor */
    scriptParams?: Record<string, unknown>
}
```

The script runs once per layer and receives the full `PlacedInstance[]` array. It can animate the entire group (wind shader), spawn particles at instance positions (fireflies near flowers), or react to events (season change swaps leaf colors).

For **individual** interactive objects (a specific tree that can be chopped down), those should be placed as regular World objects with scripts — not as instanced Landscaper vegetation. The Tier 1 Quick Plant can create individual (non-instanced) objects when count=1.

> **NPC scripts:** Should Landscaper's NPC placement pass script bindings through the manifest?

**Yes.** NPC spawn positions are just scatter output. The manifest includes `speciesId` which maps to an NPC type. World's script system reads the manifest and instantiates behavioral entities at those positions.

```typescript
// Landscaper manifest for NPC layer
{
    layerId: 'patrol-gnomes',
    instances: [
        { id: 'abc', speciesId: 'gnome_patrol', position: {x: 10, y: 0, z: 20}, ... },
        { id: 'def', speciesId: 'gnome_patrol', position: {x: -5, y: 0, z: 15}, ... },
    ],
    algorithm: 'poisson',
    ...
}

// World script system reads this and creates:
for (const inst of manifest.instances) {
    const npc = new GnomePatrolNPC(inst.position)
    npc.attachScript('GnomePatrol', { startPosition: inst.position })
    scene.add(npc)
}
```

Landscaper decides **where**. Scripts decide **what they do**.

### 2.2 Script → Landscaper API

Scripts should be able to query and trigger Landscaper at runtime:

#### Read API (query placed vegetation)

```typescript
// Available to WorldScript instances via this.world.landscaper
interface LandscaperQueryAPI {
    /** Get all instances within radius of a point */
    query(center: { x: number; z: number }, radius: number, filter?: {
        speciesId?: string
        layerId?: string
    }): PlacedInstance[]

    /** Get all instances in a layer */
    getLayer(layerId: string): PlacedInstance[]

    /** Get the nearest instance to a point */
    nearest(x: number, z: number, speciesFilter?: string): PlacedInstance | null
}
```

**Use cases:**
- Butterfly AI: `landscaper.query(butterfly.position, 30, { speciesId: 'wildflower' })` → fly toward nearest flower
- Gnome pathfinding: `landscaper.query(gnome.position, 10, { speciesId: 'oak' })` → hide behind trees
- Firefly spawning: `landscaper.getLayer('tall-grass')` → spawn fireflies at grass positions

#### Write API (trigger scatter from script)

```typescript
interface LandscaperScatterAPI {
    /** Dynamically scatter a layer (persists to NEXUS) */
    scatter(layer: DecorationLayer, region?: Region): ScatterResult

    /** Remove a placed instance */
    remove(instanceId: string): void

    /** Remove all instances in a layer */
    clearLayer(layerId: string): void

    /** Update appearance (e.g., seasonal change) */
    updateLayerPreset(layerId: string, presetOverrides: Record<string, unknown>): void
}
```

**Use cases:**
- Magic spell plants flowers: `landscaper.scatter({ species: 'wildflower', algorithm: 'clustered', count: 20, ... })`
- Tree gets chopped: `landscaper.remove(treeInstanceId)`
- Season changes: `landscaper.updateLayerPreset('forest', { leafTint: '#cc8833' })`

#### Event API (landscape events → scripts)

```typescript
// Events that scripts can listen to
interface LandscaperEvents {
    /** Fired when vegetation is placed (by Landscaper UI or script) */
    onVegetationPlaced(callback: (layer: string, instances: PlacedInstance[]) => void): void

    /** Fired when vegetation is removed */
    onVegetationRemoved(callback: (instanceIds: string[]) => void): void

    /** Fired when a layer's appearance changes */
    onLayerUpdated(callback: (layerId: string) => void): void
}
```

### 2.3 Script Attachment Model

Three tiers of script integration:

| Tier | What | Example | Who Renders |
|------|------|---------|-------------|
| **Layer script** | One script per scatter layer, receives all positions | Wind shader, seasonal color swap | Landscaper (InstancePool) |
| **Spawn script** | Script creates entities at Landscaper positions | NPCs, particles, butterflies | World (individual entities) |
| **Query script** | Script reads Landscaper data for AI decisions | Gnome hides behind trees, bird lands on branch | World (behavioral AI) |

Layer scripts are Landscaper's responsibility. Spawn and query scripts are World's responsibility, using the read/write API above.

---

## 3. Scatter as Utility — Beyond Vegetation

This is architecturally important: **ScatterSystem is content-agnostic.** The algorithms produce `[x, z]` coordinate pairs. They don't know what's being placed. The same scatter engine works for:

| Use Case | Algorithm | Layer Config |
|----------|-----------|-------------|
| Dense forest | Poisson disk (min spacing) | speciesId: 'oak', count: 200 |
| Wildflower meadow | Density (falloff from center) | speciesId: 'wildflower', count: 500 |
| Rock field | Clustered (natural grouping) | speciesId: 'boulder', count: 50 |
| NPC patrol starts | Poisson disk (spread out) | speciesId: 'gnome_patrol', count: 8 |
| Butterfly roost points | Clustered (near flowers) | speciesId: 'butterfly_roost', count: 30 |
| Campfire placement | Grid (regular spacing) | speciesId: 'campfire', count: 4 |
| Ambient sound emitters | Poisson disk | speciesId: 'ambient_birds', count: 15 |
| Particle spawn zones | Density (falloff) | speciesId: 'firefly_zone', count: 20 |

The difference is what happens **after** scatter:

- **Vegetation** → `ScenePopulator` → `InstancedMesh` (static, batched)
- **NPCs** → World script system → individual entities with AI (behavioral)
- **Particles** → World particle system → emitters at scattered positions (ephemeral)
- **Sound** → World audio system → positional audio sources (invisible)

Landscaper owns the scatter math. Each consuming system owns the rendering/behavior.

### 3.1 Proposed Shared API

```typescript
import { ScatterSystem } from '@blackbox/landscaper'

// Any team can use scatter for any purpose
const scatter = new ScatterSystem()

const butterflySpawns = scatter.scatter({
    id: 'butterflies',
    name: 'Butterfly Roost Points',
    instanceTypes: [{ speciesId: 'monarch', weight: 0.7 }, { speciesId: 'swallowtail', weight: 0.3 }],
    algorithm: 'clustered',
    count: 30,
    minDistance: 3,
    constraints: [{ type: 'height', minHeight: 0, maxHeight: 50 }],
    priority: 1,
}, { terrain, region, seed: 42 })

// butterflySpawns.instances → positions for World's particle/NPC system
// Landscaper doesn't know or care that these are butterflies
```

### 3.2 Cross-Layer Awareness

This is where it gets powerful. `scatterLayers()` processes layers in priority order with cross-layer exclusion:

```typescript
const layers = [
    // Trees go first (priority 20) — they claim space
    { id: 'forest', priority: 20, algorithm: 'poisson', count: 100, minDistance: 8, ... },

    // Flowers avoid trees (priority 10) — fill gaps between trunks
    { id: 'flowers', priority: 10, algorithm: 'density', count: 200, minDistance: 1,
      excludesLayers: ['forest'], ... },

    // Butterflies cluster near flowers (priority 5)
    { id: 'butterflies', priority: 5, algorithm: 'clustered', count: 30, minDistance: 2,
      excludesLayers: ['forest'], ... },

    // Gnomes spread out, avoid everything (priority 1)
    { id: 'gnome-spawns', priority: 1, algorithm: 'poisson', count: 5, minDistance: 15,
      excludesLayers: ['forest', 'flowers'], ... },
]

const results = scatter.scatterLayers(layers, { terrain, region, seed: 42 })

// Trees:       ScenePopulator → InstancedMesh
// Flowers:     ScenePopulator → InstancedMesh
// Butterflies: World particle system → boid entities
// Gnomes:      World script system → NPC entities with patrol AI
```

One scatter call, four consuming systems, all spatially aware of each other.

---

## 4. Terraformer Relationship

**Landscaper and Terraformer are separate tools with a one-way dependency.**

```
Terraformer (terrain authoring)
    │
    │ exports .r32 heightmap
    ▼
Landscaper (vegetation authoring)
    │
    │ uses heightmap for slope/height constraints
    │ exports manifest to NEXUS
    ▼
World (runtime rendering)
```

Terraformer doesn't know about Landscaper. Landscaper consumes terrain as input. They don't share UI, undo history, or data models.

**Future convenience:** A "Landscape" button in Terraformer's toolbar could open Landscaper pre-loaded with the current terrain. This is a shortcut, not a merge.

---

## 5. NEXUS Data Model

### 5.1 Manifest Storage

Proposed table extension for `bbworlds_nexus`:

```sql
-- Vegetation manifests per instance (parcel/region)
CREATE TABLE vegetation_manifests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id     UUID NOT NULL REFERENCES instances(id),
    layer_id        VARCHAR(64) NOT NULL,
    manifest_json   JSONB NOT NULL,          -- Full DistributionManifest
    algorithm       VARCHAR(20) NOT NULL,
    instance_count  INTEGER NOT NULL,
    seed            INTEGER,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      UUID REFERENCES users(id),

    UNIQUE(instance_id, layer_id)
);

-- Spatial index for cross-region queries
CREATE INDEX idx_veg_instance ON vegetation_manifests(instance_id);
```

### 5.2 Permission Model

Uses existing NEXUS permissions:
- `can_build` → can create/modify vegetation manifests
- `can_admin` → can modify other users' manifests
- Parcel bounds enforce region limits

### 5.3 Manifest Size Budget

| Trees | Manifest JSON | Compressed |
|-------|--------------|------------|
| 50 | ~4 KB | ~1.5 KB |
| 200 | ~15 KB | ~5 KB |
| 1000 | ~75 KB | ~25 KB |

Compact enough for real-time sync. No geometry transferred — only positions.

---

## 6. Implementation Status

### What's Built (Phase 2 Complete)

| Component | Status | Tests |
|-----------|--------|-------|
| ScatterSystem | Complete | 9 tests |
| 4 algorithms (poisson, clustered, density, grid) | Complete | 14 tests |
| Constraint system (slope, height, exclusion, density_falloff) | Complete | 11 tests |
| TerrainSampler (flat, procedural, heightmap) | Complete | 9 tests |
| RegionHelper (bounds, circle, polygon) | Complete | 14 tests |
| ScenePopulator (scatter → InstancePool bridge) | Complete | — |
| Cross-layer exclusion (spatial hash) | Complete | 2 tests |
| Seeded PRNG (mulberry32) | Complete | 2 tests |
| Dev harness (visual testing) | Complete | — |
| **Total** | **68 tests passing** | **Clean TS, builds** |

### What's Next

| Phase | Focus | Teams Involved |
|-------|-------|---------------|
| 3 | Custom generators (palm, shrub, rock, grass) | Landscaper |
| 4 | Wind animation (vertex shader) | Landscaper |
| 5 | Tier 1 API (World inline scatter) | Landscaper + World |
| 6 | NEXUS manifest persistence | Landscaper + World + NEXUS |
| 7 | Script query/write API | Landscaper + Scripter + World |
| 8 | Terraformer launch integration | Landscaper + Terraformer |
| 9 | Full Landscaper UI (Tier 2 dedicated app) | Landscaper |

---

## 7. Action Items

### For World Team

- [ ] **TerrainSampler adapter:** Implement `TerrainSampler` interface wrapping World's ground mesh raycasting
- [ ] **Build panel button:** Add "Quick Plant" (Tier 1) and "Landscape" (Tier 2) to build panel
- [ ] **Manifest loader:** On region load, fetch vegetation manifests from NEXUS, pass to ScenePopulator
- [ ] **Terrain export:** When launching Landscaper (Tier 2), export heightmap as `.r32` URL or `Float32Array`

### For Scripter Team

- [ ] **LandscaperQueryAPI:** Expose `query()`, `nearest()`, `getLayer()` to WorldScript instances
- [ ] **LandscaperScatterAPI:** Expose `scatter()`, `remove()`, `clearLayer()` for runtime script control
- [ ] **Event wiring:** Forward `onVegetationPlaced`/`onVegetationRemoved` events to scripts
- [ ] **NPC spawn pipeline:** Read NPC-typed layers from manifest → instantiate behavioral entities

### For NEXUS Team

- [ ] **vegetation_manifests table:** Create table per schema in section 5.1
- [ ] **REST endpoints:** `GET/POST/DELETE/PATCH /nexus/instances/:id/vegetation`
- [ ] **Permission check:** Gate writes on `can_build` permission

### For Terraformer Team

- [ ] **No action needed yet.** Future: add "Landscape" toolbar button that opens Landscaper with current terrain.

### For Landscaper Team (Us)

- [ ] Phase 3: Custom generators (palm, shrub, rock)
- [ ] Phase 5: Tier 1 API surface formalization
- [ ] Phase 7: Script query/write API implementation
- [ ] Integration test: round-trip manifest through NEXUS mock

---

## Repository

- **GitHub:** https://github.com/increasinglyHuman/BlackBoxLandscaper (pending)
- **Local:** `/home/p0qp0q/blackbox/BlackBoxLandscaper/`
- **npm:** `@blackbox/landscaper` (pending publish)
- **Dev harness:** `npm run dev` → localhost:5174

---

*This document lives in `docs/` in the BlackBoxLandscaper repo. Teams should respond by opening issues or updating their own integration docs.*
