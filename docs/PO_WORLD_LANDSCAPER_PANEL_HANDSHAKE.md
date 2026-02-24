# PO: LandscaperPanel — postMessage Handshake with Landscaper Iframe

**Priority:** High
**Assignee:** World Team
**Date:** 2026-02-24
**Requested by:** Allen Partridge
**Repo:** `poqpoq-world` — `src/ui/shelves/panels/LandscaperPanel.ts`

---

## Problem

`LandscaperPanel.ts` opens the Landscaper app in a modal iframe (`https://poqpoq.com/landscaper/`) but passes **zero context data**. The Landscaper iframe has a full postMessage bridge ready and waiting, but nobody is talking to it. Users see a "No World Context" error in the Landscaper drawer.

## What Landscaper Already Implements (Receiver Side)

Landscaper's postMessage bridge (live on production) listens for two messages from the parent:

### 1. `init-context` — Identity + Instance Data
```javascript
{
    source: 'blackbox-world',
    type: 'init-context',
    payload: {
        instanceId: string,        // UUID of the world instance
        instanceName: string,      // Display name ("Atlantis")
        userId: string,            // User UUID
        userDisplayName: string,   // User display name ("Allen")
        regionBounds: {            // World bounds in meters
            minX: number,          // typically -128
            maxX: number,          // typically 128
            minZ: number,
            maxZ: number
        },
        terrainAssetId?: string    // optional terrain asset reference
    }
}
```

### 2. `terrain-data` — Heightmap for Terrain Visualization
```javascript
{
    source: 'blackbox-world',
    type: 'terrain-data',
    payload: {
        terrainAssetId?: string,   // reference ID
        terrain: {
            format: 'heightmap_v1',
            data: string,          // base64-encoded Float32Array
            resolution: [cols, rows],  // e.g. [129, 129]
            bounds: {
                minX: number, maxX: number,
                minZ: number, maxZ: number
            },
            heightRange: { min: number, max: number },
            biome?: string,
            subdivisions?: number
        }
    }
}
```

### Messages Landscaper Sends Back

Landscaper sends these to `window.parent.postMessage()`:

| Type | When | Payload |
|------|------|---------|
| `ready` | On iframe load | `{ source: 'blackbox-landscaper', version: '0.2.0' }` |
| `save-manifest` | User clicks "Send to poqpoq" | Full vegetation manifest with mode, species, positions, identity |
| `request-terraformer` | User clicks "Open Terraformer" | `{ instanceId }` |
| `tool_close` | User clicks "Return to World" | `{ source: 'blackbox-landscaper' }` |

---

## Required Changes in LandscaperPanel.ts

### A. Listen for `ready` from Landscaper, then send context

In `openModal()`, after creating the iframe:

```typescript
// Store iframe ref on instance
this.iframe = iframe;

// Listen for Landscaper ready signal + return messages
this.messageHandler = (e: MessageEvent) => {
    // Accept both JSON string and object formats
    let msg: any;
    try {
        msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch { return; }

    if (msg?.source !== 'blackbox-landscaper') return;

    switch (msg.type) {
        case 'ready':
            this.sendContext();
            this.sendTerrain();
            break;
        case 'save-manifest':
            this.handleManifest(msg.payload);
            break;
        case 'tool_close':
            this.closeModal();
            break;
        case 'request-terraformer':
            // TODO: open Terraformer panel/modal
            break;
    }
};
window.addEventListener('message', this.messageHandler);
```

### B. Send init-context

```typescript
private async sendContext(): Promise<void> {
    if (!this.iframe?.contentWindow) return;

    // Use existing World globals + auth
    const instanceId = (window as any).currentInstanceId;
    const userId = (window as any).currentUserId;

    // Fetch instance metadata from NEXUS
    const meta = await fetch(`${API_CONFIG.NEXUS}/instances/${instanceId}`)
        .then(r => r.json()).catch(() => null);

    const user = authManager.getCurrentUser();

    this.iframe.contentWindow.postMessage(JSON.stringify({
        source: 'blackbox-world',
        type: 'init-context',
        payload: {
            instanceId,
            instanceName: meta?.name || instanceId,
            userId: userId || user?.id || '',
            userDisplayName: user?.name || 'Player',
            regionBounds: {
                minX: -128, maxX: 128,
                minZ: -128, maxZ: 128,
            },
            terrainAssetId: meta?.metadata?.terrain?.file_path || undefined,
        }
    }), '*');
}
```

### C. Send terrain-data

```typescript
private async sendTerrain(): Promise<void> {
    if (!this.iframe?.contentWindow) return;

    const instanceId = (window as any).currentInstanceId;

    // Fetch heightmap from NEXUS terrain endpoint
    const response = await fetch(
        `${API_CONFIG.NEXUS}/instances/${instanceId}/terrain/heightmap`
    ).catch(() => null);

    if (!response?.ok) {
        debugLog('[LandscaperPanel] No terrain heightmap available');
        return;
    }

    const terrainData = await response.json();

    this.iframe.contentWindow.postMessage(JSON.stringify({
        source: 'blackbox-world',
        type: 'terrain-data',
        payload: terrainData,  // Already in heightmap_v1 format from NEXUS
    }), '*');
}
```

### D. Handle manifest return

```typescript
private handleManifest(manifest: any): void {
    debugLog('[LandscaperPanel] Received vegetation manifest:', manifest);

    // POST to NEXUS placed_objects endpoint
    const instanceId = manifest.instanceId || (window as any).currentInstanceId;
    fetch(`${API_CONFIG.NEXUS}/instances/${instanceId}/objects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'vegetation_manifest',
            mode: manifest.mode || 'replace',  // 'replace' | 'additive' | 'subtractive'
            data: manifest,
        }),
    }).then(r => {
        if (r.ok) debugLog('[LandscaperPanel] Manifest saved to NEXUS');
        else console.warn('[LandscaperPanel] Failed to save manifest');
    });
}
```

### E. Cleanup in closeModal()

```typescript
if (this.messageHandler) {
    window.removeEventListener('message', this.messageHandler);
    this.messageHandler = null;
}
this.iframe = null;
```

---

## Nice-to-Have: Water Height & Environment Data

Landscaper can use water height to properly place underwater kelp species. Include in `init-context` payload:

```typescript
// Add to payload:
waterHeight: meta?.metadata?.custom_properties?.water_level || 0,
terrainOrigin: meta?.metadata?.terrain?.type || 'none',  // 'bbt' | 'heightmap' | 'procedural'
biome: meta?.metadata?.environment?.terrain_biome || 'grassland',
```

Landscaper's terrain info section will display:
- Terrain origin ("Created in Terraformer, active in poqpoq")
- Water level height
- Biome type

---

## Data Flow Diagram

```
World (parent)                          Landscaper (iframe)
     |                                       |
     |  ← ← ← ← ready ← ← ← ← ← ← ← ← |  (iframe loaded)
     |                                       |
     |  → → → init-context → → → → → → → → |  (identity + instance)
     |  → → → terrain-data → → → → → → → → |  (heightmap_v1)
     |                                       |
     |         ... user works ...            |
     |                                       |
     |  ← ← ← save-manifest ← ← ← ← ← ←  |  (user clicks Send)
     |  ← ← ← tool_close ← ← ← ← ← ← ←  |  (user clicks Return)
```

---

## Reference Files

| File | Location |
|------|----------|
| Landscaper postMessage bridge | `BlackBoxLandscaper/src/demo/main.ts` lines 890-921 |
| Landscaper terrain loader | `BlackBoxLandscaper/src/demo/main.ts` lines 804-888 |
| Landscaper WorldContext type | `BlackBoxLandscaper/src/demo/main.ts` lines 754-761 |
| MarketplacePanel (reference pattern) | `World/src/ui/shelves/panels/MarketplacePanel.ts` |
| TERRAIN_PIPELINE_SPEC | `BlackBoxLandscaper/docs/TERRAIN_PIPELINE_SPEC.md` |
| TOOL_TEAM_CSS_SPEC | `World/docs/design/TOOL_TEAM_CSS_SPEC.md` |
| NEXUS terrain API | `GET /nexus/instances/:instanceId/terrain/heightmap` |

---

## Acceptance Criteria

1. Opening Landscaper from World populates "Sim" and "User" in the right drawer (no more "awaiting context...")
2. If the instance has a terrain heightmap, Landscaper renders the actual terrain (not the default sine wave)
3. Clicking "Send to poqpoq" in Landscaper sends the vegetation manifest back to World
4. Clicking "Return to World" closes the Landscaper modal
5. Water height is passed so Landscaper can display it in terrain info
