/**
 * PalmGenerator — procedural palm trees via curved trunk + continuous leaf fronds.
 *
 * Algorithm:
 *   1. Trunk: tapered tube following a quadratic bezier curve with bark ring bumps
 *   2. Crown bulb: swollen ellipsoid at top where fronds emerge
 *   3. Fronds: continuous tapered leaf planes (3 verts per cross-section —
 *      left edge, raised rachis center, right edge) with subtle edge undulation
 *   4. Golden-angle spiral arrangement with per-frond random variation
 *   5. Vertex colors throughout — no textures needed
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

const GOLDEN_ANGLE = 137.508 * (Math.PI / 180)

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

        // Build trunk (returns crown position for frond placement)
        const trunk = this.buildTrunk(p, rng, simplified)
        group.add(trunk.mesh)

        // Build crown bulb at top of trunk
        const bulb = this.buildCrownBulb(p, rng, trunk.crownPos)
        group.add(bulb.mesh)

        // Build fronds emerging from crown
        const frondResult = this.buildFronds(p, rng, simplified, leafColor, trunk.crownPos)
        group.add(frondResult.group)

        const totalTris = trunk.triCount + bulb.triCount + frondResult.triCount
        const boundingRadius = Math.max(p.trunkHeight, p.frondLength + p.trunkRadius)

        return { object: group, triangleCount: totalTris, boundingRadius }
    }

    // ========================================================================
    // TRUNK — curved tapered tube with bark ring bumps
    // ========================================================================

    private buildTrunk(
        p: PalmPreset, rng: () => number, simplified: boolean,
    ): { mesh: THREE.Mesh; triCount: number; crownPos: THREE.Vector3 } {
        const heightSegs = simplified ? 10 : 16
        const radialSegs = simplified ? 6 : 8

        // Random curve direction
        const curveAngle = rng() * Math.PI * 2
        const curveDisp = p.trunkCurve * p.trunkHeight * 0.25
        const ctrlX = Math.cos(curveAngle) * curveDisp * 0.5
        const ctrlZ = Math.sin(curveAngle) * curveDisp * 0.5
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

            // Quadratic bezier path
            const pathX = omt * omt * 0 + 2 * omt * t * ctrlX + t * t * endX
            const pathY = t * p.trunkHeight
            const pathZ = omt * omt * 0 + 2 * omt * t * ctrlZ + t * t * endZ

            if (h === heightSegs) {
                crownPos.set(pathX, pathY, pathZ)
            }

            // Taper from base to top (keep 50% at crown)
            let radius = p.trunkRadius * (1 - t * 0.5)

            // Crown swell — widen slightly in top 15% to transition to bulb
            if (t > 0.85) {
                const swellT = (t - 0.85) / 0.15
                radius *= 1 + swellT * 0.4
            }

            // Bark ring bumps
            const ringSpacing = simplified ? 4 : 3
            const isRing = h > 0 && h < heightSegs && (h % ringSpacing === 0)
            if (isRing) radius *= 1.12

            // Base flare
            if (t < 0.12) {
                radius *= 1 + (1 - t / 0.12) * 0.35
            }

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
    // CROWN BULB — swollen ellipsoid where fronds emerge
    // ========================================================================

    private buildCrownBulb(
        p: PalmPreset, _rng: () => number, crownPos: THREE.Vector3,
    ): { mesh: THREE.Mesh; triCount: number } {
        const bulbRadius = p.trunkRadius * 1.8
        const geo = new THREE.SphereGeometry(bulbRadius, 8, 6)
        geo.scale(1, 1.3, 1) // taller than wide

        // Vertex colors — green-brown transition
        const posAttr = geo.getAttribute('position')
        const colorArr = new Float32Array(posAttr.count * 3)
        const brownGreen = new THREE.Color(0x5B6B20) // olive-brown
        for (let i = 0; i < posAttr.count; i++) {
            const y = posAttr.getY(i)
            const t = (y / (bulbRadius * 1.3)) * 0.5 + 0.5 // 0 at bottom, 1 at top
            const c = new THREE.Color(0x6B4226).lerp(brownGreen, t)
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
        mesh.position.y += bulbRadius * 0.3 // sit slightly above trunk top
        mesh.castShadow = true
        mesh.name = 'palm_crown_bulb'

        const triCount = geo.index ? geo.index.count / 3 : posAttr.count / 3
        return { mesh, triCount }
    }

    // ========================================================================
    // FRONDS — continuous tapered leaf planes in golden-angle spiral
    // ========================================================================

    private buildFronds(
        p: PalmPreset, rng: () => number, simplified: boolean,
        leafColor: THREE.Color, crownPos: THREE.Vector3,
    ): { group: THREE.Group; triCount: number } {
        const frondGroup = new THREE.Group()
        frondGroup.name = 'palm_fronds'
        let totalTris = 0

        const segments = simplified ? 6 : 10

        for (let f = 0; f < p.frondCount; f++) {
            // Golden angle spiral with random jitter
            const baseAngle = f * GOLDEN_ANGLE + (rng() - 0.5) * 0.4

            // Per-frond variation
            const lengthVar = 0.75 + rng() * 0.5   // 75%-125% of base length
            const droopVar = p.frondDroop * (0.6 + rng() * 0.8)  // varied droop
            const liftAngle = (rng() - 0.3) * 0.5  // some tilt up, some down
            const widthVar = 0.8 + rng() * 0.4     // width variation

            const frondMesh = this.buildSingleFrond(
                p.frondLength * lengthVar, droopVar, liftAngle, widthVar,
                leafColor, rng, segments,
            )

            // Position at crown and rotate around Y axis
            frondMesh.position.copy(crownPos)
            frondMesh.position.y += p.trunkRadius * 0.5 // emerge from upper crown
            frondMesh.rotation.y = baseAngle

            frondGroup.add(frondMesh)
            totalTris += segments * 4 // 4 tris per segment (left+right halves)
        }

        return { group: frondGroup, triCount: totalTris }
    }

    private buildSingleFrond(
        length: number, droop: number, liftAngle: number, widthFactor: number,
        leafColor: THREE.Color, rng: () => number, segments: number,
    ): THREE.Mesh {
        // 3 vertices per cross-section: left edge, center rachis, right edge
        const vertCount = (segments + 1) * 3
        const positions = new Float32Array(vertCount * 3)
        const colors = new Float32Array(vertCount * 3)

        const maxHalfWidth = length * 0.12 * widthFactor
        const rachisRaise = 0.04 // slight ridge along center

        for (let i = 0; i <= segments; i++) {
            const t = i / segments

            // Position along curved frond
            const x = t * length

            // Lift then droop curve
            const lift = Math.sin(t * Math.PI * 0.35) * length * 0.08
            const droopY = t * t * droop * length * 0.5
            const tiltY = Math.sin(t * Math.PI * 0.5) * liftAngle * length * 0.15
            const y = lift - droopY + tiltY

            // Width envelope: ramp up in first 15%, then concave taper to point
            let wFactor: number
            if (t < 0.15) {
                wFactor = t / 0.15
            } else {
                wFactor = Math.pow(1 - (t - 0.15) / 0.85, 0.65)
            }
            const halfW = maxHalfWidth * wFactor

            // Subtle edge undulation to hint at individual pinnae
            const undulation = Math.sin(t * Math.PI * 8) * maxHalfWidth * 0.04 * wFactor

            const base = i * 3

            // Left edge
            const leftIdx = base * 3
            positions[leftIdx] = x
            positions[leftIdx + 1] = y
            positions[leftIdx + 2] = -(halfW + undulation)

            const lc = leafColor.clone().multiplyScalar(0.82 + rng() * 0.25)
            colors[leftIdx] = lc.r
            colors[leftIdx + 1] = lc.g
            colors[leftIdx + 2] = lc.b

            // Center (rachis) — slightly raised, darker green
            const centerIdx = (base + 1) * 3
            positions[centerIdx] = x
            positions[centerIdx + 1] = y + rachisRaise * (1 - t * 0.8)
            positions[centerIdx + 2] = 0

            const cc = leafColor.clone().multiplyScalar(0.45 + rng() * 0.1)
            colors[centerIdx] = cc.r
            colors[centerIdx + 1] = cc.g
            colors[centerIdx + 2] = cc.b

            // Right edge
            const rightIdx = (base + 2) * 3
            positions[rightIdx] = x
            positions[rightIdx + 1] = y
            positions[rightIdx + 2] = halfW + undulation

            const rc = leafColor.clone().multiplyScalar(0.82 + rng() * 0.25)
            colors[rightIdx] = rc.r
            colors[rightIdx + 1] = rc.g
            colors[rightIdx + 2] = rc.b
        }

        // Build triangle indices — 4 tris per segment (2 for left half, 2 for right)
        const indices: number[] = []
        for (let i = 0; i < segments; i++) {
            const row = i * 3
            const next = (i + 1) * 3

            // Left half: left(row), center(row), left(next), center(next)
            indices.push(row, row + 1, next)       // left → center → nextLeft
            indices.push(row + 1, next + 1, next)  // center → nextCenter → nextLeft

            // Right half: center(row), right(row), center(next), right(next)
            indices.push(row + 1, row + 2, next + 1)    // center → right → nextCenter
            indices.push(row + 2, next + 2, next + 1)   // right → nextRight → nextCenter
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
