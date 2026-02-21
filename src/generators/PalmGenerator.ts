/**
 * PalmGenerator — procedural palm trees via curved trunk + pinnate fronds.
 *
 * Algorithm:
 *   1. Build trunk as a tapered tube following a quadratic bezier curve
 *   2. Add bark ring bumps at regular intervals (horizontal bands)
 *   3. Vertex colors: brown gradient with darker ring marks
 *   4. Generate pinnate fronds at the crown (golden-angle spiral)
 *   5. Each frond: curved rachis ribbon + paired pinnae (leaflets)
 *   6. Frond vertex colors from species leafTint
 *
 * Preset parameters in species.preset:
 *   trunkHeight, trunkCurve, trunkRadius, frondCount, frondLength, frondDroop
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

interface PalmPreset {
    trunkHeight: number    // total height in meters
    trunkCurve: number     // lateral displacement factor (0 = straight, 0.5 = leaning)
    trunkRadius: number    // base radius in meters
    frondCount: number     // number of fronds at crown
    frondLength: number    // frond length in meters
    frondDroop: number     // droop factor (0 = horizontal, 1 = hanging)
}

const DEFAULT_PRESET: PalmPreset = {
    trunkHeight: 15,
    trunkCurve: 0.3,
    trunkRadius: 0.4,
    frondCount: 12,
    frondLength: 6,
    frondDroop: 0.4,
}

const GOLDEN_ANGLE = 137.508 * (Math.PI / 180) // ~2.3999 radians

export class PalmGenerator implements MeshGenerator {
    readonly type = 'palm'

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
        const p = { ...DEFAULT_PRESET, ...species.preset } as PalmPreset

        const group = new THREE.Group()
        group.name = `palm_${species.id}`

        // Parse leaf tint
        const tintHex = species.leafTint.summer
        let leafColor: THREE.Color
        if (tintHex != null) {
            const hexNum = typeof tintHex === 'string'
                ? parseInt(tintHex.replace('0x', ''), 16)
                : tintHex
            leafColor = new THREE.Color(hexNum)
        } else {
            leafColor = new THREE.Color(0x338833)
        }

        // Build trunk
        const trunk = this.buildTrunk(p, rng, simplified)
        group.add(trunk.mesh)

        // Build fronds at crown
        const frondResult = this.buildFronds(
            p, rng, simplified, leafColor, trunk.crownPos, trunk.crownDir,
        )
        group.add(frondResult.group)

        const totalTris = trunk.triCount + frondResult.triCount
        const boundingRadius = Math.max(
            p.trunkHeight,
            p.frondLength + p.trunkRadius,
        )

        return { object: group, triangleCount: totalTris, boundingRadius }
    }

    // ========================================================================
    // TRUNK — curved tapered tube with bark ring bumps
    // ========================================================================

    private buildTrunk(
        p: PalmPreset, rng: () => number, simplified: boolean,
    ): { mesh: THREE.Mesh; triCount: number; crownPos: THREE.Vector3; crownDir: THREE.Vector3 } {
        const heightSegments = simplified ? 10 : 16
        const radialSegments = simplified ? 6 : 8

        // Quadratic bezier control points for trunk curve
        // Random curve direction from seed
        const curveAngle = rng() * Math.PI * 2
        const curveDisp = p.trunkCurve * p.trunkHeight * 0.25
        const ctrlX = Math.cos(curveAngle) * curveDisp * 0.5
        const ctrlZ = Math.sin(curveAngle) * curveDisp * 0.5
        const endX = Math.cos(curveAngle) * curveDisp
        const endZ = Math.sin(curveAngle) * curveDisp

        const vertCount = (heightSegments + 1) * (radialSegments + 1)
        const positions = new Float32Array(vertCount * 3)
        const colors = new Float32Array(vertCount * 3)
        const normals = new Float32Array(vertCount * 3)

        const baseColor = new THREE.Color(0x6B4226)   // dark brown
        const topColor = new THREE.Color(0x8B7914)     // lighter tan-brown
        const ringColor = new THREE.Color(0x3D2510)    // very dark brown for ring marks

        const crownPos = new THREE.Vector3()
        const crownDir = new THREE.Vector3()

        for (let h = 0; h <= heightSegments; h++) {
            const t = h / heightSegments

            // Quadratic bezier: P = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
            const oneMinusT = 1 - t
            const pathX = oneMinusT * oneMinusT * 0 + 2 * oneMinusT * t * ctrlX + t * t * endX
            const pathY = t * p.trunkHeight
            const pathZ = oneMinusT * oneMinusT * 0 + 2 * oneMinusT * t * ctrlZ + t * t * endZ

            // Bezier tangent: dP/dt = 2(1-t)(P1-P0) + 2t(P2-P1)
            const tanX = 2 * oneMinusT * ctrlX + 2 * t * (endX - ctrlX)
            const tanY = p.trunkHeight / heightSegments * heightSegments // simplify: just trunkHeight
            const tanZ = 2 * oneMinusT * ctrlZ + 2 * t * (endZ - ctrlZ)

            if (h === heightSegments) {
                crownPos.set(pathX, pathY, pathZ)
                const tLen = Math.sqrt(tanX * tanX + tanY * tanY + tanZ * tanZ)
                crownDir.set(tanX / tLen, tanY / tLen, tanZ / tLen)
            }

            // Trunk tapers from base to top (keep 50% radius at top)
            let radius = p.trunkRadius * (1 - t * 0.5)

            // Bark ring bumps — swell at regular intervals
            const ringSpacing = simplified ? 4 : 3
            const isRing = h > 0 && h < heightSegments && (h % ringSpacing === 0)
            if (isRing) {
                radius *= 1.15
            }

            // Slight base flare
            if (h <= 2) {
                radius *= 1 + (1 - t * heightSegments / 2) * 0.3
            }

            for (let r = 0; r <= radialSegments; r++) {
                const theta = (r / radialSegments) * Math.PI * 2
                const nx = Math.cos(theta)
                const nz = Math.sin(theta)

                const idx = (h * (radialSegments + 1) + r) * 3
                positions[idx] = pathX + nx * radius
                positions[idx + 1] = pathY
                positions[idx + 2] = pathZ + nz * radius

                normals[idx] = nx
                normals[idx + 1] = 0
                normals[idx + 2] = nz

                // Vertex color: brown gradient + ring darkening
                const c = baseColor.clone().lerp(topColor, t)
                if (isRing) {
                    c.lerp(ringColor, 0.5)
                }
                // Per-vertex noise
                c.multiplyScalar(0.92 + rng() * 0.16)

                colors[idx] = c.r
                colors[idx + 1] = c.g
                colors[idx + 2] = c.b
            }
        }

        // Build index buffer — triangle strips between rings
        const indices: number[] = []
        for (let h = 0; h < heightSegments; h++) {
            for (let r = 0; r < radialSegments; r++) {
                const a = h * (radialSegments + 1) + r
                const b = a + radialSegments + 1
                const c = a + 1
                const d = b + 1

                indices.push(a, b, c)
                indices.push(c, b, d)
            }
        }

        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
        geo.setIndex(indices)
        geo.computeVertexNormals()

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.85,
            metalness: 0.0,
            side: THREE.DoubleSide,
        })

        const mesh = new THREE.Mesh(geo, material)
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.name = 'palm_trunk'

        const triCount = indices.length / 3
        return { mesh, triCount, crownPos, crownDir }
    }

    // ========================================================================
    // FRONDS — pinnate leaves arranged in golden-angle spiral at crown
    // ========================================================================

    private buildFronds(
        p: PalmPreset, rng: () => number, simplified: boolean,
        leafColor: THREE.Color, crownPos: THREE.Vector3, _crownDir: THREE.Vector3,
    ): { group: THREE.Group; triCount: number } {
        const frondGroup = new THREE.Group()
        frondGroup.name = 'palm_fronds'
        let totalTris = 0

        const pinnaePerSide = simplified ? 5 : 8
        const rachisSegments = simplified ? 4 : 6

        for (let f = 0; f < p.frondCount; f++) {
            // Golden angle spiral arrangement
            const baseAngle = f * GOLDEN_ANGLE + rng() * 0.2
            // Slight vertical tilt variation — some fronds point up, some droop more
            const tiltVariation = (rng() - 0.3) * 0.3  // bias slightly upward

            const frondMesh = this.buildSingleFrond(
                p, rng, leafColor, pinnaePerSide, rachisSegments, tiltVariation,
            )

            // Position at crown and rotate around Y
            frondMesh.position.copy(crownPos)
            frondMesh.rotation.y = baseAngle

            frondGroup.add(frondMesh)
            totalTris += this.countFrondTris(rachisSegments, pinnaePerSide)
        }

        return { group: frondGroup, triCount: totalTris }
    }

    private buildSingleFrond(
        p: PalmPreset, rng: () => number, leafColor: THREE.Color,
        pinnaePerSide: number, rachisSegments: number, tiltVariation: number,
    ): THREE.Mesh {
        const positions: number[] = []
        const colors: number[] = []
        const indices: number[] = []

        const rachisWidth = 0.04 // narrow stem
        const pinnaWidth = p.frondLength * 0.08
        const pinnaLength = p.frondLength * 0.15

        // Build rachis path points
        const rachisPoints: THREE.Vector3[] = []
        for (let i = 0; i <= rachisSegments; i++) {
            const t = i / rachisSegments
            // Rachis curves outward (X) and droops (Y)
            const x = t * p.frondLength
            // Quadratic droop: starts nearly horizontal, curves down
            const droopAmount = p.frondDroop + tiltVariation
            const y = -t * t * droopAmount * p.frondLength * 0.5
            // Slight upward initial lift before droop
            const lift = Math.sin(t * Math.PI * 0.3) * p.frondLength * 0.08
            rachisPoints.push(new THREE.Vector3(x, y + lift, 0))
        }

        // Build rachis as a ribbon (2 verts per segment, forming a strip)
        let vertIndex = 0

        for (let i = 0; i <= rachisSegments; i++) {
            const pt = rachisPoints[i]
            const t = i / rachisSegments
            const width = rachisWidth * (1 - t * 0.5) // taper

            // Rachis color — slightly darker than leaf
            const rc = leafColor.clone().multiplyScalar(0.5 + rng() * 0.1)

            // Two vertices: one on each side of the rachis center
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
            const t = i / (pinnaePerSide + 1) // don't place at very base or tip
            // Interpolate position along rachis
            const segF = t * rachisSegments
            const seg = Math.floor(segF)
            const frac = segF - seg
            const pt0 = rachisPoints[Math.min(seg, rachisSegments)]
            const pt1 = rachisPoints[Math.min(seg + 1, rachisSegments)]
            const attachX = pt0.x + (pt1.x - pt0.x) * frac
            const attachY = pt0.y + (pt1.y - pt0.y) * frac

            // Pinna size tapers toward tip
            const sizeFactor = 1 - t * 0.6
            const pw = pinnaWidth * sizeFactor
            const pl = pinnaLength * sizeFactor * (0.8 + rng() * 0.4)

            // Pinna angle — angled slightly downward from rachis
            const pinnaAngle = 0.3 + t * 0.4 // more droop toward tip

            // Per-pinna color variation
            const pc = leafColor.clone()
            pc.multiplyScalar(0.85 + rng() * 0.3)

            // Build pinna on both sides (-Z and +Z)
            for (const side of [-1, 1]) {
                const baseVert = positions.length / 3

                // 4 vertices: base inner, base outer, tip inner, tip outer
                // Inner edge (attached to rachis)
                positions.push(attachX, attachY, side * 0.05)
                colors.push(pc.r, pc.g, pc.b)

                // Outer base
                positions.push(attachX, attachY - pl * pinnaAngle * 0.3, side * pw)
                colors.push(pc.r * 0.95, pc.g * 0.95, pc.b * 0.95)

                // Tip inner
                positions.push(attachX + pl * 0.8, attachY - pl * pinnaAngle, side * 0.05)
                colors.push(pc.r * 0.9, pc.g * 0.9, pc.b * 0.9)

                // Tip outer
                positions.push(
                    attachX + pl * 0.6,
                    attachY - pl * pinnaAngle * 0.8,
                    side * pw * 0.5,
                )
                colors.push(pc.r * 0.85, pc.g * 0.88, pc.b * 0.85)

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
            roughness: 0.75,
            metalness: 0.0,
            side: THREE.DoubleSide,
        })

        const mesh = new THREE.Mesh(geo, material)
        mesh.castShadow = true
        mesh.receiveShadow = true

        return mesh
    }

    private countFrondTris(rachisSegments: number, pinnaePerSide: number): number {
        const rachisTris = rachisSegments * 2
        const pinnaeTris = pinnaePerSide * 2 * 2 // 2 sides × 2 tris per pinna
        return rachisTris + pinnaeTris
    }

    dispose(): void {
        // No shared resources to clean up
    }
}
