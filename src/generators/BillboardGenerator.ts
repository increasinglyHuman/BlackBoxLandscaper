/**
 * BillboardGenerator — creates crossed-quad billboard sprites.
 *
 * Used for:
 * - Distant LOD levels (LOD 2/3) of any tree
 * - Underwater plants (kelp, eelgrass)
 * - Beach grass
 *
 * A crossed billboard is two perpendicular textured quads — the same technique
 * OpenSim uses for Linden trees. Cheap (8 triangles) and effective at distance.
 */

import * as THREE from 'three'
import type { MeshGenerator } from './types.js'
import type { GeneratorOutput, SpeciesDefinition } from '../types/index.js'

export class BillboardGenerator implements MeshGenerator {
    readonly type = 'billboard'

    /**
     * Generate crossed billboard quads.
     * For billboard-only species (kelp, grass), this is the primary output.
     * For tree species, this is used as the distant LOD.
     */
    generate(species: SpeciesDefinition, _seed?: number): GeneratorOutput {
        const preset = species.preset || {}
        const height = (preset.height as number) || 10
        const width = (preset.width as number) || height * 0.7
        const tintHex = species.leafTint.summer
        let color: THREE.Color
        if (tintHex != null) {
            const hexNum = typeof tintHex === 'string' ? parseInt(tintHex.replace('0x', ''), 16) : tintHex
            color = new THREE.Color(hexNum)
        } else {
            color = new THREE.Color(0x448844)
        }

        const group = new THREE.Group()
        group.name = `billboard_${species.id}`

        // Create material
        const material = new THREE.MeshBasicMaterial({
            color,
            side: THREE.DoubleSide,
            transparent: true,
            alphaTest: 0.1,
            depthWrite: true,
        })

        // Create two perpendicular quads (crossed billboard)
        const geometry = new THREE.PlaneGeometry(width, height)

        // Quad 1 — facing Z
        const quad1 = new THREE.Mesh(geometry, material)
        quad1.position.y = height / 2
        group.add(quad1)

        // Quad 2 — rotated 90 degrees, facing X
        const quad2 = new THREE.Mesh(geometry.clone(), material)
        quad2.position.y = height / 2
        quad2.rotation.y = Math.PI / 2
        group.add(quad2)

        return {
            object: group,
            triangleCount: 4, // 2 quads × 2 triangles each
            boundingRadius: Math.sqrt(width * width + height * height) / 2,
        }
    }

    dispose(): void {
        // Nothing to clean up
    }
}
