/**
 * Poisson disk distribution — natural spacing with minimum distance guarantee.
 *
 * Wraps the npm `poisson-disk-sampling` package (Bridson's algorithm).
 * Used for trees, rocks, NPCs — anything that needs even natural spacing.
 */

import PoissonDiskSampling from 'poisson-disk-sampling'
import type { Region } from '../../types/index.js'
import { getRegionBounds, isPointInRegion } from '../RegionHelper.js'

export interface PoissonOptions {
    region: Region
    minDistance: number
    maxPoints: number
    /** RNG for reproducibility (default Math.random) */
    rng?: () => number
}

/**
 * Generate Poisson disk distributed points within a region.
 *
 * Points are generated in the region's bounding box using Bridson's
 * algorithm (30 attempts per candidate), then filtered to the actual
 * region shape (circle, polygon).
 *
 * @returns Array of [x, z] positions
 */
export function poissonDisk(options: PoissonOptions): Array<[number, number]> {
    const { region, minDistance, maxPoints } = options
    const rng = options.rng ?? Math.random

    const bounds = getRegionBounds(region)
    const width = bounds.maxX - bounds.minX
    const depth = bounds.maxZ - bounds.minZ

    const pds = new PoissonDiskSampling(
        {
            shape: [width, depth],
            minDistance,
            maxDistance: minDistance * 2,
            tries: 30,
        },
        rng
    )

    const raw: number[][] = pds.fill()

    // Transform from local [0, width] x [0, depth] to world coordinates
    // and filter to actual region shape
    const points: Array<[number, number]> = []
    for (const sample of raw) {
        if (points.length >= maxPoints) break

        const worldX = sample[0] + bounds.minX
        const worldZ = sample[1] + bounds.minZ

        if (isPointInRegion(worldX, worldZ, region)) {
            points.push([worldX, worldZ])
        }
    }

    return points
}
