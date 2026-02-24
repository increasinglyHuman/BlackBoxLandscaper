/**
 * KelpGenerator — multi-segment textured kelp/seaweed blades.
 *
 * Algorithm:
 *   1. Each clump = N blades (2-6) scattered in a small spread radius
 *   2. Each blade = 6-10 segment chain growing upward with gentle S-curve
 *   3. PNG alpha-cutout texture (pivot at bottom-left, same as FernGenerator)
 *   4. Vertex colors tint the texture for per-blade variation
 *   5. Height attribute baked into UV.y for shader-driven sway animation
 *
 * Preset parameters in species.preset:
 *   bladeCount, height, width, segments, curvature, spread, texture
 */

import * as THREE from 'three'
import type { MeshGenerator } from './types.js'
import type { GeneratorOutput, SpeciesDefinition } from '../types/index.js'

// Texture imports — one per painted variant
import seaKelpUrl from '../assets/textures/seaKelp.png'
import rustKelpUrl from '../assets/textures/rustKelp.png'
import leafySeaweedUrl from '../assets/textures/leafySeaweed.png'
import fatKelpUrl from '../assets/textures/fatKelp.png'

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

interface KelpPreset {
    bladeCount: number
    height: number
    width: number
    segments: number
    curvature: number
    spread: number
    texture: string
}

const DEFAULT_PRESET: KelpPreset = {
    bladeCount: 3,
    height: 6,
    width: 1.2,
    segments: 8,
    curvature: 0.4,
    spread: 0.4,
    texture: 'seaKelp',
}

/** Map preset texture name → imported URL */
const TEXTURE_MAP: Record<string, string> = {
    seaKelp: seaKelpUrl,
    rustKelp: rustKelpUrl,
    leafySeaweed: leafySeaweedUrl,
    fatKelp: fatKelpUrl,
}

export class KelpGenerator implements MeshGenerator {
    readonly type = 'kelp'

    // Texture cache — one per texture variant, shared across instances
    private textureCache = new Map<string, THREE.Texture>()

    generate(species: SpeciesDefinition, seed?: number): GeneratorOutput {
        return this.build(species, seed ?? 42)
    }

    generateSimplified(species: SpeciesDefinition, seed?: number): GeneratorOutput {
        // Simplified: fewer blades, fewer segments
        const simplified = { ...species.preset, bladeCount: 2, segments: 4 }
        const modSpecies = { ...species, preset: simplified }
        return this.build(modSpecies, seed ?? 42)
    }

    private getTexture(textureName: string): THREE.Texture {
        let tex = this.textureCache.get(textureName)
        if (!tex) {
            const url = TEXTURE_MAP[textureName] || TEXTURE_MAP.seaKelp
            const loader = new THREE.TextureLoader()
            tex = loader.load(url)
            tex.colorSpace = THREE.SRGBColorSpace
            this.textureCache.set(textureName, tex)
        }
        return tex
    }

    private build(species: SpeciesDefinition, seed: number): GeneratorOutput {
        const rng = mulberry32(seed)
        const p = { ...DEFAULT_PRESET, ...species.preset } as KelpPreset

        // Parse leaf tint
        const tintHex = species.leafTint.summer
        let baseColor: THREE.Color
        if (tintHex != null) {
            const hexNum = typeof tintHex === 'string'
                ? parseInt(tintHex.replace('0x', ''), 16)
                : tintHex
            baseColor = new THREE.Color(hexNum)
        } else {
            baseColor = new THREE.Color(0x336622)
        }

        const group = new THREE.Group()
        group.name = `kelp_${species.id}`

        let totalTris = 0
        const texture = this.getTexture(p.texture)

        for (let b = 0; b < p.bladeCount; b++) {
            // Scatter blade within clump radius
            const angle = rng() * Math.PI * 2
            const dist = rng() * p.spread
            const bx = Math.cos(angle) * dist
            const bz = Math.sin(angle) * dist

            // Per-blade variation
            const heightVar = p.height * (0.7 + rng() * 0.6)
            const widthVar = p.width * (0.8 + rng() * 0.4)
            const curvatureVar = p.curvature * (0.5 + rng() * 1.0)

            // Per-blade color shift
            const bladeColor = baseColor.clone()
            bladeColor.offsetHSL(
                (rng() - 0.5) * 0.06,
                (rng() - 0.5) * 0.1,
                (rng() - 0.5) * 0.08,
            )

            // Random lean direction
            const leanDir = rng() * Math.PI * 2

            const bladeMesh = this.buildBlade(
                heightVar, widthVar, p.segments, curvatureVar,
                leanDir, bladeColor, rng, texture,
            )

            bladeMesh.position.set(bx, 0, bz)
            // Random Y rotation for variety
            bladeMesh.rotation.y = rng() * Math.PI * 2
            group.add(bladeMesh)
            totalTris += p.segments * 2
        }

        const boundingRadius = Math.max(p.spread + p.width, p.height) * 1.1

        return { object: group, triangleCount: totalTris, boundingRadius }
    }

    // ========================================================================
    // SINGLE BLADE — multi-segment chain growing upward with S-curve
    // ========================================================================
    //
    // UV pivot at bottom-LEFT (matching painted textures):
    //   Left edge  → U=0 (stipe/pivot side)
    //   Right edge → U=1 (blade tip side)
    //   Base       → V=0
    //   Top        → V=1
    // ========================================================================

    private buildBlade(
        height: number, width: number, segments: number, curvature: number,
        leanDir: number, bladeColor: THREE.Color, rng: () => number,
        texture: THREE.Texture,
    ): THREE.Mesh {
        const segLength = height / segments
        const vertCount = (segments + 1) * 2
        const positions = new Float32Array(vertCount * 3)
        const colors = new Float32Array(vertCount * 3)
        const uvs = new Float32Array(vertCount * 2)

        // Chain traversal — starts at origin, grows upward (+Y)
        let chainX = 0
        let chainY = 0
        let chainZ = 0
        // Start near vertical, slight initial lean
        let pitchAngle = Math.PI / 2 - (rng() - 0.5) * 0.15

        // S-curve bias — alternates direction for natural sway look
        const sCurveBias = (rng() - 0.5) * 0.4

        for (let i = 0; i <= segments; i++) {
            const t = i / segments

            // Width taper — full at ~30%, narrowing to 20% at tip, slim at base
            let wFactor: number
            if (t < 0.1) {
                wFactor = t / 0.1 * 0.6  // narrow stipe at base
            } else if (t < 0.35) {
                wFactor = 0.6 + (t - 0.1) / 0.25 * 0.4  // ramp to full width
            } else {
                wFactor = 1.0 - (t - 0.35) / 0.65 * 0.8  // taper to tip
            }
            const w = width * wFactor * 0.5

            // Perpendicular to lean direction (horizontal spread)
            const perpX = Math.cos(leanDir + Math.PI / 2) * w
            const perpZ = Math.sin(leanDir + Math.PI / 2) * w

            const base = i * 2

            // Left edge (pivot side)
            positions[base * 3] = chainX - perpX
            positions[base * 3 + 1] = chainY
            positions[base * 3 + 2] = chainZ - perpZ

            // Right edge (blade side)
            positions[(base + 1) * 3] = chainX + perpX
            positions[(base + 1) * 3 + 1] = chainY
            positions[(base + 1) * 3 + 2] = chainZ + perpZ

            // Colors — slightly vary along length
            const segColor = bladeColor.clone().multiplyScalar(0.85 + t * 0.25)
            colors[base * 3] = segColor.r
            colors[base * 3 + 1] = segColor.g
            colors[base * 3 + 2] = segColor.b
            colors[(base + 1) * 3] = segColor.r
            colors[(base + 1) * 3 + 1] = segColor.g
            colors[(base + 1) * 3 + 2] = segColor.b

            // UVs — bottom-left pivot
            uvs[base * 2] = 0         // U=0 left/pivot
            uvs[base * 2 + 1] = t     // V=t bottom→top
            uvs[(base + 1) * 2] = 1   // U=1 right
            uvs[(base + 1) * 2 + 1] = t

            // Advance chain upward with curvature
            if (i < segments) {
                // Progressive S-curve — gentle sway that increases with height
                const arcAmount = curvature * (0.3 + t * 1.2) / segments
                const sCurve = sCurveBias * Math.sin(t * Math.PI) * 0.3 / segments
                const randomWobble = (rng() - 0.5) * curvature * 0.1 / segments

                pitchAngle -= arcAmount + sCurve + randomWobble

                // Advance in lean direction + upward
                chainX += Math.cos(leanDir) * segLength * Math.cos(pitchAngle) * 0.3
                chainY += segLength * Math.sin(pitchAngle)
                chainZ += Math.sin(leanDir) * segLength * Math.cos(pitchAngle) * 0.3
            }
        }

        // Triangle indices: 2 tris per segment
        const indices: number[] = []
        for (let i = 0; i < segments; i++) {
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
            bumpScale: 0.7,
            vertexColors: true,
            roughness: 0.92,
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
        for (const [, tex] of this.textureCache) {
            tex.dispose()
        }
        this.textureCache.clear()
    }
}
