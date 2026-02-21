/**
 * RockGenerator — procedural rock meshes via scrape + noise displacement.
 *
 * Algorithm (based on Erkaman's gl-rock technique):
 *   1. Start with IcosahedronGeometry for uniform triangle distribution
 *   2. Scrape: random planes create flat facets (erosion/fracturing)
 *   3. Simplex noise displacement along normals for surface detail
 *   4. Shape modifiers: flatten Y (boulders), stretch XZ (slabs)
 *   5. Vertex colors: base color + crevice darkening + optional moss
 *
 * Preset parameters in species.preset:
 *   size, detail, scrapeCount, scrapeDepth, noiseScale, noiseAmount,
 *   flattenY, stretchXZ, baseColor, mossAmount
 */

import * as THREE from 'three'
import { createNoise3D } from 'simplex-noise'
import type { MeshGenerator } from './types.js'
import type { GeneratorOutput, SpeciesDefinition } from '../types/index.js'

/** Mulberry32 — fast deterministic 32-bit PRNG */
function mulberry32(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6D2B79F5) | 0
        let t = Math.imul(s ^ (s >>> 15), s | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

interface RockPreset {
    size: number        // base radius (meters)
    detail: number      // icosahedron subdivision (1-3)
    scrapeCount: number // number of flat facets
    scrapeDepth: number // how deep scrapes cut (0-1)
    noiseScale: number  // noise frequency
    noiseAmount: number // displacement amplitude
    flattenY: number    // vertical squash (0.2 = very flat, 1.0 = round)
    stretchXZ: number   // horizontal stretch (1.0 = round, 1.5 = wide)
    baseColor: string   // hex color e.g. "0x777777"
    mossAmount: number  // 0-1, green tint on upward faces
}

const DEFAULT_PRESET: RockPreset = {
    size: 1.5,
    detail: 2,
    scrapeCount: 3,
    scrapeDepth: 0.3,
    noiseScale: 1.0,
    noiseAmount: 0.08,
    flattenY: 0.7,
    stretchXZ: 1.0,
    baseColor: '0x777777',
    mossAmount: 0.0,
}

export class RockGenerator implements MeshGenerator {
    readonly type = 'rock'

    generate(species: SpeciesDefinition, seed?: number): GeneratorOutput {
        return this.buildRock(species, seed ?? 42, false)
    }

    generateSimplified(species: SpeciesDefinition, seed?: number): GeneratorOutput {
        return this.buildRock(species, seed ?? 42, true)
    }

    private buildRock(species: SpeciesDefinition, seed: number, simplified: boolean): GeneratorOutput {
        const p = { ...DEFAULT_PRESET, ...species.preset } as RockPreset
        const rng = mulberry32(seed)
        const noise3D = createNoise3D(() => rng())

        const detail = simplified ? Math.max(1, p.detail - 1) : p.detail
        const geo = new THREE.IcosahedronGeometry(p.size, detail)

        // Need non-indexed geometry for per-vertex operations
        const nonIndexed = geo.toNonIndexed()
        geo.dispose()

        const pos = nonIndexed.getAttribute('position')
        const normal = nonIndexed.getAttribute('normal')

        // ── Step 1: Scrape — random planes create flat facets ──
        for (let s = 0; s < p.scrapeCount; s++) {
            // Random plane: point on sphere surface + normal toward center
            const theta = rng() * Math.PI * 2
            const phi = Math.acos(2 * rng() - 1)
            const planeNx = Math.sin(phi) * Math.cos(theta)
            const planeNy = Math.sin(phi) * Math.sin(theta)
            const planeNz = Math.cos(phi)

            // Plane sits at (1 - scrapeDepth) * size from center
            const planeDist = p.size * (1 - p.scrapeDepth * (0.5 + rng() * 0.5))

            for (let i = 0; i < pos.count; i++) {
                const vx = pos.getX(i)
                const vy = pos.getY(i)
                const vz = pos.getZ(i)

                // Signed distance from vertex to scrape plane
                const dot = vx * planeNx + vy * planeNy + vz * planeNz
                if (dot > planeDist) {
                    // Push vertex onto the plane
                    const excess = dot - planeDist
                    pos.setXYZ(i,
                        vx - planeNx * excess,
                        vy - planeNy * excess,
                        vz - planeNz * excess,
                    )
                }
            }
        }

        // ── Step 2: Shape modifiers — flatten Y, stretch XZ ──
        for (let i = 0; i < pos.count; i++) {
            let x = pos.getX(i)
            let y = pos.getY(i)
            let z = pos.getZ(i)

            y *= p.flattenY
            x *= p.stretchXZ
            z *= p.stretchXZ

            pos.setXYZ(i, x, y, z)
        }

        // ── Step 3: Noise displacement along normals ──
        // Recompute normals after scrape + shape
        nonIndexed.computeVertexNormals()

        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i)
            const y = pos.getY(i)
            const z = pos.getZ(i)
            const nx = normal.getX(i)
            const ny = normal.getY(i)
            const nz = normal.getZ(i)

            const n = noise3D(
                x * p.noiseScale,
                y * p.noiseScale,
                z * p.noiseScale,
            ) * p.noiseAmount * p.size

            pos.setXYZ(i,
                x + nx * n,
                y + ny * n,
                z + nz * n,
            )
        }

        // ── Step 4: Recompute normals after displacement ──
        nonIndexed.computeVertexNormals()

        // ── Step 5: Vertex colors — base + crevice darkening + moss ──
        const colorHex = typeof p.baseColor === 'string'
            ? parseInt(p.baseColor.replace('0x', ''), 16)
            : (p.baseColor as number)
        const base = new THREE.Color(colorHex)
        const moss = new THREE.Color(0x556B2F) // dark olive green

        const colors = new Float32Array(pos.count * 3)
        for (let i = 0; i < pos.count; i++) {
            const ny = normal.getY(i)

            // Crevice factor: faces pointing down or sideways get darker
            const upDot = Math.max(0, ny) // 0 = sideways/down, 1 = straight up
            const creviceDarken = 0.7 + 0.3 * upDot // 0.7-1.0 range

            const c = base.clone()
            c.multiplyScalar(creviceDarken)

            // Add slight color variation per-vertex
            const variation = 0.95 + rng() * 0.1
            c.multiplyScalar(variation)

            // Moss tint on upward-facing surfaces
            if (p.mossAmount > 0 && ny > 0.5) {
                const mossBlend = p.mossAmount * (ny - 0.5) * 2 // 0 at ny=0.5, full at ny=1
                c.lerp(moss, mossBlend)
            }

            colors[i * 3] = c.r
            colors[i * 3 + 1] = c.g
            colors[i * 3 + 2] = c.b
        }
        nonIndexed.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

        // ── Build mesh ──
        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.85,
            metalness: 0.05,
            flatShading: true,
        })

        const mesh = new THREE.Mesh(nonIndexed, material)
        mesh.name = `rock_${species.id}`
        mesh.castShadow = true
        mesh.receiveShadow = true

        // Shift down so bottom sits on ground
        const box = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute)
        mesh.position.y = -box.min.y

        const triCount = pos.count / 3
        const boundingRadius = Math.max(
            p.size * p.stretchXZ,
            p.size * p.flattenY,
        )

        return {
            object: mesh,
            triangleCount: triCount,
            boundingRadius,
        }
    }

    dispose(): void {
        // No cached resources
    }
}
