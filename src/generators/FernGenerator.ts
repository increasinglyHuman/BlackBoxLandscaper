/**
 * FernGenerator — procedural fern rosettes with textured alpha-cutout fronds.
 *
 * Algorithm:
 *   1. No trunk — fronds radiate from a small central hub at ground level
 *   2. 3 concentric rings of doubled fronds:
 *      - Inner ring: most vertical (youngest emerging fronds), least arc
 *      - Middle ring: moderate tilt, moderate arc
 *      - Outer ring: most horizontal, longest fronds, most droop
 *   3. Each frond: 5-segment chain (10 tris) with progressive arc rotation,
 *      same technique as PalmGenerator — gravity-obeying curve
 *   4. UV pivot at bottom-LEFT of texture (rachis base).
 *      Alpha cutout from PNG transparency reveals pinnae silhouette.
 *   5. Vertex colors tint the texture for variation
 *
 * Preset parameters in species.preset:
 *   frondCount, frondLength, frondWidth, rosetteTilt
 */

import * as THREE from 'three'
import type { MeshGenerator } from './types.js'
import type { GeneratorOutput, SpeciesDefinition } from '../types/index.js'
import fernLeafUrl from '../assets/textures/fernLeaf.png'

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

const NUM_FROND_SEGMENTS = 5 // 5 segments = 10 tris per frond

// The texture's rachis runs diagonally (~20° from the geometry's outward axis).
// Compensate so visible stems converge cleanly at the central hub.
const RACHIS_ALIGN = -0.3 // radians — rotate each frond to align visible stem with radial direction

export class FernGenerator implements MeshGenerator {
    readonly type = 'fern'

    // Shared texture (lazy init, reused across all ferns)
    private fernTexture: THREE.Texture | null = null

    generate(species: SpeciesDefinition, seed?: number): GeneratorOutput {
        return this.build(species, seed ?? 42, false)
    }

    generateSimplified(species: SpeciesDefinition, seed?: number): GeneratorOutput {
        return this.build(species, seed ?? 42, true)
    }

    private ensureTexture(): THREE.Texture {
        if (!this.fernTexture) {
            const loader = new THREE.TextureLoader()
            this.fernTexture = loader.load(fernLeafUrl)
            this.fernTexture.colorSpace = THREE.SRGBColorSpace
        }
        return this.fernTexture
    }

    private build(
        species: SpeciesDefinition, seed: number, simplified: boolean,
    ): GeneratorOutput {
        const rng = mulberry32(seed)
        const p = { ...DEFAULT_PRESET, ...species.preset } as FernPreset

        // Parse leaf tint for vertex color modulation
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
        const texture = this.ensureTexture()

        // Double the frond count for lush, dense rosette
        const frondCount = p.frondCount * 2

        // 4 concentric rings — all odd counts for natural asymmetry
        // liftBase: initial angle in radians (higher = more vertical)
        // arcBase: how much the frond arcs downward (total arc ≈ arcBase × 1.1 rad)
        // lengthScale: fraction of frondLength
        // widthMult: plane width as fraction of length
        // yOffset: slight height stagger
        const odd = (n: number) => n % 2 === 0 ? n + 1 : n
        const innerCount = odd(Math.max(3, Math.round(frondCount * 0.25)))
        const midCount = odd(Math.max(5, Math.round(frondCount * 0.35)))
        const outerCount = odd(Math.max(5, frondCount - 3 - innerCount - midCount))

        const rings = [
            // Top ring: tightest, most vertical emerging shoots
            { count: 3,
              liftBase: 1.1, arcBase: 0.1, lengthScale: 0.4, widthMult: 0.6,
              yOffset: 0.09, colorShift: 0.10 },
            // Inner ring: vertical, short, bright
            { count: innerCount,
              liftBase: 0.75, arcBase: 0.25, lengthScale: 0.65, widthMult: 0.75,
              yOffset: 0.06, colorShift: 0.06 },
            // Middle ring: moderate tilt, moderate arc
            { count: midCount,
              liftBase: 0.4, arcBase: 0.5, lengthScale: 0.85, widthMult: 0.85,
              yOffset: 0.03, colorShift: 0.0 },
            // Outer ring: most horizontal, longest, most droop
            { count: outerCount,
              liftBase: 0.15, arcBase: 0.8, lengthScale: 1.0, widthMult: 0.95,
              yOffset: 0.0, colorShift: -0.04 },
        ]

        for (const ring of rings) {
            const ringAngleOffset = rng() * Math.PI * 2

            for (let f = 0; f < ring.count; f++) {
                const angle = ringAngleOffset + f * (Math.PI * 2 / ring.count) + (rng() - 0.5) * 0.5

                // Per-frond randomization — wider range for organic extremes
                const lengthVar = ring.lengthScale * (0.8 + rng() * 0.4)
                const arcVar = ring.arcBase * (0.6 + rng() * 0.8)
                const liftVar = ring.liftBase + (rng() - 0.5) * 0.25
                const widthVar = ring.widthMult * (0.85 + rng() * 0.3)

                // Color variation per ring
                const ringColor = leafColor.clone()
                if (ring.colorShift > 0) {
                    ringColor.offsetHSL(0.02, 0, ring.colorShift) // inner = brighter
                } else if (ring.colorShift < 0) {
                    ringColor.multiplyScalar(0.85) // outer = slightly darker
                }

                const frondMesh = this.buildFrond(
                    p.frondLength * lengthVar, arcVar, liftVar, widthVar,
                    ringColor, rng, texture,
                )

                frondMesh.position.y = ring.yOffset
                frondMesh.rotation.y = angle + RACHIS_ALIGN
                group.add(frondMesh)
                totalTris += NUM_FROND_SEGMENTS * 2
            }
        }

        // Small central hub
        const hubRadius = p.frondLength * 0.06
        const hubGeo = new THREE.SphereGeometry(hubRadius, 6, 4)
        hubGeo.scale(1, 0.4, 1)
        const hubPosAttr = hubGeo.getAttribute('position')
        const hubColors = new Float32Array(hubPosAttr.count * 3)
        const hubBase = leafColor.clone().multiplyScalar(0.45)
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
    // SINGLE FROND — 5-segment chain with progressive arc rotation
    // ========================================================================
    //
    // Same chain technique as PalmGenerator. Each frond is 5 linked segments
    // (10 tris). Each segment rotated progressively downward for gravity arc.
    //
    // UV pivot at bottom-LEFT of texture (rachis base).
    //   Left edge (Z=0)       → U=0 (rachis/pivot side)
    //   Right edge (Z=+width) → U=1 (pinnae side)
    //   Base (chain start)    → V=0
    //   Tip (chain end)       → V=1
    // ========================================================================

    private buildFrond(
        length: number, arcIntensity: number, liftAngle: number,
        widthFactor: number, leafColor: THREE.Color, rng: () => number,
        texture: THREE.Texture,
    ): THREE.Mesh {
        const segLength = length / NUM_FROND_SEGMENTS
        const vertCount = (NUM_FROND_SEGMENTS + 1) * 2
        const positions = new Float32Array(vertCount * 3)
        const colors = new Float32Array(vertCount * 3)
        const uvs = new Float32Array(vertCount * 2)

        // Plane width — roughly matches length for square texture
        const planeWidth = length * widthFactor

        // Chain traversal state
        let chainX = 0
        let chainY = 0
        let angle = liftAngle

        for (let i = 0; i <= NUM_FROND_SEGMENTS; i++) {
            const t = i / NUM_FROND_SEGMENTS

            // Width ramp at base (narrow stem → full width)
            const wFactor = t < 0.12 ? t / 0.12 : 1.0
            const w = planeWidth * wFactor

            const base = i * 2
            const v = t

            // Left edge — rachis/pivot side, at Z=0
            positions[base * 3] = chainX
            positions[base * 3 + 1] = chainY
            positions[base * 3 + 2] = 0

            const lc = leafColor.clone().multiplyScalar(0.92 + rng() * 0.16)
            colors[base * 3] = lc.r
            colors[base * 3 + 1] = lc.g
            colors[base * 3 + 2] = lc.b

            uvs[base * 2] = 0       // U=0 (left/rachis/pivot side of texture)
            uvs[base * 2 + 1] = v   // V=t (bottom to top)

            // Right edge — pinnae side, extends in +Z
            positions[(base + 1) * 3] = chainX
            positions[(base + 1) * 3 + 1] = chainY
            positions[(base + 1) * 3 + 2] = w

            const rc = leafColor.clone().multiplyScalar(0.92 + rng() * 0.16)
            colors[(base + 1) * 3] = rc.r
            colors[(base + 1) * 3 + 1] = rc.g
            colors[(base + 1) * 3 + 2] = rc.b

            uvs[(base + 1) * 2] = 1     // U=1 (right/pinnae side of texture)
            uvs[(base + 1) * 2 + 1] = v

            // Advance chain to next segment position
            if (i < NUM_FROND_SEGMENTS) {
                // Progressive arc — increases toward tip
                const progressiveArc = arcIntensity * (0.5 + t * 1.5) / NUM_FROND_SEGMENTS
                // Random per-segment twist for organic look
                const randomTwist = (rng() - 0.5) * arcIntensity * 0.15 / NUM_FROND_SEGMENTS

                angle -= progressiveArc + randomTwist

                chainX += segLength * Math.cos(angle)
                chainY += segLength * Math.sin(angle)
            }
        }

        // 2 tris per segment = 10 tris total
        const indices: number[] = []
        for (let i = 0; i < NUM_FROND_SEGMENTS; i++) {
            const row = i * 2
            const next = (i + 1) * 2
            indices.push(row, row + 1, next)
            indices.push(row + 1, next + 1, next)
        }

        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
        geo.setIndex(indices)
        geo.computeVertexNormals()

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            bumpMap: texture,
            bumpScale: 0.5,
            vertexColors: true,
            roughness: 0.92,
            metalness: 0.0,
            side: THREE.DoubleSide,
            alphaTest: 0.4,
            transparent: false,
            // Subtle emissive prevents backface-lit fronds from going muddy brown
            emissive: new THREE.Color(0x0a1a0a),
            emissiveIntensity: 0.35,
        })

        const mesh = new THREE.Mesh(geo, material)
        mesh.castShadow = true
        mesh.receiveShadow = true

        return mesh
    }

    dispose(): void {
        this.fernTexture?.dispose()
        this.fernTexture = null
    }
}
