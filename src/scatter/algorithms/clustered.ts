/**
 * Clustered distribution — grouped objects with Gaussian spread.
 *
 * Used for tree groves, ruins, market stalls, flower patches.
 * Ported from SpatialDistributor lines 413-475.
 */

import type { Region } from '../../types/index.js'
import { getRegionBounds, getRegionArea, isPointInRegion } from '../RegionHelper.js'

export interface ClusteredOptions {
    region: Region
    totalCount: number
    /** RNG for reproducibility (default Math.random) */
    rng?: () => number
}

/** Odd cluster sizes for natural appearance (from SpatialDistributor) */
const ODD_CLUSTER_SIZES = [3, 5, 7, 9, 11, 13, 17, 21]

/**
 * Generate clustered distribution — groups of objects with Gaussian spread.
 *
 * Algorithm (from SpatialDistributor):
 * 1. Estimate cluster count from region area (20-80 clusters)
 * 2. Place cluster centers randomly within region
 * 3. For each cluster, pick random odd-numbered size
 * 4. Place members around center using Box-Muller Gaussian transform
 *
 * @returns Array of [x, z] positions
 */
export function clustered(options: ClusteredOptions): Array<[number, number]> {
    const { region, totalCount } = options
    const rng = options.rng ?? Math.random

    const bounds = getRegionBounds(region)
    const area = getRegionArea(region)

    // Estimate cluster count (SpatialDistributor line 425)
    const clusterCount = Math.max(20, Math.min(80, Math.floor(totalCount / 15)))
    const baseClusterRadius = Math.sqrt(area / clusterCount) * 0.5

    const points: Array<[number, number]> = []
    let remaining = totalCount

    for (let c = 0; c < clusterCount && remaining > 0; c++) {
        // Random cluster center within region
        let cx: number, cz: number
        let attempts = 0
        do {
            cx = bounds.minX + rng() * (bounds.maxX - bounds.minX)
            cz = bounds.minZ + rng() * (bounds.maxZ - bounds.minZ)
            attempts++
        } while (!isPointInRegion(cx, cz, region) && attempts < 100)

        if (attempts >= 100) continue

        // Pick random odd cluster size
        const clusterSize = Math.min(
            remaining,
            ODD_CLUSTER_SIZES[Math.floor(rng() * ODD_CLUSTER_SIZES.length)]
        )

        // Per-cluster radius variation (0.5x to 1.5x base)
        const clusterRadius = baseClusterRadius * (0.5 + rng() * 1.0)

        // Place members around center with Gaussian spread
        for (let i = 0; i < clusterSize; i++) {
            const dist = Math.abs(gaussianRandom(rng)) * clusterRadius
            const angle = rng() * Math.PI * 2

            const px = cx + Math.cos(angle) * dist
            const pz = cz + Math.sin(angle) * dist

            if (isPointInRegion(px, pz, region)) {
                points.push([px, pz])
                remaining--
            }
        }
    }

    return points
}

/**
 * Box-Muller transform for Gaussian random numbers.
 * Produces normally-distributed values centered at 0.
 * Same as SpatialDistributor's gaussianRandom().
 */
function gaussianRandom(rng: () => number): number {
    let u = 0, v = 0
    while (u === 0) u = rng()
    while (v === 0) v = rng()
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}
