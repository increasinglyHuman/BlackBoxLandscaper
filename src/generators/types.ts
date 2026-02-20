/**
 * Generator interface — all mesh generators implement this contract.
 * Trees, rocks, crystals, bushes — same interface, different implementations.
 */

import type { GeneratorOutput, SpeciesDefinition } from '../types/index.js'

export interface MeshGenerator {
    /** Generator type identifier */
    readonly type: string

    /**
     * Generate a mesh for the given species definition.
     * @param species - Species configuration with generator-specific preset
     * @param seed - Optional seed for reproducible generation
     * @returns Generated mesh with metadata
     */
    generate(species: SpeciesDefinition, seed?: number): GeneratorOutput

    /**
     * Generate a simplified mesh for LOD 1 (mid-distance).
     * @param species - Species configuration
     * @param seed - Same seed as generate() for consistency
     */
    generateSimplified?(species: SpeciesDefinition, seed?: number): GeneratorOutput

    /** Dispose of any cached resources */
    dispose(): void
}
