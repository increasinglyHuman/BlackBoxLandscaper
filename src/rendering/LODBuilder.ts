/**
 * LODBuilder — creates THREE.LOD objects from generator outputs.
 *
 * LOD cascade:
 *   LOD 0 (close):   Full procedural mesh (3,000-5,000 tri)
 *   LOD 1 (mid):     Simplified mesh (500-1,000 tri)
 *   LOD 2 (far):     Crossed billboard (4-8 tri)
 */

import * as THREE from 'three'
import type { SpeciesDefinition, GeneratorOutput } from '../types/index.js'
import type { MeshGenerator } from '../generators/types.js'
import { BillboardGenerator } from '../generators/BillboardGenerator.js'

export class LODBuilder {
    private billboardGenerator: BillboardGenerator

    constructor() {
        this.billboardGenerator = new BillboardGenerator()
    }

    /**
     * Build a THREE.LOD for a species using the provided generator.
     *
     * @param species - Species definition with LOD distance thresholds
     * @param generator - The mesh generator (EzTreeAdapter, etc.)
     * @param seed - Seed for reproducible generation
     * @returns THREE.LOD with 2-3 detail levels
     */
    build(species: SpeciesDefinition, generator: MeshGenerator, seed?: number): THREE.LOD {
        const lod = new THREE.LOD()
        const distances = species.lodDistances

        // LOD 0 — Full detail
        const full = generator.generate(species, seed)
        lod.addLevel(full.object, distances[0])

        // LOD 1 — Simplified (if generator supports it)
        if (generator.generateSimplified) {
            const simplified = generator.generateSimplified(species, seed)
            lod.addLevel(simplified.object, distances[1])
        }

        // LOD 2 — Billboard
        const billboard = this.billboardGenerator.generate(species, seed)
        lod.addLevel(billboard.object, distances[2])

        return lod
    }

    /**
     * Build a simple (non-LOD) mesh — useful for dev harness and testing.
     */
    buildSimple(species: SpeciesDefinition, generator: MeshGenerator, seed?: number): THREE.Object3D {
        const result = generator.generate(species, seed)
        return result.object
    }

    dispose(): void {
        this.billboardGenerator.dispose()
    }
}
