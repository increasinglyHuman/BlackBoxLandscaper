/**
 * Grid distribution — regular spacing with jitter.
 *
 * Used for fences, lanterns, orchards, planted rows.
 * Ported from SpatialDistributor lines 515-533.
 */

import type { Region } from '../../types/index.js'
import { getRegionBounds, isPointInRegion, getRegionArea } from '../RegionHelper.js'

export interface GridOptions {
    region: Region
    spacing: number
    /** Maximum number of points to return (default: unlimited) */
    maxPoints?: number
    /** Jitter factor as fraction of spacing (default 0.2 = ±10%) */
    jitter?: number
    /** RNG for reproducibility (default Math.random) */
    rng?: () => number
}

/**
 * Generate grid-distributed points within a region.
 *
 * Regular grid at `spacing` intervals, each point offset by random jitter.
 * If maxPoints is specified, spacing is auto-increased to fit approximately
 * that many points in the region area.
 * Default jitter = 0.2 (same as SpatialDistributor).
 */
export function grid(options: GridOptions): Array<[number, number]> {
    const { region } = options
    const jitter = options.jitter ?? 0.2
    const rng = options.rng ?? Math.random
    const maxPoints = options.maxPoints ?? Infinity

    // If maxPoints is set, compute spacing to approximate that count
    let spacing = options.spacing
    if (maxPoints < Infinity) {
        const area = getRegionArea(region)
        const spacingFromCount = Math.sqrt(area / maxPoints)
        spacing = Math.max(spacing, spacingFromCount)
    }

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

    // Shuffle and cap to maxPoints
    if (points.length > maxPoints) {
        for (let i = points.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1))
            ;[points[i], points[j]] = [points[j], points[i]]
        }
        points.length = maxPoints
    }

    return points
}
