/**
 * BlackBox Landscaper — Public API
 *
 * Procedural world population for Three.js.
 * Trees, rocks, NPCs, particles, and general object decoration.
 */

// Core types
export type {
    DistributionAlgorithm,
    Region,
    InstanceType,
    Constraint,
    AnimationConfig,
    DecorationLayer,
    Season,
    GeneratorType,
    SeasonalTint,
    SpeciesDefinition,
    GeneratorOutput,
    PlacedInstance,
    DistributionManifest,
} from './types/index.js'

// Generator interface
export type { MeshGenerator } from './generators/types.js'

// Species registry
export { SpeciesRegistry } from './species/registry.js'

// Generators
export { EzTreeAdapter } from './generators/EzTreeAdapter.js'
export { BillboardGenerator } from './generators/BillboardGenerator.js'
export { RockGenerator } from './generators/RockGenerator.js'
export { PalmGenerator } from './generators/PalmGenerator.js'
export { FernGenerator } from './generators/FernGenerator.js'
export { GrassGenerator } from './generators/GrassGenerator.js'
export { KelpGenerator } from './generators/KelpGenerator.js'

// Rendering
export { LODBuilder } from './rendering/LODBuilder.js'
export { InstancePool } from './rendering/InstancePool.js'
export { ScenePopulator } from './rendering/ScenePopulator.js'
export type { PopulatorConfig, PopulateResult } from './rendering/ScenePopulator.js'

// Scatter system
export { ScatterSystem } from './scatter/ScatterSystem.js'
export type { ScatterOptions, ScatterResult } from './scatter/ScatterSystem.js'

// Terrain sampling
export type { TerrainSampler } from './scatter/TerrainSampler.js'
export {
    FlatTerrainSampler,
    ProceduralTerrainSampler,
    HeightmapTerrainSampler,
} from './scatter/TerrainSampler.js'

// Region utilities
export {
    getRegionBounds,
    isPointInRegion,
    getRegionArea,
} from './scatter/RegionHelper.js'
export type { Bounds } from './scatter/RegionHelper.js'

// Algorithms (for advanced usage / custom pipelines)
export { poissonDisk } from './scatter/algorithms/poisson.js'
export { clustered } from './scatter/algorithms/clustered.js'
export { densityFunction } from './scatter/algorithms/density.js'
export { grid } from './scatter/algorithms/grid.js'

// Constraint evaluation
export { applyConstraints, checkConstraints } from './scatter/constraints.js'
