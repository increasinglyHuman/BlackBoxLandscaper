/**
 * PalmGenerator — procedural palm trees via curved trunk + multi-ring frond crown.
 *
 * Algorithm:
 *   1. Trunk: tapered tube following a quadratic bezier curve with bark ring bumps.
 *      Seed-based curve variety — most trees gentle, some pronounced, rare epic arcs.
 *   2. Small crown bulb: barely larger than trunk top, where fronds emerge
 *   3. 4 concentric rings of doubled fronds creating dense spherical crown
 *   4. Each frond: 5-segment chain (10 tris). Each segment is rotated
 *      progressively to form a gravity-obeying arc. Bottom fronds arc
 *      most, top fronds arc least.
 *   5. UV pivot at bottom-right of texture (where rachis base is).
 *      Alpha cutout from PNG transparency defines visual frond shape.
 *
 * Preset parameters in species.preset:
 *   trunkHeight, trunkCurve, trunkRadius, frondCount, frondLength, frondDroop
 */

import * as THREE from 'three'
import type { MeshGenerator } from './types.js'
import type { GeneratorOutput, SpeciesDefinition } from '../types/index.js'
import palmFrondUrl from '../assets/textures/palmFrond.png'

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
    trunkHeight: number
    trunkCurve: number
    trunkRadius: number
    frondCount: number
    frondLength: number
    frondDroop: number
}

const DEFAULT_PRESET: PalmPreset = {
    trunkHeight: 15,
    trunkCurve: 0.3,
    trunkRadius: 0.4,
    frondCount: 12,
    frondLength: 6,
    frondDroop: 0.4,
}

const NUM_FROND_SEGMENTS = 5 // 5 segments = 10 tris per frond

export class PalmGenerator implements MeshGenerator {
    readonly type = 'palm'

    private frondTexture: THREE.Texture | null = null

    private ensureTexture(): THREE.Texture {
        if (!this.frondTexture) {
            const loader = new THREE.TextureLoader()
            this.frondTexture = loader.load(palmFrondUrl)
            this.frondTexture.colorSpace = THREE.SRGBColorSpace
        }
        return this.frondTexture
    }

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

        // Small crown bulb
        const bulb = this.buildCrownBulb(p, trunk.crownPos)
        group.add(bulb.mesh)

        // Build multi-ring frond crown
        const frondResult = this.buildFronds(p, rng, leafColor, trunk.crownPos)
        group.add(frondResult.group)

        const totalTris = trunk.triCount + bulb.triCount + frondResult.triCount
        const boundingRadius = Math.max(p.trunkHeight, p.frondLength + p.trunkRadius)

        return { object: group, triangleCount: totalTris, boundingRadius }
    }

    // ========================================================================
    // TRUNK — curved tapered tube with seed-based curve variety
    // ========================================================================
    //
    // Most trees get a gentle curve, some get a pronounced lean, and ~15%
    // get an epic sweeping arc — the kind you see in classic palm cluster
    // photographs where one tree dramatically leans away from the group.
    // ========================================================================

    private buildTrunk(
        p: PalmPreset, rng: () => number, simplified: boolean,
    ): { mesh: THREE.Mesh; triCount: number; crownPos: THREE.Vector3 } {
        const heightSegs = simplified ? 10 : 16
        const radialSegs = simplified ? 6 : 8

        const curveAngle = rng() * Math.PI * 2

        // Seed-based trunk curve variety
        const curveRoll = rng()
        let curveMult: number
        if (curveRoll < 0.60) {
            curveMult = 0.8 + rng() * 0.7    // 60%: normal (0.8–1.5×)
        } else if (curveRoll < 0.85) {
            curveMult = 1.5 + rng() * 1.5    // 25%: pronounced (1.5–3.0×)
        } else {
            curveMult = 3.0 + rng() * 2.5    // 15%: epic arc (3.0–5.5×)
        }

        const curveDisp = p.trunkCurve * p.trunkHeight * 0.25 * curveMult

        // For pronounced/epic curves, the control point bows out more at
        // mid-height — the trunk starts leaning sooner, creating a more
        // dramatic sweeping shape rather than just a gentle tip-lean.
        const ctrlBow = curveMult > 2.0
            ? 0.5 + (curveMult - 2.0) * 0.06
            : 0.5

        const ctrlX = Math.cos(curveAngle) * curveDisp * ctrlBow
        const ctrlZ = Math.sin(curveAngle) * curveDisp * ctrlBow
        const endX = Math.cos(curveAngle) * curveDisp
        const endZ = Math.sin(curveAngle) * curveDisp

        const vertCount = (heightSegs + 1) * (radialSegs + 1)
        const positions = new Float32Array(vertCount * 3)
        const colors = new Float32Array(vertCount * 3)

        const baseColor = new THREE.Color(0x6B4226)
        const topColor = new THREE.Color(0x8B7914)
        const ringColor = new THREE.Color(0x3D2510)

        const crownPos = new THREE.Vector3()

        for (let h = 0; h <= heightSegs; h++) {
            const t = h / heightSegs
            const omt = 1 - t

            const pathX = 2 * omt * t * ctrlX + t * t * endX
            const pathY = t * p.trunkHeight
            const pathZ = 2 * omt * t * ctrlZ + t * t * endZ

            if (h === heightSegs) crownPos.set(pathX, pathY, pathZ)

            let radius = p.trunkRadius * (1 - t * 0.5)

            // Slight crown swell
            if (t > 0.9) {
                radius *= 1 + ((t - 0.9) / 0.1) * 0.2
            }

            // Bark ring bumps
            const ringSpacing = simplified ? 4 : 3
            const isRing = h > 0 && h < heightSegs && (h % ringSpacing === 0)
            if (isRing) radius *= 1.12

            // Base flare
            if (t < 0.12) radius *= 1 + (1 - t / 0.12) * 0.35

            for (let r = 0; r <= radialSegs; r++) {
                const theta = (r / radialSegs) * Math.PI * 2
                const nx = Math.cos(theta)
                const nz = Math.sin(theta)

                const idx = (h * (radialSegs + 1) + r) * 3
                positions[idx] = pathX + nx * radius
                positions[idx + 1] = pathY
                positions[idx + 2] = pathZ + nz * radius

                const c = baseColor.clone().lerp(topColor, t)
                if (isRing) c.lerp(ringColor, 0.5)
                c.multiplyScalar(0.92 + rng() * 0.16)

                colors[idx] = c.r
                colors[idx + 1] = c.g
                colors[idx + 2] = c.b
            }
        }

        const indices: number[] = []
        for (let h = 0; h < heightSegs; h++) {
            for (let r = 0; r < radialSegs; r++) {
                const a = h * (radialSegs + 1) + r
                const b = a + radialSegs + 1
                const c = a + 1
                const d = b + 1
                indices.push(a, b, c)
                indices.push(c, b, d)
            }
        }

        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
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

        return { mesh, triCount: indices.length / 3, crownPos }
    }

    // ========================================================================
    // CROWN BULB — small, barely larger than trunk top
    // ========================================================================

    private buildCrownBulb(
        p: PalmPreset, crownPos: THREE.Vector3,
    ): { mesh: THREE.Mesh; triCount: number } {
        const bulbRadius = p.trunkRadius * 1.2
        const geo = new THREE.SphereGeometry(bulbRadius, 8, 6)
        geo.scale(1, 1.2, 1)

        const posAttr = geo.getAttribute('position')
        const colorArr = new Float32Array(posAttr.count * 3)
        const darkBrown = new THREE.Color(0x3A2010)
        for (let i = 0; i < posAttr.count; i++) {
            const y = posAttr.getY(i)
            const t = (y / (bulbRadius * 1.2)) * 0.5 + 0.5
            const c = new THREE.Color(0x2A1808).lerp(darkBrown, t)
            colorArr[i * 3] = c.r
            colorArr[i * 3 + 1] = c.g
            colorArr[i * 3 + 2] = c.b
        }
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colorArr, 3))

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.8,
            metalness: 0.0,
        })

        const mesh = new THREE.Mesh(geo, material)
        mesh.position.copy(crownPos)
        mesh.position.y += bulbRadius * 0.3
        mesh.castShadow = true
        mesh.name = 'palm_crown_bulb'

        const triCount = geo.index ? geo.index.count / 3 : posAttr.count / 3
        return { mesh, triCount }
    }

    // ========================================================================
    // FRONDS — 4 concentric rings, doubled count, stronger arcs at bottom
    // ========================================================================

    private buildFronds(
        p: PalmPreset, rng: () => number,
        leafColor: THREE.Color, crownPos: THREE.Vector3,
    ): { group: THREE.Group; triCount: number } {
        const frondGroup = new THREE.Group()
        frondGroup.name = 'palm_fronds'
        let totalTris = 0

        const texture = this.ensureTexture()

        // Double the frond count for dense, lush crown
        const frondCount = p.frondCount * 2

        // 4 concentric rings
        // liftBase: initial angle in radians (positive = upward)
        // arcBase: how much the frond arcs downward (total arc ≈ arcBase × 1.1 rad)
        // lengthScale: fraction of frondLength
        // yOffset: height offset from crown (in trunk-radius units)
        // widthMult: plane width as fraction of length
        const rings = [
            // Ring 1 (top): steep upward, barely arcs
            { count: Math.max(3, Math.round(frondCount * 0.15)),
              liftBase: 1.0, arcBase: 0.25, lengthScale: 0.5, yOffset: 0.8, widthMult: 0.7 },
            // Ring 2: upward/outward, gentle arc
            { count: Math.max(4, Math.round(frondCount * 0.25)),
              liftBase: 0.4, arcBase: 0.65, lengthScale: 0.8, yOffset: 0.3, widthMult: 0.85 },
            // Ring 3: outward, strong arc — main visual mass
            { count: Math.max(6, Math.round(frondCount * 0.35)),
              liftBase: 0.0, arcBase: 1.15, lengthScale: 1.0, yOffset: -0.1, widthMult: 0.95 },
            // Ring 4 (bottom): drooping, heavy arc
            { count: Math.max(4, frondCount - Math.round(frondCount * 0.75)),
              liftBase: -0.3, arcBase: 1.7, lengthScale: 0.85, yOffset: -0.4, widthMult: 0.85 },
        ]

        let frondIndex = 0
        const crownRadius = p.trunkRadius * 1.2

        for (const ring of rings) {
            const ringAngleOffset = rng() * Math.PI * 2

            for (let f = 0; f < ring.count; f++) {
                const baseAngle = ringAngleOffset + f * (Math.PI * 2 / ring.count) + (rng() - 0.5) * 0.4

                // Per-frond randomization — wider range for organic extremes
                const lengthVar = ring.lengthScale * (0.85 + rng() * 0.3)
                const arcVar = ring.arcBase * (0.6 + rng() * 0.8)
                const liftVar = ring.liftBase + (rng() - 0.5) * 0.3
                const widthVar = ring.widthMult * (0.85 + rng() * 0.3)

                // Color variation per ring
                const tierTint = leafColor.clone()
                if (ring.yOffset < -0.2) {
                    tierTint.multiplyScalar(0.75)
                } else if (ring.yOffset > 0.5) {
                    tierTint.offsetHSL(0.02, 0, 0.06)
                }

                const frondMesh = this.buildSingleFrond(
                    p.frondLength * lengthVar, arcVar, liftVar, widthVar,
                    tierTint, rng, texture,
                )

                frondMesh.position.copy(crownPos)
                frondMesh.position.y += crownRadius * ring.yOffset
                frondMesh.rotation.y = baseAngle

                frondGroup.add(frondMesh)
                totalTris += NUM_FROND_SEGMENTS * 2
                frondIndex++
            }
        }

        return { group: frondGroup, triCount: totalTris }
    }

    // ========================================================================
    // SINGLE FROND — 5-segment chain with progressive arc rotation
    // ========================================================================
    //
    // Each frond is 5 linked segments (10 tris). Each segment starts where the
    // previous ended, rotated slightly more downward. This creates a gravity-
    // obeying arc — gentle at top, heavy droop at bottom fronds.
    //
    // UV pivot at bottom-right of texture (rachis base).
    //   Right edge (Z=0)      → U=1 (rachis/pivot side)
    //   Left edge (Z=-width)  → U=0 (pinnae side)
    //   Base (chain start)    → V=0
    //   Tip (chain end)       → V=1
    // ========================================================================

    private buildSingleFrond(
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

            // Left edge — pinnae side, extends in -Z
            positions[base * 3] = chainX
            positions[base * 3 + 1] = chainY
            positions[base * 3 + 2] = -w

            const lc = leafColor.clone().multiplyScalar(0.85 + rng() * 0.2)
            colors[base * 3] = lc.r
            colors[base * 3 + 1] = lc.g
            colors[base * 3 + 2] = lc.b

            uvs[base * 2] = 0       // U=0 (left/pinnae side of texture)
            uvs[base * 2 + 1] = v   // V=t (bottom to top)

            // Right edge — rachis/pivot side, at Z=0
            positions[(base + 1) * 3] = chainX
            positions[(base + 1) * 3 + 1] = chainY
            positions[(base + 1) * 3 + 2] = 0

            const rc = leafColor.clone().multiplyScalar(0.85 + rng() * 0.2)
            colors[(base + 1) * 3] = rc.r
            colors[(base + 1) * 3 + 1] = rc.g
            colors[(base + 1) * 3 + 2] = rc.b

            uvs[(base + 1) * 2] = 1     // U=1 (right/pivot side of texture)
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
            vertexColors: true,
            roughness: 0.7,
            metalness: 0.0,
            side: THREE.DoubleSide,
            alphaTest: 0.4,
            transparent: false,
            emissive: new THREE.Color(0x0a1a0a),
            emissiveIntensity: 0.3,
        })

        const mesh = new THREE.Mesh(geo, material)
        mesh.castShadow = true
        mesh.receiveShadow = true

        return mesh
    }

    dispose(): void {
        this.frondTexture?.dispose()
        this.frondTexture = null
    }
}
