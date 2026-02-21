/**
 * RockGenerator — procedural rock meshes via scrape + noise displacement.
 *
 * Algorithm (based on Erkaman's gl-rock technique):
 *   1. Start with IcosahedronGeometry (indexed — shared vertices)
 *   2. Scrape: random planes create flat facets (on indexed mesh → no gaps)
 *   3. Shape modifiers: flatten Y (boulders), stretch XZ (slabs)
 *   4. Simplex noise displacement along smooth normals for surface detail
 *   5. Convert to non-indexed for per-face vertex colors
 *   6. Vertex colors: base color + crevice darkening + patchy noise-driven moss
 *   7. Shared bump + color map textures for surface variety
 *
 * Supports cluster mode for river stones (multiple small stones as a group).
 *
 * Preset parameters in species.preset:
 *   size, detail, scrapeCount, scrapeDepth, noiseScale, noiseAmount,
 *   flattenY, stretchXZ, baseColor, mossAmount, clusterCount, clusterSpread
 */

import * as THREE from 'three'
import { createNoise2D, createNoise3D } from 'simplex-noise'
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
    size: number         // base radius (meters)
    detail: number       // icosahedron subdivision (1-3)
    scrapeCount: number  // number of flat facets
    scrapeDepth: number  // how deep scrapes cut (0-1)
    noiseScale: number   // noise frequency
    noiseAmount: number  // displacement amplitude
    flattenY: number     // vertical squash (0.2 = very flat, 1.0 = round)
    stretchXZ: number    // horizontal stretch (1.0 = round, 1.5 = wide)
    baseColor: string    // hex color e.g. "0x777777"
    mossAmount: number   // 0-1, patchy green tint on upward faces
    clusterCount: number // 1 = single rock, >1 = cluster of small stones
    clusterSpread: number // cluster spread as fraction of size
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
    clusterCount: 1,
    clusterSpread: 0.6,
}

export class RockGenerator implements MeshGenerator {
    readonly type = 'rock'

    // Shared textures (lazy init, reused across all rocks)
    private bumpTexture: THREE.DataTexture | null = null
    private colorMapTexture: THREE.DataTexture | null = null

    generate(species: SpeciesDefinition, seed?: number): GeneratorOutput {
        const s = seed ?? 42
        const p = { ...DEFAULT_PRESET, ...species.preset } as RockPreset
        if (p.clusterCount > 1) {
            return this.buildCluster(species.id, s, p, false)
        }
        return this.buildSingleRock(p, s, false, species.id)
    }

    generateSimplified(species: SpeciesDefinition, seed?: number): GeneratorOutput {
        const s = seed ?? 42
        const p = { ...DEFAULT_PRESET, ...species.preset } as RockPreset
        if (p.clusterCount > 1) {
            return this.buildCluster(species.id, s, p, true)
        }
        return this.buildSingleRock(p, s, true, species.id)
    }

    // ========================================================================
    // CLUSTER MODE — group of small stones (e.g. river stones)
    // ========================================================================

    private buildCluster(
        speciesId: string, seed: number, p: RockPreset, simplified: boolean,
    ): GeneratorOutput {
        const group = new THREE.Group()
        const rng = mulberry32(seed)
        let totalTris = 0
        let maxRadius = 0
        const spread = p.size * p.clusterSpread

        for (let i = 0; i < p.clusterCount; i++) {
            const stoneSeed = Math.floor(rng() * 100000)
            const stonePreset: RockPreset = {
                ...p,
                size: p.size * (0.4 + rng() * 0.6),
                clusterCount: 1, // no recursive clustering
            }

            const output = this.buildSingleRock(stonePreset, stoneSeed, simplified, speciesId)

            // Place within cluster radius (sqrt for uniform area distribution)
            if (i > 0) {
                const angle = rng() * Math.PI * 2
                const dist = Math.sqrt(rng()) * spread
                output.object.position.x = Math.cos(angle) * dist
                output.object.position.z = Math.sin(angle) * dist
            }
            output.object.rotation.y = rng() * Math.PI * 2

            group.add(output.object)
            totalTris += output.triangleCount
            const reach = Math.hypot(
                output.object.position.x,
                output.object.position.z,
            ) + output.boundingRadius
            maxRadius = Math.max(maxRadius, reach)
        }

        group.name = `rock_cluster_${speciesId}`
        return { object: group, triangleCount: totalTris, boundingRadius: maxRadius }
    }

    // ========================================================================
    // SINGLE ROCK — scrape + noise on indexed mesh, then vertex colors
    // ========================================================================

    private buildSingleRock(
        p: RockPreset, seed: number, simplified: boolean, speciesId: string,
    ): GeneratorOutput {
        const rng = mulberry32(seed)
        const noise3D = createNoise3D(() => rng())

        const detail = simplified ? Math.max(1, p.detail - 1) : p.detail
        const geo = new THREE.IcosahedronGeometry(p.size, detail)
        const pos = geo.getAttribute('position')

        // ── Step 1: Scrape on INDEXED geometry (shared verts → no gaps) ──
        for (let s = 0; s < p.scrapeCount; s++) {
            const theta = rng() * Math.PI * 2
            const phi = Math.acos(2 * rng() - 1)
            const planeNx = Math.sin(phi) * Math.cos(theta)
            const planeNy = Math.sin(phi) * Math.sin(theta)
            const planeNz = Math.cos(phi)
            const planeDist = p.size * (1 - p.scrapeDepth * (0.5 + rng() * 0.5))

            for (let i = 0; i < pos.count; i++) {
                const vx = pos.getX(i)
                const vy = pos.getY(i)
                const vz = pos.getZ(i)
                const dot = vx * planeNx + vy * planeNy + vz * planeNz
                if (dot > planeDist) {
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
            pos.setXYZ(i,
                pos.getX(i) * p.stretchXZ,
                pos.getY(i) * p.flattenY,
                pos.getZ(i) * p.stretchXZ,
            )
        }

        // ── Step 3: Noise displacement (indexed mesh, smooth normals) ──
        geo.computeVertexNormals()
        const normal = geo.getAttribute('normal')

        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
            const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i)
            const n = noise3D(
                x * p.noiseScale, y * p.noiseScale, z * p.noiseScale,
            ) * p.noiseAmount * p.size
            pos.setXYZ(i, x + nx * n, y + ny * n, z + nz * n)
        }

        // ── Step 4: Convert to non-indexed for per-face vertex colors ──
        const nonIndexed = geo.toNonIndexed()
        geo.dispose()
        nonIndexed.computeVertexNormals() // flat normals for shading

        const niPos = nonIndexed.getAttribute('position')
        const niNormal = nonIndexed.getAttribute('normal')

        // ── Step 5: Vertex colors — base + crevice darkening + patchy moss ──
        const colorHex = typeof p.baseColor === 'string'
            ? parseInt(p.baseColor.replace('0x', ''), 16)
            : (p.baseColor as number)
        const base = new THREE.Color(colorHex)
        const mossColor = new THREE.Color(0x556B2F) // dark olive green

        const colors = new Float32Array(niPos.count * 3)
        for (let i = 0; i < niPos.count; i++) {
            const ny = niNormal.getY(i)
            const upDot = Math.max(0, ny)
            const creviceDarken = 0.7 + 0.3 * upDot

            const c = base.clone()
            c.multiplyScalar(creviceDarken)
            c.multiplyScalar(0.95 + rng() * 0.1) // per-vertex variation

            // Patchy moss — noise-driven patches on upward faces
            if (p.mossAmount > 0 && ny > 0.3) {
                const vx = niPos.getX(i), vy = niPos.getY(i), vz = niPos.getZ(i)
                const mossNoise = noise3D(vx * 2.5, vy * 2.5, vz * 2.5) * 0.5 + 0.5
                const upFactor = (ny - 0.3) / 0.7 // 0 at ny=0.3, 1 at ny=1.0
                // Sharp patches: only where noise exceeds threshold
                const patchFactor = mossNoise > 0.35
                    ? Math.min(1, (mossNoise - 0.35) / 0.4)
                    : 0
                const mossBlend = p.mossAmount * upFactor * patchFactor

                if (mossBlend > 0.01) {
                    const mc = mossColor.clone()
                    mc.offsetHSL(0, 0, (rng() - 0.5) * 0.1) // slight variation
                    c.lerp(mc, mossBlend)
                }
            }

            colors[i * 3] = c.r
            colors[i * 3 + 1] = c.g
            colors[i * 3 + 2] = c.b
        }
        nonIndexed.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

        // ── Step 6: Material with shared textures ──
        this.ensureTextures()

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.85,
            metalness: 0.05,
            flatShading: true,
            side: THREE.DoubleSide,
            bumpMap: this.bumpTexture,
            bumpScale: 0.15,
            map: this.colorMapTexture,
        })

        const mesh = new THREE.Mesh(nonIndexed, material)
        mesh.name = `rock_${speciesId}`
        mesh.castShadow = true
        mesh.receiveShadow = true

        // Shift down so bottom sits on ground
        const box = new THREE.Box3().setFromBufferAttribute(niPos as THREE.BufferAttribute)
        mesh.position.y = -box.min.y

        const triCount = niPos.count / 3
        const boundingRadius = Math.max(p.size * p.stretchXZ, p.size * p.flattenY)

        return { object: mesh, triangleCount: triCount, boundingRadius }
    }

    // ========================================================================
    // SHARED TEXTURE GENERATION — bump + color map
    // ========================================================================

    private ensureTextures(): void {
        if (this.bumpTexture) return
        this.bumpTexture = this.createBumpTexture()
        this.colorMapTexture = this.createColorMapTexture()
    }

    /** Multi-octave noise bump map for micro-surface detail */
    private createBumpTexture(size: number = 256): THREE.DataTexture {
        const rng = mulberry32(9999)
        const noise2D = createNoise2D(() => rng())
        const data = new Uint8Array(size * size * 4)

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const u = x / size, v = y / size
                let val = noise2D(u * 8, v * 8) * 0.5
                val += noise2D(u * 16, v * 16) * 0.25
                val += noise2D(u * 32, v * 32) * 0.125
                val = val * 0.5 + 0.5

                const byte = Math.floor(Math.min(1, Math.max(0, val)) * 255)
                const i = (y * size + x) * 4
                data[i] = byte
                data[i + 1] = byte
                data[i + 2] = byte
                data[i + 3] = 255
            }
        }

        const tex = new THREE.DataTexture(data, size, size)
        tex.wrapS = THREE.RepeatWrapping
        tex.wrapT = THREE.RepeatWrapping
        tex.repeat.set(3, 2)
        tex.colorSpace = THREE.LinearSRGBColorSpace
        tex.needsUpdate = true
        return tex
    }

    /** Subtle color variation map — warm/cool noise pattern */
    private createColorMapTexture(size: number = 256): THREE.DataTexture {
        const rng = mulberry32(7777)
        const noise2D = createNoise2D(() => rng())
        const data = new Uint8Array(size * size * 4)

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const u = x / size, v = y / size
                let val = noise2D(u * 6, v * 6) * 0.5
                val += noise2D(u * 12, v * 12) * 0.15
                val = val * 0.5 + 0.5

                // 220-255 range — subtle variation that multiplies with vertex colors
                const brightness = Math.floor(220 + Math.min(1, Math.max(0, val)) * 35)
                // Slight warm/cool colour shift
                const warmCool = noise2D(u * 3 + 50, v * 3 + 50) * 0.5 + 0.5
                const r = Math.min(255, brightness + Math.floor(warmCool * 6 - 3))
                const b = Math.min(255, brightness + Math.floor((1 - warmCool) * 6 - 3))

                const i = (y * size + x) * 4
                data[i] = r
                data[i + 1] = brightness
                data[i + 2] = b
                data[i + 3] = 255
            }
        }

        const tex = new THREE.DataTexture(data, size, size)
        tex.wrapS = THREE.RepeatWrapping
        tex.wrapT = THREE.RepeatWrapping
        tex.repeat.set(3, 2)
        tex.colorSpace = THREE.LinearSRGBColorSpace
        tex.needsUpdate = true
        return tex
    }

    dispose(): void {
        this.bumpTexture?.dispose()
        this.colorMapTexture?.dispose()
        this.bumpTexture = null
        this.colorMapTexture = null
    }
}
