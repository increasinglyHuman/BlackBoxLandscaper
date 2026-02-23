# Terrain Pipeline Specification

**Date:** 2026-02-21
**Author:** Allen Partridge + Claude
**Status:** Proposed
**References:** ADR-008 (Terrain Asset Architecture), ADR-017 Section 5 (Manifest Pipeline), Migration 008

---

## Overview

Terrain data must flow between four tools: **Legacy** (OAR import), **Terraformer** (sculpt/paint), **World** (runtime), and **Landscaper** (vegetation). NEXUS is the single source of truth — every tool reads and writes terrain through NEXUS REST endpoints.

```
Legacy (OAR .r32) ──┐
                     │     ┌─────────────────────┐
Terraformer (sculpt) ├────→│  NEXUS Terrain API   │←───→ World (runtime)
                     │     │  (port 3020)         │
                     └────→│  bbworlds_nexus DB   │←───→ Landscaper (vegetation)
                           └─────────────────────┘
```

**Key principle:** Tools talk to NEXUS, not to each other. The only exception is the World→Landscaper postMessage bridge (iframe), where World forwards terrain data it already fetched from NEXUS.

---

## 1. Canonical Heightmap Format

All terrain interchange uses this JSON structure. It maps directly to the `terrain_data` JSONB column in `terrain_assets`.

```json
{
  "format": "heightmap_v1",
  "resolution": [257, 257],
  "bounds": {
    "minX": -128, "maxX": 128,
    "minZ": -128, "maxZ": 128
  },
  "heightRange": { "min": -5.2, "max": 42.8 },
  "subdivisions": 256,
  "biome": "grassland",
  "data": "<base64-encoded Float32Array>"
}
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `format` | string | Always `"heightmap_v1"` — enables future format evolution |
| `resolution` | [cols, rows] | Grid dimensions. 257×257 for a 256-subdivision mesh |
| `bounds` | object | World-space extents in meters |
| `heightRange` | object | Min/max Y values in the data (for normalization) |
| `subdivisions` | number | Mesh resolution (matches `terrain_assets.subdivisions`) |
| `biome` | string | Primary biome classification |
| `data` | string | Base64-encoded Float32Array, row-major (Z-major) order |

### Why Base64?

257×257 = 66,049 floats × 4 bytes = ~258KB raw. Base64 inflates ~33% to ~344KB. This is:
- Small enough for JSON/JSONB storage in PostgreSQL
- Small enough for postMessage (iframe bridge)
- Avoids floating-point precision loss from JSON number serialization
- Decodable in one line: `new Float32Array(Uint8Array.from(atob(data), c => c.charCodeAt(0)).buffer)`

For larger terrains (512×512 = 1MB+), the heightmap PNG file in `/var/www/world/terrains/{id}/heightmap.png` is the primary storage, with `terrain_data` containing metadata only.

---

## 2. NEXUS Terrain API Endpoints

These endpoints are added to `NexusServer.ts` (port 3020, systemd). They follow the existing manual validation pattern (no OpenAPI).

### 2.1 Create Terrain Asset

```
POST /terrains
```

**Body:**
```json
{
  "name": "My Custom Terrain",
  "description": "Volcanic island with coral reefs",
  "biome": "tropical",
  "size": 256,
  "elevation": 50,
  "subdivisions": 256,
  "source": "terraformer",
  "terrain_data": { "format": "heightmap_v1", "resolution": [257,257], ... },
  "created_by": "uuid-user-id"
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid-terrain-asset-id",
  "name": "My Custom Terrain",
  "created_at": "2026-02-21T..."
}
```

**DB:** Inserts into `terrain_assets`. Sets `current_owner = created_by`, default permissions.

### 2.2 Get Terrain Asset

```
GET /terrains/:terrainId
```

**Response:** `200 OK` — Full `terrain_assets` row including `terrain_data` JSONB.

**Query param:** `?metadata_only=true` — omits `terrain_data.data` (the heavy base64 payload). Useful for listings/thumbnails.

### 2.3 Update Terrain Asset (Save Edits)

```
PUT /terrains/:terrainId
```

**Body:** Same as POST, but only includes changed fields. Always includes `terrain_data` if heightmap changed.

**Auth:** Must be `current_owner` or god_mode.

**DB:** Updates `terrain_assets`, bumps `version`, sets `is_modified = true`, updates `modified_at`.

### 2.4 Link Terrain to Instance

```
PUT /instances/:instanceId/terrain
```

**Body:**
```json
{
  "terrain_asset_id": "uuid-terrain-asset-id",
  "position_x": 0, "position_y": 0, "position_z": 0,
  "rotation_y": 0
}
```

**Response:** `200 OK`

**DB:** Upserts into `instance_terrain`. One terrain per instance (MVP).

### 2.5 Get Instance Terrain

```
GET /instances/:instanceId/terrain
```

**Response:** `200 OK` — Returns `instance_terrain` row joined with `terrain_assets` (including full `terrain_data`).

**This is the primary endpoint Landscaper and World call** to get the terrain for a given instance.

### 2.6 Get Instance Terrain (Heightmap Only)

```
GET /instances/:instanceId/terrain/heightmap
```

**Response:** `200 OK` — Returns only the heightmap data (the base64 `terrain_data.data` field + resolution + bounds). Lightweight endpoint for tools that only need height sampling (like Landscaper).

### 2.7 Delete Terrain Asset

```
DELETE /terrains/:terrainId
```

**Auth:** Calls `can_delete_terrain_asset()` DB function (checks ownership, child dependencies).

**DB:** Soft delete (`is_deleted = true`).

---

## 3. Instance Context — "Which World Am I Editing?"

Every tool must know which instance it's operating on. This is how context flows:

### 3.1 World → Landscaper (iframe)

World opens Landscaper in an iframe and passes context via postMessage:

```javascript
// World sends on iframe load:
iframe.contentWindow.postMessage({
  source: 'blackbox-world',
  type: 'init-context',
  payload: {
    instanceId: 'uuid-instance-id',      // ← THE KEY
    instanceName: 'Atlantis',
    userId: 'uuid-user-id',
    regionBounds: { minX: -128, maxX: 128, minZ: -128, maxZ: 128 },
  }
}, '*')

// World sends terrain data (fetched from NEXUS):
iframe.contentWindow.postMessage({
  source: 'blackbox-world',
  type: 'terrain-data',
  payload: {
    terrainAssetId: 'uuid-terrain-asset-id',
    terrain: { /* canonical heightmap_v1 object */ }
  }
}, '*')
```

Landscaper stores `instanceId` and uses it when saving manifests back.

### 3.2 World → Terraformer (iframe)

Same pattern. World passes `instanceId` + current terrain data. Terraformer modifies terrain, saves back to NEXUS via `PUT /terrains/:terrainId`, then notifies World via postMessage.

### 3.3 Legacy → NEXUS (direct)

Legacy creates a new instance (or targets an existing one) during OAR import. It writes terrain directly to NEXUS:

1. `POST /terrains` — create terrain asset from OAR .r32 heightmap
2. `PUT /instances/:instanceId/terrain` — link terrain to the target instance

### 3.4 Standalone Mode (no iframe)

When Landscaper runs standalone (not embedded), users can:
- Select an instance from a dropdown (fetched via `GET /users/:userId/instances`)
- Or work in "sandbox" mode with the procedural sine-wave terrain (no NEXUS persistence)

---

## 4. Team Prompts (Purchase Orders)

Each prompt below is a self-contained task description for the team working on that tool.

---

### PO-TERRAIN-01: NEXUS Team — Terrain API Endpoints

**Priority:** High — blocks all other teams
**Repo:** `blackbox/World/nexus/server/src/NexusServer.ts`
**Service:** Port 3020 (systemd, NOT PM2)

**Task:** Add 6 REST endpoints for terrain CRUD and instance linking.

**Context:**
- DB tables already exist: `terrain_assets`, `terrain_components`, `instance_terrain` (Migration 008)
- No terrain endpoints exist yet — this is net-new code
- Follow existing validation pattern (inline manual checks, no OpenAPI)
- Follow existing error response pattern: `{ error: 'message' }`

**Endpoints to implement:**

1. `POST /terrains` — Create terrain asset
   - Required fields: `name`, `biome`, `size`, `elevation`, `subdivisions`, `terrain_data`, `created_by`
   - Auto-set: `current_owner = created_by`, default permissions, `source` defaults to `'terraformer'`
   - Returns: `{ id, name, created_at }`

2. `GET /terrains/:terrainId` — Get terrain asset
   - Returns full row from `terrain_assets`
   - Support `?metadata_only=true` to exclude `terrain_data.data` (the heavy base64 blob)

3. `PUT /terrains/:terrainId` — Update terrain asset
   - Auth: `current_owner` must match requesting user (or god_mode bypass)
   - Bump `version`, set `is_modified = true`, update `modified_at`

4. `PUT /instances/:instanceId/terrain` — Link terrain to instance
   - Body: `{ terrain_asset_id, position_x?, position_y?, position_z?, rotation_y? }`
   - Upsert into `instance_terrain` (one terrain per instance)
   - Broadcast via Socket.IO: `terrain_changed` event to room `instance_${instanceId}`

5. `GET /instances/:instanceId/terrain` — Get instance terrain
   - JOIN `instance_terrain` with `terrain_assets`
   - Return full terrain data including heightmap
   - Return 404 if no terrain linked

6. `GET /instances/:instanceId/terrain/heightmap` — Get heightmap only
   - Lightweight: returns only `terrain_data` JSONB (format, resolution, bounds, data)
   - For tools that just need height sampling

7. `DELETE /terrains/:terrainId` — Soft delete
   - Call `can_delete_terrain_asset()` function first
   - Set `is_deleted = true`, `deleted_at = NOW()`, `deleted_by = userId`

**Socket.IO broadcast on terrain change:**
```typescript
io.to(`instance_${instanceId}`).emit('terrain_changed', {
  instanceId,
  terrainAssetId,
  changedBy: userId,
  timestamp: new Date().toISOString()
})
```

**Testing:**
```bash
# Create terrain
curl -X POST http://localhost:3020/terrains \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","biome":"grassland","size":256,"elevation":50,"subdivisions":256,"terrain_data":{"format":"heightmap_v1","resolution":[257,257],"bounds":{"minX":-128,"maxX":128,"minZ":-128,"maxZ":128},"heightRange":{"min":0,"max":50},"data":"AAAA..."},"created_by":"test-user-uuid"}'

# Link to instance
curl -X PUT http://localhost:3020/instances/{instanceId}/terrain \
  -H 'Content-Type: application/json' \
  -d '{"terrain_asset_id":"uuid-from-create"}'

# Fetch for Landscaper
curl http://localhost:3020/instances/{instanceId}/terrain/heightmap
```

---

### PO-TERRAIN-02: Legacy Team — OAR Terrain Export to NEXUS

**Priority:** Medium
**Repo:** `blackbox/Legacy/`
**Service:** Port 3010 (PM2: `legacy-oar-api`)

**Task:** When importing an OAR, extract the terrain heightmap and write it to NEXUS.

**Context:**
- OAR files contain terrain data as raw `.r32` files (256×256 grid of 32-bit floats, little-endian)
- Legacy already parses OAR archives and extracts terrain
- The OAR terrain grid is exactly 256×256 (65,536 floats), one height value per meter
- Legacy knows the target instance (user selects or creates one during import)

**Steps:**

1. **Extract .r32 from OAR** — already done in your OAR parser
2. **Convert to canonical format:**
   ```python
   import struct, base64

   # Read raw .r32 (256×256 × 4 bytes = 262,144 bytes)
   with open(r32_path, 'rb') as f:
       raw = f.read()
   floats = struct.unpack('<65536f', raw)  # little-endian float32

   # For 256-subdivision mesh, we need 257×257 grid (fence-post)
   # Duplicate the last row and column
   grid_257 = []
   for row in range(257):
       for col in range(257):
           r = min(row, 255)
           c = min(col, 255)
           grid_257.append(floats[r * 256 + c])

   # Encode to base64
   data_bytes = struct.pack(f'<{len(grid_257)}f', *grid_257)
   data_b64 = base64.b64encode(data_bytes).decode('ascii')

   terrain_data = {
       "format": "heightmap_v1",
       "resolution": [257, 257],
       "bounds": {"minX": 0, "maxX": 256, "minZ": 0, "maxZ": 256},
       "heightRange": {"min": min(floats), "max": max(floats)},
       "subdivisions": 256,
       "biome": "imported",
       "data": data_b64
   }
   ```

3. **POST to NEXUS:**
   ```python
   import requests

   resp = requests.post('http://localhost:3020/terrains', json={
       "name": f"{oar_name} Terrain",
       "description": f"Imported from OAR: {oar_filename}",
       "biome": "imported",
       "size": 256,
       "elevation": int(max(floats)),
       "subdivisions": 256,
       "source": "legacy_oar",
       "terrain_data": terrain_data,
       "created_by": user_id  # the user who initiated the import
   })
   terrain_id = resp.json()['id']
   ```

4. **Link to instance:**
   ```python
   requests.put(f'http://localhost:3020/instances/{instance_id}/terrain', json={
       "terrain_asset_id": terrain_id
   })
   ```

**Important:**
- The target `instance_id` is known at import time (user selects which world to import into)
- OAR bounds are 0–256 (SL/OpenSim convention), not -128 to +128. Legacy should translate to centered bounds if World uses centered coordinates, or document the offset.
- If the OAR has no terrain file, skip terrain creation (not all OARs include terrain)

---

### PO-TERRAIN-03: Terraformer Team — Save/Load Terrain to NEXUS

**Priority:** Medium
**Repo:** `blackbox/BlackBoxTerrains/`
**Service:** Standalone web app (served from `/var/www/terraformer/`)

**Task:** Save sculpted terrain to NEXUS so World and Landscaper can use it. Load existing terrain from NEXUS for re-editing.

**Context:**
- Terraformer uses Babylon.js `GroundMesh` with vertex-based heightmap
- Terrain is identified by `instanceId` — each world has one terrain
- Terraformer is opened from World via iframe (receives `instanceId` via postMessage)
- Can also run standalone (user selects instance from dropdown)

**Receiving instance context (iframe mode):**
```typescript
window.addEventListener('message', (event) => {
    const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
    if (msg?.source !== 'blackbox-world') return

    if (msg.type === 'init-context') {
        // Store: msg.payload.instanceId, msg.payload.userId
        currentInstanceId = msg.payload.instanceId
        currentUserId = msg.payload.userId
    }
    if (msg.type === 'terrain-data') {
        // Load existing terrain for editing
        loadHeightmapFromCanonical(msg.payload.terrain)
    }
})
```

**Exporting terrain from Babylon.js GroundMesh:**
```typescript
function exportTerrainToCanonical(ground: GroundMesh): object {
    const positions = ground.getVerticesData(VertexBuffer.PositionKind)!
    const subdivisions = ground._subdivisionsX  // e.g., 256
    const gridSize = subdivisions + 1           // 257

    // Extract Y values from vertex positions (stride 3: x, y, z)
    const heights = new Float32Array(gridSize * gridSize)
    let minY = Infinity, maxY = -Infinity
    for (let i = 0; i < gridSize * gridSize; i++) {
        const y = positions[i * 3 + 1]
        heights[i] = y
        if (y < minY) minY = y
        if (y > maxY) maxY = y
    }

    // Base64 encode
    const bytes = new Uint8Array(heights.buffer)
    const b64 = btoa(String.fromCharCode(...bytes))

    return {
        format: 'heightmap_v1',
        resolution: [gridSize, gridSize],
        bounds: {
            minX: -ground._width / 2,
            maxX: ground._width / 2,
            minZ: -ground._height / 2,  // Babylon uses _height for Z extent
            maxZ: ground._height / 2
        },
        heightRange: { min: minY, max: maxY },
        subdivisions,
        biome: currentBiome || 'grassland',
        data: b64
    }
}
```

**Saving to NEXUS:**
```typescript
async function saveTerrainToNexus(): Promise<void> {
    const terrainData = exportTerrainToCanonical(groundMesh)

    // Check if instance already has a terrain asset
    const existing = await fetch(`/nexus/instances/${currentInstanceId}/terrain`)

    if (existing.ok) {
        // Update existing terrain asset
        const { terrain_asset_id } = await existing.json()
        await fetch(`/nexus/terrains/${terrain_asset_id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                terrain_data: terrainData,
                modified_by: currentUserId
            })
        })
    } else {
        // Create new terrain asset + link to instance
        const resp = await fetch('/nexus/terrains', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: `${instanceName} Terrain`,
                biome: terrainData.biome,
                size: Math.round(terrainData.bounds.maxX - terrainData.bounds.minX),
                elevation: Math.round(terrainData.heightRange.max),
                subdivisions: terrainData.subdivisions,
                terrain_data: terrainData,
                source: 'terraformer',
                created_by: currentUserId
            })
        })
        const { id: terrainId } = await resp.json()

        await fetch(`/nexus/instances/${currentInstanceId}/terrain`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ terrain_asset_id: terrainId })
        })
    }

    // Notify World (if in iframe)
    window.parent?.postMessage(JSON.stringify({
        source: 'blackbox-terraformer',
        type: 'terrain-saved',
        payload: { instanceId: currentInstanceId }
    }), '*')
}
```

**Loading from NEXUS (standalone mode):**
```typescript
async function loadTerrainFromNexus(instanceId: string): Promise<void> {
    const resp = await fetch(`/nexus/instances/${instanceId}/terrain/heightmap`)
    if (!resp.ok) return  // No terrain yet

    const { terrain_data } = await resp.json()
    loadHeightmapFromCanonical(terrain_data)
}

function loadHeightmapFromCanonical(terrain: any): void {
    const bytes = Uint8Array.from(atob(terrain.data), c => c.charCodeAt(0))
    const heights = new Float32Array(bytes.buffer)
    const [cols, rows] = terrain.resolution

    // Apply to Babylon.js GroundMesh
    const positions = groundMesh.getVerticesData(VertexBuffer.PositionKind)!
    for (let i = 0; i < cols * rows; i++) {
        positions[i * 3 + 1] = heights[i]
    }
    groundMesh.updateVerticesData(VertexBuffer.PositionKind, positions)
    groundMesh.refreshBoundingInfo()
}
```

**Which world am I saving to?**
- Iframe mode: `instanceId` comes from World's `init-context` postMessage
- Standalone mode: user picks from dropdown populated by `GET /users/:userId/instances`
- Terraformer should show instance name prominently in UI so user always knows which world they're editing

---

### PO-TERRAIN-04: World Team — Terrain Forwarding to Companion Apps

**Priority:** Medium
**Repo:** `blackbox/World/`
**Service:** Client-side (Babylon.js app at `/var/www/world/`)

**Task:** When opening Landscaper or Terraformer as iframes, forward the current instance's terrain data. Listen for terrain-saved events to reload.

**Opening Landscaper iframe:**
```typescript
async function openLandscaper(instanceId: string): void {
    const iframe = document.createElement('iframe')
    iframe.src = '/landscaper/'

    // Wait for Landscaper to signal ready
    window.addEventListener('message', async (event) => {
        const msg = parseMessage(event)
        if (msg?.source !== 'blackbox-landscaper') return

        if (msg.type === 'ready') {
            // Send instance context
            iframe.contentWindow!.postMessage(JSON.stringify({
                source: 'blackbox-world',
                type: 'init-context',
                payload: {
                    instanceId,
                    instanceName: currentInstance.name,
                    userId: currentUserId,
                    regionBounds: currentInstance.bounds
                }
            }), '*')

            // Fetch and forward terrain
            const terrainResp = await fetch(`/nexus/instances/${instanceId}/terrain`)
            if (terrainResp.ok) {
                const terrainData = await terrainResp.json()
                iframe.contentWindow!.postMessage(JSON.stringify({
                    source: 'blackbox-world',
                    type: 'terrain-data',
                    payload: {
                        terrainAssetId: terrainData.terrain_asset_id,
                        terrain: terrainData.terrain_data
                    }
                }), '*')
            }
        }

        if (msg.type === 'save-manifest') {
            // Landscaper saved vegetation — persist to NEXUS
            await persistVegetationManifest(instanceId, msg.payload.manifest)
        }
    })

    document.body.appendChild(iframe)
}
```

**Listening for Terraformer terrain updates:**
```typescript
// When Terraformer saves terrain, it posts 'terrain-saved'
// World should reload the terrain mesh
window.addEventListener('message', (event) => {
    const msg = parseMessage(event)
    if (msg?.source === 'blackbox-terraformer' && msg.type === 'terrain-saved') {
        reloadInstanceTerrain(msg.payload.instanceId)
    }
})

// Also listen for Socket.IO broadcast (if another user changed terrain)
socket.on('terrain_changed', (data) => {
    if (data.instanceId === currentInstanceId) {
        reloadInstanceTerrain(data.instanceId)
    }
})
```

**Same pattern for opening Terraformer** — send `init-context` + `terrain-data`, listen for `terrain-saved` to reload.

---

### PO-TERRAIN-05: Landscaper Team — Receive and Use Real Terrain

**Priority:** Medium
**Repo:** `blackbox/BlackBoxLandscaper/`
**Service:** Standalone web app (served from `/var/www/landscaper/`)

**Task:** Accept terrain data from World (via postMessage) or fetch from NEXUS (standalone). Replace the sine-wave ground with real heightmap terrain.

**What needs to change in Landscaper:**

1. **New file: `src/scatter/HeightmapTerrainSampler.ts`**
   - Implements the existing `TerrainSampler` interface
   - Stores the decoded Float32Array heightmap grid
   - `getHeightAt(x, z)`: bilinear interpolation from the grid
   - `getNormalAt(x, z)`: computed from neighboring height samples
   - `getSlopeAt(x, z)`: angle from normal (already used by scatter constraints)
   - Also builds a Three.js `PlaneGeometry` mesh with vertex Y values from heightmap

2. **Modify `src/demo/main.ts`** — wire up postMessage terrain receiver:
   ```typescript
   // In the postMessage handler (already exists, case 'terrain-data'):
   case 'terrain-data':
       console.log('[Landscaper] Received terrain data')
       const { terrainAssetId, terrain } = msg.payload
       currentTerrainAssetId = terrainAssetId
       loadRealTerrain(terrain)
       break
   ```

3. **`loadRealTerrain()` function:**
   ```typescript
   function loadRealTerrain(terrain: any): void {
       // Decode base64 heightmap
       const bytes = Uint8Array.from(atob(terrain.data), c => c.charCodeAt(0))
       const heights = new Float32Array(bytes.buffer)
       const [cols, rows] = terrain.resolution

       // Replace ground mesh
       scene.remove(ground)
       ground.geometry.dispose()

       const newGeo = new THREE.PlaneGeometry(
           terrain.bounds.maxX - terrain.bounds.minX,
           terrain.bounds.maxZ - terrain.bounds.minZ,
           cols - 1, rows - 1
       )
       newGeo.rotateX(-Math.PI / 2)

       const posAttr = newGeo.getAttribute('position')
       for (let i = 0; i < posAttr.count; i++) {
           posAttr.setY(i, heights[i])
       }
       newGeo.computeVertexNormals()

       ground = new THREE.Mesh(newGeo, groundMat)
       ground.receiveShadow = true
       scene.add(ground)

       // Update height sampler for scatter + brush
       heightmapSampler = new HeightmapTerrainSampler(heights, cols, rows, terrain.bounds)
       sampleGroundHeight = (x, z) => heightmapSampler.getHeightAt(x, z)

       // Update brush controller's ground reference
       brush.updateGround(ground)
   }
   ```

4. **Standalone NEXUS fetch** (when not in iframe):
   ```typescript
   // If running standalone with instance selector
   async function fetchTerrainFromNexus(instanceId: string): Promise<void> {
       const resp = await fetch(`/nexus/instances/${instanceId}/terrain/heightmap`)
       if (!resp.ok) return
       const data = await resp.json()
       loadRealTerrain(data.terrain_data)
   }
   ```

5. **Instance context storage:**
   - Store `instanceId` from `init-context` postMessage
   - Include it in saved manifests (already in `buildManifest()` as `worldContext?.instanceId`)
   - Display instance name in UI header so user knows which world they're landscaping

---

## 5. Execution Order

```
Step 1 ──→ NEXUS Team (PO-01): Add terrain endpoints
           Blocks: everyone else
           Estimated: 2-3 hours
           Test: curl commands in the PO

Step 2 ──→ In parallel:
           ├─ Legacy Team (PO-02): OAR .r32 → NEXUS adapter
           ├─ Terraformer Team (PO-03): Save/load terrain
           ├─ World Team (PO-04): Terrain forwarding
           └─ Landscaper Team (PO-05): HeightmapTerrainSampler

Step 3 ──→ Integration test: Full pipeline
           1. Import OAR via Legacy → terrain appears in NEXUS
           2. Open Terraformer from World → terrain loads for editing
           3. Save in Terraformer → World reloads terrain
           4. Open Landscaper from World → terrain loads, scatter works
           5. Save vegetation in Landscaper → World re-rezzes trees
```

---

## 6. Things You Flagged (Did I Miss Any?)

| Item | Status |
|------|--------|
| Validate existing terrain endpoints | Confirmed: NONE exist. Tables ready, zero API routes |
| Validate all NEXUS endpoints | 44 HTTP endpoints documented, none for terrain |
| OpenAPI validation for NEXUS | Not used — NEXUS uses inline manual validation |
| Team POs for push/pull terrain | PO-01 through PO-05 above |
| Terraformer: which world to save to | instanceId via postMessage (iframe) or dropdown (standalone) |
| World: how to forward terrain | postMessage bridge on iframe load |
| Legacy: terrain from OAR | .r32 → canonical heightmap → POST /terrains + PUT instance link |
| Landscaper: pull terrain + match to instance | instanceId from init-context → GET /instances/:id/terrain/heightmap |
| NEXUS runs via systemd (not PM2) | Noted in PO-01 |

**One addition you might want:**
- **Splat map / biome data** — Terraformer paints biomes (grass, sand, rock textures). The `terrain_components` table supports `component_type: 'splat_map'`. The canonical format could include an optional `splatData` field alongside the heightmap. This affects Landscaper too — biome-aware scatter (only place palms on "beach" splat regions). Worth defining now or deferring?

---

*This spec implements ADR-017 Section 5 (Manifest Pipeline) and ADR-008 (Terrain Asset Architecture) for the terrain data path.*

---

## 7. PO-TERRAIN-01 Completion Notes (2026-02-21)

**Status: COMPLETE** — Committed to `main` as `fce0d61`

### What was delivered

7 REST endpoints on NEXUS (port 3020) + 8 DatabaseManager query methods:

| Method | Path | Notes |
|--------|------|-------|
| POST | `/terrains` | Create terrain asset. Returns `{ id, name, created_at }` |
| GET | `/terrains/:id` | Full row, or `?metadata_only=true` (strips base64 data) |
| PUT | `/terrains/:id` | Partial update. Bumps version, requires owner or god_mode |
| DELETE | `/terrains/:id` | Soft delete. Runs `can_delete_terrain_asset()` guard first |
| PUT | `/instances/:id/terrain` | Link terrain to instance. **Workshop guard** rejects `metadata.terrain.type === 'workshop'`. Broadcasts `terrain_changed` via Socket.IO |
| GET | `/instances/:id/terrain` | JOIN instance_terrain + terrain_assets. Full payload |
| GET | `/instances/:id/terrain/heightmap` | Lightweight — returns only `terrain_data` JSONB. **Landscaper's primary endpoint** |

### Auth pattern

All write endpoints check `current_owner === userId` with god_mode fallback. Read endpoints are open.

### Workshop guard

`PUT /instances/:id/terrain` returns 403 if instance `metadata.terrain.type === 'workshop'`. Workshops (16x32m, 512 m²) are too small for terrain. The World UX also prevents sending terrain context to iframes when in a workshop — defense in depth.

### Soft-delete behavior

`DELETE /terrains/:id` sets `is_deleted = true` but does NOT remove `instance_terrain` rows. The GET endpoints filter via `AND ta.is_deleted = false` so orphaned links are invisible. This preserves the restore path — un-deleting a terrain auto-restores all instance links.

### Teams can now proceed in parallel

- **Legacy (PO-02)**: POST /terrains + PUT /instances/:id/terrain
- **Terraformer (PO-03)**: PUT /terrains/:id + GET /instances/:id/terrain
- **World (PO-04)**: GET /instances/:id/terrain (for iframe forwarding)
- **Landscaper (PO-05)**: GET /instances/:id/terrain/heightmap

### Files changed

- `nexus/server/src/NexusServer.ts` — 7 endpoints in setupRoutes()
- `nexus/server/src/core/DatabaseManager.ts` — 8 terrain query methods
- TypeScript strict mode: zero errors
