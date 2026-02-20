/**
 * Constraint evaluation — filters candidate points based on
 * terrain properties and spatial exclusion zones.
 *
 * Ported from SpatialDistributor lines 542-587.
 * All constraints use AND logic — point must pass ALL constraints.
 */

import type { Constraint } from '../types/index.js'
import type { TerrainSampler } from './TerrainSampler.js'

/**
 * Filter an array of points, keeping only those that pass all constraints.
 */
export function applyConstraints(
    points: Array<[number, number]>,
    constraints: Constraint[],
    terrain: TerrainSampler
): Array<[number, number]> {
    if (constraints.length === 0) return points
    return points.filter(([x, z]) => checkConstraints(x, z, constraints, terrain))
}

/**
 * Test a single point against all constraints.
 * Returns true if the point passes ALL constraints.
 */
export function checkConstraints(
    x: number,
    z: number,
    constraints: Constraint[],
    terrain: TerrainSampler
): boolean {
    for (const constraint of constraints) {
        if (!checkSingleConstraint(x, z, constraint, terrain)) {
            return false
        }
    }
    return true
}

/**
 * Check a single constraint against a point.
 */
function checkSingleConstraint(
    x: number,
    z: number,
    constraint: Constraint,
    terrain: TerrainSampler
): boolean {
    switch (constraint.type) {
        case 'slope': {
            // Reject points on terrain steeper than maxDegrees
            const slope = terrain.getSlope(x, z)
            return slope <= (constraint.maxDegrees ?? 45)
        }

        case 'exclusion': {
            // Pass if point is OUTSIDE the exclusion zone
            if (!constraint.center || constraint.radius == null) return true
            const dx = x - constraint.center[0]
            const dz = z - constraint.center[1]
            return dx * dx + dz * dz > constraint.radius * constraint.radius
        }

        case 'height': {
            const height = terrain.getHeight(x, z)
            const min = constraint.minHeight ?? -Infinity
            const max = constraint.maxHeight ?? Infinity
            return height >= min && height <= max
        }

        case 'density_falloff':
            // Always passes here — handled by the density algorithm itself
            return true
    }
}
