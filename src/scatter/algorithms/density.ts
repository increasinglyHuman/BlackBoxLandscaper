/**
 * Density function distribution — variable density with falloff.
 *
 * Places more objects near a center, thinning out toward edges.
 * Used for grass near water, flowers around a path, etc.
 * Ported from SpatialDistributor lines 480-510.
 */

import type { Region, Constraint } from '../../types/index.js'
import { poissonDisk } from './poisson.js'

export interface DensityOptions {
    region: Region
    targetCount: number
    /** Minimum distance between points (default 3) */
    minDistance?: number
    /** Constraints array — looks for density_falloff specifically */
    constraints?: Constraint[]
    /** RNG for reproducibility (default Math.random) */
    rng?: () => number
}

/**
 * Density function distribution.
 *
 * Algorithm (from SpatialDistributor lines 480-509):
 * 1. Oversample using Poisson at 3x target count with tight spacing (minDistance=3)
 * 2. For each candidate, compute density probability (0-1) based on
 *    distance from falloff center using linear falloff
 * 3. Accept point with probability = density value (Monte Carlo)
 *
 * If no density_falloff constraint is present, acts like Poisson
 * with the oversample/filter pattern (returns a random subset).
 */
export function densityFunction(options: DensityOptions): Array<[number, number]> {
    const { region, targetCount } = options
    const constraints = options.constraints ?? []
    const rng = options.rng ?? Math.random

    // Find the density_falloff constraint (if any)
    const falloff = constraints.find(c => c.type === 'density_falloff')

    // Oversample at 3x using the layer's min distance for proper spacing
    const minDist = options.minDistance ?? 3
    const candidates = poissonDisk({
        region,
        minDistance: minDist,
        maxPoints: targetCount * 3,
        rng,
    })

    const points: Array<[number, number]> = []

    for (const [x, z] of candidates) {
        if (points.length >= targetCount) break

        if (falloff && falloff.falloffCenter && falloff.falloffRadius) {
            // Linear density falloff from center
            const dx = x - falloff.falloffCenter[0]
            const dz = z - falloff.falloffCenter[1]
            const dist = Math.sqrt(dx * dx + dz * dz)
            const density = Math.max(0, 1 - dist / falloff.falloffRadius)

            // Probabilistic acceptance (Monte Carlo)
            if (rng() < density) {
                points.push([x, z])
            }
        } else {
            // No falloff — accept all (Poisson subset)
            points.push([x, z])
        }
    }

    return points
}
