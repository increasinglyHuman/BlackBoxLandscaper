/**
 * FernGenerator — procedural fern rosettes via continuous tapered leaf fronds.
 *
 * Algorithm:
 *   1. No trunk — fronds radiate from a small central hub at ground level
 *   2. Each frond: continuous tapered leaf plane (3 verts per cross-section)
 *      with characteristic fern arch — rises then droops at tip
 *   3. Width peaks mid-frond and tapers at both ends (fern silhouette)
 *   4. Subtle edge undulation hints at individual pinnae
 *   5. Fronds in golden-angle spiral with rosetteTilt controlling outward angle
 *   6. Vertex colors from species leafTint with per-vertex variation
 *
 * Preset parameters in species.preset:
 *   frondCount, frondLength, frondWidth, rosetteTilt
 */

import * as THREE from 'three'
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

interface FernPreset {
    frondCount: number
    frondLength: number
    frondWidth: number
    rosetteTilt: number // degrees
}

const DEFAULT_PRESET: FernPreset = {
    frondCount: 8,
    frondLength: 2,
    frondWidth: 0.4,
    rosetteTilt: 30,
}

const GOLDEN_ANGLE = 137.508 * (Math.PI / 180)

export class FernGenerator implements MeshGenerator {
    readonly type = 'fern'

    generate(species: SpeciesDefinition, seed?: number): GeneratorOutput {
        return this.build(species, seed ?? 42, false)
    }

    generateSimplified(species: SpeciesDefinition, seed?: number): GeneratorOutput {
        return this.build(species, seed ?? 42, true)
    }

    private build(
        species: SpeciesDefinition, seed: number, simplified: boolean,
    ): GeneratorOutput {
        const rng = mulberry32(seed)
        const p = { ...DEFAULT_PRESET, ...species.preset } as FernPreset

        // Parse leaf tint
        const tintHex = species.leafTint.summer
        let leafColor: THREE.Color
        if (tintHex != null) {
            const hexNum = typeof tintHex === 'string'
                ? parseInt(tintHex.replace('0x', ''), 16)
                : tintHex
            leafColor = new THREE.Color(hexNum)
        } else {
            leafColor = new THREE.Color(0x448833)
        }

        const group = new THREE.Group()
        group.name = `fern_${species.id}`

        let totalTris = 0
        const tiltRad = (p.rosetteTilt * Math.PI) / 180
        const segments = simplified ? 5 : 8

        for (let f = 0; f < p.frondCount; f++) {
            const angle = f * GOLDEN_ANGLE + (rng() - 0.5) * 0.4

            // Per-frond variation
            const lengthVar = 0.75 + rng() * 0.5
            const tiltVar = tiltRad + (rng() - 0.5) * 0.25
            const widthVar = 0.8 + rng() * 0.4

            const frondMesh = this.buildFrond(
                p.frondLength * lengthVar, p.frondWidth * widthVar,
                tiltVar, leafColor, rng, segments,
            )

            frondMesh.rotation.y = angle
            group.add(frondMesh)
            totalTris += segments * 4
        }

        // Small central hub
        const hubRadius = p.frondLength * 0.06
        const hubGeo = new THREE.SphereGeometry(hubRadius, 6, 4)
        hubGeo.scale(1, 0.4, 1)
        const hubPosAttr = hubGeo.getAttribute('position')
        const hubColors = new Float32Array(hubPosAttr.count * 3)
        const hubBase = leafColor.clone().multiplyScalar(0.55)
        for (let i = 0; i < hubPosAttr.count; i++) {
            hubColors[i * 3] = hubBase.r
            hubColors[i * 3 + 1] = hubBase.g
            hubColors[i * 3 + 2] = hubBase.b
        }
        hubGeo.setAttribute('color', new THREE.Float32BufferAttribute(hubColors, 3))

        const hubMat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.8,
            metalness: 0.0,
        })
        const hub = new THREE.Mesh(hubGeo, hubMat)
        hub.position.y = hubRadius * 0.5
        group.add(hub)
        totalTris += hubGeo.index
            ? hubGeo.index.count / 3
            : hubPosAttr.count / 3

        const boundingRadius = p.frondLength * 1.1

        return { object: group, triangleCount: totalTris, boundingRadius }
    }

    // ========================================================================
    // SINGLE FROND — continuous tapered leaf with fern arch
    // ========================================================================

    private buildFrond(
        length: number, maxWidth: number, tilt: number,
        leafColor: THREE.Color, rng: () => number, segments: number,
    ): THREE.Mesh {
        // 3 vertices per cross-section: left, center (rachis), right
        const vertCount = (segments + 1) * 3
        const positions = new Float32Array(vertCount * 3)
        const colors = new Float32Array(vertCount * 3)

        const maxHalfWidth = maxWidth * 0.5
        const rachisRaise = 0.015

        for (let i = 0; i <= segments; i++) {
            const t = i / segments

            // Outward distance along tilted direction
            const outward = t * length
            const x = Math.cos(tilt) * outward
            // Fern arch: rises then droops at tip
            const archHeight = Math.sin(t * Math.PI * 0.55) * length * 0.18
            const tipDroop = t > 0.5 ? (t - 0.5) * (t - 0.5) * length * 0.5 : 0
            const y = Math.sin(tilt) * outward + archHeight - tipDroop

            // Width envelope: peaks at ~40% along frond, tapers both ends
            // Classic fern silhouette — widest in the middle
            const wFactor = Math.sin(t * Math.PI) * Math.pow(1 - t * 0.25, 0.5)
            const halfW = maxHalfWidth * wFactor

            // Subtle pinnae undulation
            const undulation = Math.sin(t * Math.PI * 6) * maxHalfWidth * 0.05 * wFactor

            const base = i * 3

            // Left edge
            const leftIdx = base * 3
            positions[leftIdx] = x
            positions[leftIdx + 1] = Math.max(0.01, y)
            positions[leftIdx + 2] = -(halfW + undulation)

            const lc = leafColor.clone().multiplyScalar(0.78 + rng() * 0.3)
            // Darken tips slightly
            lc.multiplyScalar(1 - t * 0.12)
            colors[leftIdx] = lc.r
            colors[leftIdx + 1] = lc.g
            colors[leftIdx + 2] = lc.b

            // Center (rachis) — slightly raised, darker
            const centerIdx = (base + 1) * 3
            positions[centerIdx] = x
            positions[centerIdx + 1] = Math.max(0.01, y) + rachisRaise * (1 - t * 0.8)
            positions[centerIdx + 2] = 0

            const cc = leafColor.clone().multiplyScalar(0.4 + rng() * 0.1)
            colors[centerIdx] = cc.r
            colors[centerIdx + 1] = cc.g
            colors[centerIdx + 2] = cc.b

            // Right edge
            const rightIdx = (base + 2) * 3
            positions[rightIdx] = x
            positions[rightIdx + 1] = Math.max(0.01, y)
            positions[rightIdx + 2] = halfW + undulation

            const rc = leafColor.clone().multiplyScalar(0.78 + rng() * 0.3)
            rc.multiplyScalar(1 - t * 0.12)
            colors[rightIdx] = rc.r
            colors[rightIdx + 1] = rc.g
            colors[rightIdx + 2] = rc.b
        }

        // 4 triangles per segment (2 for left half, 2 for right)
        const indices: number[] = []
        for (let i = 0; i < segments; i++) {
            const row = i * 3
            const next = (i + 1) * 3

            // Left half
            indices.push(row, row + 1, next)
            indices.push(row + 1, next + 1, next)

            // Right half
            indices.push(row + 1, row + 2, next + 1)
            indices.push(row + 2, next + 2, next + 1)
        }

        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
        geo.setIndex(indices)
        geo.computeVertexNormals()

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.7,
            metalness: 0.0,
            side: THREE.DoubleSide,
        })

        const mesh = new THREE.Mesh(geo, material)
        mesh.castShadow = true
        mesh.receiveShadow = true

        return mesh
    }

    dispose(): void {
        // No shared resources to clean up
    }
}
