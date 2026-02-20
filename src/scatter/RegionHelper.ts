/**
 * RegionHelper — point-in-region tests and bounding box extraction.
 *
 * Pure functions, no class. Ported from SpatialDistributor lines 1296-1376.
 */

import type { Region } from '../types/index.js'

export interface Bounds {
    minX: number
    maxX: number
    minZ: number
    maxZ: number
}

/**
 * Get axis-aligned bounding box for any region type.
 * Used by scatter algorithms that need grid dimensions.
 */
export function getRegionBounds(region: Region): Bounds {
    switch (region.type) {
        case 'bounds':
            return {
                minX: region.minX!,
                maxX: region.maxX!,
                minZ: region.minZ!,
                maxZ: region.maxZ!,
            }

        case 'circle': {
            const cx = region.centerX!
            const cz = region.centerZ!
            const r = region.radius!
            return {
                minX: cx - r,
                maxX: cx + r,
                minZ: cz - r,
                maxZ: cz + r,
            }
        }

        case 'polygon': {
            const pts = region.points!
            let minX = Infinity, maxX = -Infinity
            let minZ = Infinity, maxZ = -Infinity
            for (const p of pts) {
                if (p.x < minX) minX = p.x
                if (p.x > maxX) maxX = p.x
                if (p.z < minZ) minZ = p.z
                if (p.z > maxZ) maxZ = p.z
            }
            return { minX, maxX, minZ, maxZ }
        }
    }
}

/**
 * Test if a 2D point (x, z) lies within a region.
 */
export function isPointInRegion(x: number, z: number, region: Region): boolean {
    switch (region.type) {
        case 'bounds':
            return x >= region.minX! && x <= region.maxX! &&
                   z >= region.minZ! && z <= region.maxZ!

        case 'circle': {
            const dx = x - region.centerX!
            const dz = z - region.centerZ!
            return dx * dx + dz * dz <= region.radius! * region.radius!
        }

        case 'polygon':
            return pointInPolygon(x, z, region.points!)
    }
}

/**
 * Point-in-polygon using ray-casting algorithm.
 * Cast ray from point along +X, count edge crossings.
 * Odd = inside, even = outside.
 *
 * Same algorithm as SpatialDistributor lines 1365-1376.
 */
export function pointInPolygon(
    x: number,
    z: number,
    polygon: Array<{ x: number; z: number }>
): boolean {
    let inside = false
    const n = polygon.length

    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygon[i].x, zi = polygon[i].z
        const xj = polygon[j].x, zj = polygon[j].z

        if ((zi > z) !== (zj > z) &&
            x < (xj - xi) * (z - zi) / (zj - zi) + xi) {
            inside = !inside
        }
    }

    return inside
}

/**
 * Get region area in square world units.
 * Used for cluster count estimation.
 */
export function getRegionArea(region: Region): number {
    switch (region.type) {
        case 'bounds': {
            const w = region.maxX! - region.minX!
            const d = region.maxZ! - region.minZ!
            return w * d
        }

        case 'circle':
            return Math.PI * region.radius! * region.radius!

        case 'polygon': {
            // Shoelace formula
            const pts = region.points!
            let area = 0
            const n = pts.length
            for (let i = 0, j = n - 1; i < n; j = i++) {
                area += (pts[j].x + pts[i].x) * (pts[j].z - pts[i].z)
            }
            return Math.abs(area / 2)
        }
    }
}
