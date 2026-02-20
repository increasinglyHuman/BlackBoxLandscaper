/**
 * BlackBox Landscaper — Core Types
 *
 * Layer-based scatter system types, ported from SpatialDistributor (Babylon.js)
 * and extended for procedural generation with Three.js.
 */

// ============================================================================
// DISTRIBUTION & SCATTER
// ============================================================================

export type DistributionAlgorithm = 'poisson' | 'clustered' | 'density' | 'grid'

export interface Region {
    type: 'bounds' | 'circle' | 'polygon'
    // Bounds
    minX?: number
    maxX?: number
    minZ?: number
    maxZ?: number
    // Circle
    centerX?: number
    centerZ?: number
    radius?: number
    // Polygon
    points?: Array<{ x: number; z: number }>
}

export interface InstanceType {
    /** Path to GLB file (for pre-made assets) */
    assetPath?: string
    /** Procedural generator ID (for generated meshes like ez-tree) */
    generator?: string
    /** Species ID for generator lookup */
    speciesId?: string
    /** Selection probability weight (0-1) */
    weight: number
    /** Random scale range */
    scaleMin?: number
    scaleMax?: number
    /** Random Y rotation (default true) */
    rotationRandomY?: boolean
    /** Vertical offset from terrain surface */
    yOffset?: number
}

export interface Constraint {
    type: 'slope' | 'exclusion' | 'height' | 'density_falloff'
    // Slope
    maxDegrees?: number
    // Exclusion zone
    center?: [number, number]
    radius?: number
    // Height
    minHeight?: number
    maxHeight?: number
    // Density falloff
    falloffCenter?: [number, number]
    falloffRadius?: number
}

export interface AnimationConfig {
    type: 'wind' | 'patrol' | 'particle' | 'boids'
    /** Wind strength (0-1) */
    windStrength?: number
    /** Wind direction (radians) */
    windDirection?: number
    /** Patrol waypoints (for NPCs) */
    waypoints?: Array<{ x: number; y: number; z: number }>
    /** Patrol loop? */
    loop?: boolean
}

// ============================================================================
// DECORATION LAYERS — The core abstraction
// ============================================================================

export interface DecorationLayer {
    /** Unique layer ID */
    id: string
    /** Human-readable name ("Ancient Ruins", "Campfires", "Gnome Patrol") */
    name: string
    /** Asset pool with probability weights */
    instanceTypes: InstanceType[]
    /** Distribution algorithm */
    algorithm: DistributionAlgorithm
    /** Target instance count */
    count: number
    /** Minimum spacing between instances */
    minDistance: number
    /** Placement constraints */
    constraints: Constraint[]
    /** Higher priority layers place first */
    priority: number
    /** Cross-layer exclusion ("don't place trees where ruins are") */
    excludesLayers?: string[]
    /** Animation config (wind, patrol AI, particles) */
    animate?: AnimationConfig
}

// ============================================================================
// SPECIES — Tree & vegetation species definitions
// ============================================================================

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export type GeneratorType = 'ez-tree' | 'palm' | 'bush' | 'fern' | 'billboard'

export interface SeasonalTint {
    spring: string | number | null
    summer: string | number | null
    autumn: string | number | null
    winter: string | number | null
}

export interface SpeciesDefinition {
    /** Unique species identifier */
    id: string
    /** Human-readable name */
    displayName: string
    /** OpenSim tree State ID (0-20) */
    opensimState: number
    /** Which generator to use */
    generator: GeneratorType
    /** Generator-specific parameters (ez-tree TreeOptions, etc.) */
    preset: Record<string, unknown>
    /** LOD distance thresholds [LOD0, LOD1, LOD2, LOD3] */
    lodDistances: [number, number, number, number]
    /** Billboard texture path for distant LOD */
    billboardTexture?: string
    /** Seasonal leaf tinting (hex colors, null = bare) */
    leafTint: SeasonalTint
    /** Which biomes this species belongs to */
    biomes: string[]
    /** Elevation range (meters) */
    minElevation: number
    maxElevation: number
    /** Preferred slope range (degrees) */
    preferredSlope: [number, number]
    /** Spacing constraints */
    spacing: { min: number; max: number }
}

// ============================================================================
// GENERATOR OUTPUT
// ============================================================================

export interface GeneratorOutput {
    /** The generated mesh/group */
    object: import('three').Object3D
    /** Triangle count for budgeting */
    triangleCount: number
    /** Bounding radius for culling */
    boundingRadius: number
}

// ============================================================================
// PLACED INSTANCES
// ============================================================================

export interface PlacedInstance {
    id: string
    speciesId: string
    position: { x: number; y: number; z: number }
    rotation: { x: number; y: number; z: number }
    scale: { x: number; y: number; z: number }
}

export interface DistributionManifest {
    id: string
    layerId: string
    instances: PlacedInstance[]
    algorithm: DistributionAlgorithm
    region: Region
    createdAt: Date
}
