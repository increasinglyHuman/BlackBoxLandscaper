/**
 * Grid distribution — regular spacing with jitter.
 *
 * Used for fences, lanterns, orchards, planted rows.
 * Ported from SpatialDistributor lines 515-533.
 */

import type { Region } from '../../types/index.js'
import { getRegionBounds, isPointInRegion } from '../RegionHelper.js'

export interface GridOptions {
    region: Region
    spacing: number
    /** Jitter factor as fraction of spacing (default 0.2 = ±10%) */
    jitter?: number
    /** RNG for reproducibility (default Math.random) */
    rng?: () => number
}

/**
 * Generate grid-distributed points within a region.
 *
 * Regular grid at `spacing` intervals, each point offset by random jitter.
 * Default jitter = 0.2 (same as SpatialDistributor).
 */
export function grid(options: GridOptions): Array<[number, number]> {
    const { region, spacing } = options
    const jitter = options.jitter ?? 0.2
    const rng = options.rng ?? Math.random

    const bounds = getRegionBounds(region)
    const points: Array<[number, number]> = []

    for (let x = bounds.minX; x <= bounds.maxX; x += spacing) {
        for (let z = bounds.minZ; z <= bounds.maxZ; z += spacing) {
            const jx = x + (rng() - 0.5) * spacing * jitter
            const jz = z + (rng() - 0.5) * spacing * jitter

            if (isPointInRegion(jx, jz, region)) {
                points.push([jx, jz])
            }
        }
    }

    return points
}
