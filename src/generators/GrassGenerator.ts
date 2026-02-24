/**
 * GrassGenerator — procedural grass clumps with tapered multi-blade geometry.
 *
 * Algorithm:
 *   1. Each clump = N blades (8-16) in a small spread radius
 *   2. Each blade = 3-4 segment chain, tapered width (base → 10% at tip)
 *   3. Slight S-curve via progressive chain rotation for natural sway
 *   4. Vertex colors from leafTint.summer with per-blade HSL variation
 *   5. Optional wildflower variant: small 4-vert diamond at blade tip
 *
 * Preset parameters in species.preset:
 *   bladeCount, bladeHeight, bladeWidth, heightVariance,
 *   curvature, spread, segments, flowerChance?, flowerColors?
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

interface GrassPreset {
    bladeCount: number
    bladeHeight: number
    bladeWidth: number
    heightVariance: number
    curvature: number
    spread: number
    segments: number
    flowerChance?: number
    flowerColors?: string[]
}

const DEFAULT_PRESET: GrassPreset = {
    bladeCount: 12,
    bladeHeight: 0.6,
    bladeWidth: 0.035,
    heightVariance: 0.4,
    curvature: 0.5,
    spread: 0.3,
    segments: 3,
}

export class GrassGenerator implements MeshGenerator {
    readonly type = 'grass'

    generate(species: SpeciesDefinition, seed?: number): GeneratorOutput {
        return this.build(species, seed ?? 42)
    }

    generateSimplified(species: SpeciesDefinition, seed?: number): GeneratorOutput {
        return this.build(species, seed ?? 42)
    }

    private build(species: SpeciesDefinition, seed: number): GeneratorOutput {
        const rng = mulberry32(seed)
        const p = { ...DEFAULT_PRESET, ...species.preset } as GrassPreset

        // Parse leaf tint
        const tintHex = species.leafTint.summer
        let baseColor: THREE.Color
        if (tintHex != null) {
            const hexNum = typeof tintHex === 'string'
                ? parseInt(tintHex.replace('0x', ''), 16)
                : tintHex
            baseColor = new THREE.Color(hexNum)
        } else {
            baseColor = new THREE.Color(0x448833)
        }

        const group = new THREE.Group()
        group.name = `grass_${species.id}`

        let totalTris = 0

        // Parse flower colors if wildflower
        let flowerColors: THREE.Color[] | null = null
        if (p.flowerChance && p.flowerChance > 0 && p.flowerColors && p.flowerColors.length > 0) {
            flowerColors = p.flowerColors.map(c => {
                const hex = typeof c === 'string' ? parseInt(c.replace('0x', ''), 16) : c
                return new THREE.Color(hex)
            })
        }

        // Collect all blade geometry into one merged mesh for performance
        const allPositions: number[] = []
        const allColors: number[] = []
        const allIndices: number[] = []
        let vertexOffset = 0

        for (let b = 0; b < p.bladeCount; b++) {
            // Scatter blade within clump radius
            const angle = rng() * Math.PI * 2
            const dist = rng() * p.spread
            const bx = Math.cos(angle) * dist
            const bz = Math.sin(angle) * dist

            // Per-blade height variation
            const height = p.bladeHeight * (1.0 - p.heightVariance + rng() * p.heightVariance * 2)

            // Per-blade color variation — shift hue and lightness slightly
            const bladeColor = baseColor.clone()
            bladeColor.offsetHSL(
                (rng() - 0.5) * 0.06,   // hue +-3%
                (rng() - 0.5) * 0.1,    // saturation +-5%
                (rng() - 0.5) * 0.08,   // lightness +-4%
            )

            // Blade direction — random outward lean
            const bladeAngle = rng() * Math.PI * 2
            const leanDir = bladeAngle

            // Build blade chain
            const segLength = height / p.segments
            let cx = bx, cy = 0, cz = bz
            let chainAngle = Math.PI / 2 // start vertical

            // S-curve: alternate direction of curvature slightly
            const curveBias = (rng() - 0.5) * 0.3

            for (let i = 0; i <= p.segments; i++) {
                const t = i / p.segments

                // Taper: full width at base → 10% at tip
                const widthScale = 1.0 - t * 0.9
                const w = p.bladeWidth * widthScale * 0.5

                // Blade cross-section perpendicular to lean direction
                const perpX = Math.cos(leanDir + Math.PI / 2) * w
                const perpZ = Math.sin(leanDir + Math.PI / 2) * w

                const idx = vertexOffset + i * 2

                // Left edge
                allPositions.push(cx - perpX, cy, cz - perpZ)
                // Right edge
                allPositions.push(cx + perpX, cy, cz + perpZ)

                // Color: darken base, brighten tip
                const segColor = bladeColor.clone().multiplyScalar(0.85 + t * 0.3)
                allColors.push(segColor.r, segColor.g, segColor.b)
                allColors.push(segColor.r, segColor.g, segColor.b)

                // Advance chain
                if (i < p.segments) {
                    // Progressive curvature toward tip
                    const arcAmount = p.curvature * (0.3 + t * 1.5) / p.segments
                    const sCurve = curveBias * (1 - t) * 0.5 / p.segments
                    chainAngle -= arcAmount + sCurve

                    cx += Math.cos(leanDir) * segLength * Math.cos(chainAngle) * 0.3
                    cy += segLength * Math.sin(chainAngle)
                    cz += Math.sin(leanDir) * segLength * Math.cos(chainAngle) * 0.3
                }
            }

            // Indices: 2 tris per segment
            for (let i = 0; i < p.segments; i++) {
                const row = vertexOffset + i * 2
                const next = vertexOffset + (i + 1) * 2
                allIndices.push(row, row + 1, next)
                allIndices.push(row + 1, next + 1, next)
            }

            totalTris += p.segments * 2
            vertexOffset += (p.segments + 1) * 2

            // Wildflower diamond at tip
            if (flowerColors && rng() < p.flowerChance!) {
                const fc = flowerColors[Math.floor(rng() * flowerColors.length)]
                const flowerSize = p.bladeWidth * 2.5

                // Diamond: 4 verts, 2 tris
                const tipX = cx, tipY = cy, tipZ = cz
                const fpx = Math.cos(leanDir + Math.PI / 2)
                const fpz = Math.sin(leanDir + Math.PI / 2)

                // Top
                allPositions.push(tipX, tipY + flowerSize * 0.5, tipZ)
                allColors.push(fc.r, fc.g, fc.b)
                // Right
                allPositions.push(tipX + fpx * flowerSize * 0.5, tipY, tipZ + fpz * flowerSize * 0.5)
                allColors.push(fc.r * 0.9, fc.g * 0.9, fc.b * 0.9)
                // Bottom
                allPositions.push(tipX, tipY - flowerSize * 0.3, tipZ)
                allColors.push(fc.r, fc.g, fc.b)
                // Left
                allPositions.push(tipX - fpx * flowerSize * 0.5, tipY, tipZ - fpz * flowerSize * 0.5)
                allColors.push(fc.r * 0.9, fc.g * 0.9, fc.b * 0.9)

                allIndices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2)
                allIndices.push(vertexOffset, vertexOffset + 2, vertexOffset + 3)
                totalTris += 2
                vertexOffset += 4
            }
        }

        // Build single merged mesh
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3))
        geo.setAttribute('color', new THREE.Float32BufferAttribute(allColors, 3))
        geo.setIndex(allIndices)
        geo.computeVertexNormals()

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.95,
            metalness: 0.0,
            side: THREE.DoubleSide,
            emissive: new THREE.Color(0x0a1a0a),
            emissiveIntensity: 0.3,
        })

        const mesh = new THREE.Mesh(geo, material)
        mesh.castShadow = true
        mesh.receiveShadow = true
        group.add(mesh)

        const boundingRadius = Math.max(p.spread, p.bladeHeight) * 1.2

        return { object: group, triangleCount: totalTris, boundingRadius }
    }

    dispose(): void {
        // No cached resources
    }
}
