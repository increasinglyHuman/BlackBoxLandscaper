/**
 * FernGenerator — procedural fern rosettes via curved pinnate fronds.
 *
 * Algorithm:
 *   1. No trunk — fronds radiate from a central point at ground level
 *   2. Each frond: curved rachis arching outward then drooping at tip
 *   3. Paired pinnae (leaflets) along rachis, tapering toward tip
 *   4. Fronds arranged in spiral with rosetteTilt controlling outward angle
 *   5. Vertex colors from species leafTint with per-vertex variation
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
    frondCount: number     // number of fronds in the rosette
    frondLength: number    // length of each frond in meters
    frondWidth: number     // width of each pinna in meters
    rosetteTilt: number    // outward tilt angle in degrees
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

        const pinnaePerSide = simplified ? 4 : 6
        const rachisSegments = simplified ? 4 : 6

        for (let f = 0; f < p.frondCount; f++) {
            const angle = f * GOLDEN_ANGLE + rng() * 0.3
            const tiltVar = tiltRad + (rng() - 0.5) * 0.2

            const frondMesh = this.buildFrond(
                p, rng, leafColor, pinnaePerSide, rachisSegments, tiltVar,
            )

            frondMesh.rotation.y = angle
            group.add(frondMesh)

            const rachisTris = rachisSegments * 2
            const pinnaeTris = pinnaePerSide * 2 * 2
            totalTris += rachisTris + pinnaeTris
        }

        // Small central hub (flattened sphere)
        const hubGeo = new THREE.SphereGeometry(p.frondLength * 0.06, 6, 4)
        hubGeo.scale(1, 0.4, 1)
        const hubColors = new Float32Array(hubGeo.getAttribute('position').count * 3)
        const hubBase = leafColor.clone().multiplyScalar(0.6)
        for (let i = 0; i < hubColors.length; i += 3) {
            hubColors[i] = hubBase.r
            hubColors[i + 1] = hubBase.g
            hubColors[i + 2] = hubBase.b
        }
        hubGeo.setAttribute('color', new THREE.Float32BufferAttribute(hubColors, 3))

        const hubMat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.8,
            metalness: 0.0,
        })
        const hub = new THREE.Mesh(hubGeo, hubMat)
        hub.position.y = p.frondLength * 0.03
        group.add(hub)
        totalTris += Math.floor(hubGeo.index
            ? hubGeo.index.count / 3
            : hubGeo.getAttribute('position').count / 3)

        const boundingRadius = p.frondLength * 1.1

        return { object: group, triangleCount: totalTris, boundingRadius }
    }

    // ========================================================================
    // SINGLE FROND — curved rachis with paired tapering pinnae
    // ========================================================================

    private buildFrond(
        p: FernPreset, rng: () => number, leafColor: THREE.Color,
        pinnaePerSide: number, rachisSegments: number, tilt: number,
    ): THREE.Mesh {
        const positions: number[] = []
        const colors: number[] = []
        const indices: number[] = []

        const rachisWidth = 0.02
        const pinnaLength = p.frondWidth * 0.8

        // Build rachis path — arch outward then droop at tip (characteristic fern shape)
        const rachisPoints: THREE.Vector3[] = []
        for (let i = 0; i <= rachisSegments; i++) {
            const t = i / rachisSegments
            // Outward distance along tilted direction
            const outward = t * p.frondLength
            // Fern arch: rises then droops (parabolic arch)
            // Peak at ~40% along the frond, then droops
            const archHeight = Math.sin(t * Math.PI * 0.6) * p.frondLength * 0.15
            // Droop toward tip
            const tipDroop = t > 0.5 ? (t - 0.5) * (t - 0.5) * p.frondLength * 0.4 : 0

            const x = Math.cos(tilt) * outward
            const y = Math.sin(tilt) * outward + archHeight - tipDroop
            rachisPoints.push(new THREE.Vector3(x, Math.max(0, y), 0))
        }

        // Build rachis as a narrow ribbon
        let vertIndex = 0

        for (let i = 0; i <= rachisSegments; i++) {
            const pt = rachisPoints[i]
            const t = i / rachisSegments
            const width = rachisWidth * (1 - t * 0.7) // taper toward tip

            const rc = leafColor.clone().multiplyScalar(0.45 + rng() * 0.1)

            positions.push(pt.x, pt.y, pt.z - width)
            colors.push(rc.r, rc.g, rc.b)
            positions.push(pt.x, pt.y, pt.z + width)
            colors.push(rc.r, rc.g, rc.b)
            vertIndex += 2
        }

        // Rachis triangle strip
        for (let i = 0; i < rachisSegments; i++) {
            const a = i * 2
            const b = a + 1
            const c = a + 2
            const d = a + 3
            indices.push(a, c, b)
            indices.push(b, c, d)
        }

        // Build pinnae along the rachis
        for (let i = 1; i <= pinnaePerSide; i++) {
            const t = i / (pinnaePerSide + 1)
            const segF = t * rachisSegments
            const seg = Math.floor(segF)
            const frac = segF - seg
            const pt0 = rachisPoints[Math.min(seg, rachisSegments)]
            const pt1 = rachisPoints[Math.min(seg + 1, rachisSegments)]
            const attachX = pt0.x + (pt1.x - pt0.x) * frac
            const attachY = pt0.y + (pt1.y - pt0.y) * frac

            // Pinnae taper toward tip — smaller near base and near tip
            const sizeFactor = Math.sin(t * Math.PI) * (1 - t * 0.3)
            const pw = p.frondWidth * sizeFactor * (0.85 + rng() * 0.3)
            const pl = pinnaLength * sizeFactor * (0.8 + rng() * 0.4)

            // Slight downward angle for natural look
            const pinnaAngle = 0.15 + t * 0.2

            // Per-pinna color — some variation
            const pc = leafColor.clone()
            pc.multiplyScalar(0.8 + rng() * 0.4)
            // Tips slightly darker
            pc.multiplyScalar(1 - t * 0.15)

            for (const side of [-1, 1]) {
                const baseVert = positions.length / 3

                // 4 vertices forming a pinna quad
                // Inner edge (at rachis)
                positions.push(attachX, attachY, side * 0.02)
                colors.push(pc.r, pc.g, pc.b)

                // Outer base
                positions.push(attachX - pl * 0.1, attachY - pl * pinnaAngle * 0.3, side * pw)
                colors.push(pc.r * 0.95, pc.g * 0.97, pc.b * 0.95)

                // Tip inner (slightly forward along rachis)
                positions.push(attachX + pl * 0.7, attachY - pl * pinnaAngle, side * 0.02)
                colors.push(pc.r * 0.88, pc.g * 0.9, pc.b * 0.88)

                // Tip outer
                positions.push(
                    attachX + pl * 0.5,
                    attachY - pl * pinnaAngle * 0.7,
                    side * pw * 0.4,
                )
                colors.push(pc.r * 0.82, pc.g * 0.85, pc.b * 0.82)

                indices.push(baseVert, baseVert + 1, baseVert + 2)
                indices.push(baseVert + 1, baseVert + 3, baseVert + 2)
            }
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
