/**
 * ScatterSystem — main orchestrator for the distribution pipeline.
 *
 * Takes DecorationLayer configs, a terrain sampler, and a region.
 * Produces PlacedInstance arrays and DistributionManifest objects.
 * Pure math — no Three.js dependency.
 *
 * Pipeline per layer:
 *   1. Generate candidate 2D points using selected algorithm
 *   2. Apply cross-layer exclusion zones (from higher-priority layers)
 *   3. Apply per-layer constraints (slope, height, exclusion)
 *   4. Sample terrain height for each surviving point
 *   5. Select instance type per point (weighted random)
 *   6. Randomize scale and rotation
 *   7. Produce PlacedInstance[]
 */

import type {
    DecorationLayer,
    Region,
    PlacedInstance,
    DistributionManifest,
    DistributionAlgorithm,
    Constraint,
    InstanceType,
} from '../types/index.js'
import type { TerrainSampler } from './TerrainSampler.js'
import { poissonDisk } from './algorithms/poisson.js'
import { clustered } from './algorithms/clustered.js'
import { densityFunction } from './algorithms/density.js'
import { grid } from './algorithms/grid.js'
import { applyConstraints } from './constraints.js'

export interface ScatterOptions {
    /** Terrain height/slope sampler */
    terrain: TerrainSampler
    /** Region to scatter within */
    region: Region
    /** Seed for reproducible results */
    seed?: number
}

export interface ScatterResult {
    /** The placed instances for this layer */
    instances: PlacedInstance[]
    /** Full manifest with metadata */
    manifest: DistributionManifest
}

export class ScatterSystem {

    /**
     * Scatter a single layer. Returns placed instances.
     * Does NOT handle cross-layer exclusion (caller manages that,
     * or use scatterLayers() which handles it automatically).
     */
    scatter(layer: DecorationLayer, options: ScatterOptions): ScatterResult {
        const rng = this.createRng(options.seed ?? Math.floor(Math.random() * 100000))
        const region = options.region

        // 1. Generate candidate 2D points
        const candidates = this.generatePoints(
            layer.algorithm,
            region,
            layer.count,
            layer.minDistance,
            layer.constraints,
            rng
        )

        // 2. Apply constraints (slope, height, exclusion)
        const filtered = applyConstraints(candidates, layer.constraints, options.terrain)

        // 3-6. Build placed instances
        const instances = this.buildInstances(
            filtered,
            layer,
            options.terrain,
            rng
        )

        // 7. Build manifest
        const manifest: DistributionManifest = {
            id: this.generateId(rng),
            layerId: layer.id,
            instances,
            algorithm: layer.algorithm,
            region,
            createdAt: new Date(),
        }

        return { instances, manifest }
    }

    /**
     * Scatter multiple layers in priority order with cross-layer exclusion.
     *
     * Process:
     *   1. Sort layers by priority (highest first)
     *   2. For each layer: generate → exclude → constrain → build
     *   3. Placed points from each layer become exclusion zones
     *      for subsequent layers listed in excludesLayers[]
     */
    scatterLayers(
        layers: DecorationLayer[],
        options: ScatterOptions
    ): Map<string, ScatterResult> {
        // Sort by priority descending (highest places first)
        const sorted = [...layers].sort((a, b) => b.priority - a.priority)

        const results = new Map<string, ScatterResult>()
        const placedPointsByLayer = new Map<string, Array<[number, number]>>()

        for (const layer of sorted) {
            const rng = this.createRng(
                (options.seed ?? Math.floor(Math.random() * 100000)) + this.hashString(layer.id)
            )
            const region = options.region

            // 1. Generate candidate 2D points
            let candidates = this.generatePoints(
                layer.algorithm,
                region,
                layer.count,
                layer.minDistance,
                layer.constraints,
                rng
            )

            // 2. Cross-layer exclusion
            if (layer.excludesLayers && layer.excludesLayers.length > 0) {
                candidates = this.applyCrossLayerExclusion(
                    candidates,
                    layer.excludesLayers,
                    placedPointsByLayer,
                    layer.minDistance
                )
            }

            // 3. Per-layer constraints
            const filtered = applyConstraints(candidates, layer.constraints, options.terrain)

            // 4-6. Build placed instances
            const instances = this.buildInstances(filtered, layer, options.terrain, rng)

            // Store placed points for subsequent layers
            placedPointsByLayer.set(layer.id, filtered)

            // 7. Build manifest
            const manifest: DistributionManifest = {
                id: this.generateId(rng),
                layerId: layer.id,
                instances,
                algorithm: layer.algorithm,
                region,
                createdAt: new Date(),
            }

            results.set(layer.id, { instances, manifest })
        }

        return results
    }

    /**
     * Generate candidate 2D points using the specified algorithm.
     */
    private generatePoints(
        algorithm: DistributionAlgorithm,
        region: Region,
        count: number,
        minDistance: number,
        constraints?: Constraint[],
        rng?: () => number
    ): Array<[number, number]> {
        switch (algorithm) {
            case 'poisson':
                return poissonDisk({ region, minDistance, maxPoints: count, rng })

            case 'clustered':
                return clustered({ region, totalCount: count, rng })

            case 'density':
                return densityFunction({ region, targetCount: count, minDistance, constraints, rng })

            case 'grid':
                return grid({ region, spacing: minDistance, maxPoints: count, rng })
        }
    }

    /**
     * Build PlacedInstance array from filtered 2D points.
     * Samples terrain height, selects instance type, randomizes transform.
     */
    private buildInstances(
        points: Array<[number, number]>,
        layer: DecorationLayer,
        terrain: TerrainSampler,
        rng: () => number
    ): PlacedInstance[] {
        return points.map(([x, z]) => {
            const y = terrain.getHeight(x, z)
            const type = this.selectInstanceType(layer.instanceTypes, rng)

            // Scale randomization
            const scaleMin = type.scaleMin ?? 0.8
            const scaleMax = type.scaleMax ?? 1.2
            const scale = scaleMin + rng() * (scaleMax - scaleMin)

            // Rotation
            const rotY = (type.rotationRandomY !== false) ? rng() * Math.PI * 2 : 0

            // Y offset
            const yOffset = type.yOffset ?? 0

            return {
                id: this.generateId(rng),
                speciesId: type.speciesId ?? type.generator ?? 'unknown',
                position: { x, y: y + yOffset, z },
                rotation: { x: 0, y: rotY, z: 0 },
                scale: { x: scale, y: scale, z: scale },
            }
        })
    }

    /**
     * Select an instance type based on probability weights.
     * Same weighted-random algorithm as SpatialDistributor.
     */
    private selectInstanceType(types: InstanceType[], rng: () => number): InstanceType {
        if (types.length === 1) return types[0]

        const totalWeight = types.reduce((sum, t) => sum + t.weight, 0)
        let roll = rng() * totalWeight

        for (const type of types) {
            roll -= type.weight
            if (roll <= 0) return type
        }

        return types[types.length - 1]
    }

    /**
     * Apply cross-layer exclusion: remove candidate points that are
     * within minDistance of any point from excluded layers.
     *
     * Uses a spatial hash grid (cell = minDistance) for O(n) average lookups.
     */
    private applyCrossLayerExclusion(
        candidates: Array<[number, number]>,
        excludedLayerIds: string[],
        placedPointsByLayer: Map<string, Array<[number, number]>>,
        minDistance: number
    ): Array<[number, number]> {
        // Collect all exclusion points
        const exclusionPoints: Array<[number, number]> = []
        for (const layerId of excludedLayerIds) {
            const points = placedPointsByLayer.get(layerId)
            if (points) exclusionPoints.push(...points)
        }

        if (exclusionPoints.length === 0) return candidates

        // Build spatial hash
        const cellSize = minDistance
        const grid = new Map<string, Array<[number, number]>>()

        for (const [x, z] of exclusionPoints) {
            const key = `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`
            let cell = grid.get(key)
            if (!cell) {
                cell = []
                grid.set(key, cell)
            }
            cell.push([x, z])
        }

        // Filter candidates
        const minDistSq = minDistance * minDistance

        return candidates.filter(([cx, cz]) => {
            const gx = Math.floor(cx / cellSize)
            const gz = Math.floor(cz / cellSize)

            // Check 3x3 neighborhood
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const cell = grid.get(`${gx + dx},${gz + dz}`)
                    if (!cell) continue

                    for (const [px, pz] of cell) {
                        const ddx = cx - px
                        const ddz = cz - pz
                        if (ddx * ddx + ddz * ddz < minDistSq) {
                            return false
                        }
                    }
                }
            }

            return true
        })
    }

    /**
     * Mulberry32 seeded PRNG.
     * Produces deterministic () => number from a seed.
     */
    private createRng(seed: number): () => number {
        let t = seed | 0
        return () => {
            t = (t + 0x6D2B79F5) | 0
            let v = t
            v = Math.imul(v ^ (v >>> 15), v | 1)
            v ^= v + Math.imul(v ^ (v >>> 7), v | 61)
            return ((v ^ (v >>> 14)) >>> 0) / 4294967296
        }
    }

    /** Generate a simple unique ID */
    private generateId(rng: () => number): string {
        return Math.floor(rng() * 0xFFFFFFFF).toString(16).padStart(8, '0')
    }

    /** Simple string hash for deterministic per-layer seed offset */
    private hashString(str: string): number {
        let hash = 0
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i)
            hash |= 0
        }
        return hash
    }
}
