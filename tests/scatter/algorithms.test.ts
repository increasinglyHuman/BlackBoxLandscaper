import { describe, it, expect } from 'vitest'
import { poissonDisk } from '../../src/scatter/algorithms/poisson.js'
import { clustered } from '../../src/scatter/algorithms/clustered.js'
import { densityFunction } from '../../src/scatter/algorithms/density.js'
import { grid } from '../../src/scatter/algorithms/grid.js'
import type { Region } from '../../src/types/index.js'

const boundsRegion: Region = { type: 'bounds', minX: -50, maxX: 50, minZ: -50, maxZ: 50 }

// Simple seeded RNG for reproducibility
function makeRng(seed: number): () => number {
    let t = seed | 0
    return () => {
        t = (t + 0x6D2B79F5) | 0
        let v = t
        v = Math.imul(v ^ (v >>> 15), v | 1)
        v ^= v + Math.imul(v ^ (v >>> 7), v | 61)
        return ((v ^ (v >>> 14)) >>> 0) / 4294967296
    }
}

// ============================================================================
// POISSON DISK
// ============================================================================

describe('poissonDisk', () => {
    it('generates points within region', () => {
        const points = poissonDisk({ region: boundsRegion, minDistance: 5, maxPoints: 50, rng: makeRng(42) })
        expect(points.length).toBeGreaterThan(0)
        for (const [x, z] of points) {
            expect(x).toBeGreaterThanOrEqual(-50)
            expect(x).toBeLessThanOrEqual(50)
            expect(z).toBeGreaterThanOrEqual(-50)
            expect(z).toBeLessThanOrEqual(50)
        }
    })

    it('enforces minimum distance between points', () => {
        const minDist = 8
        const points = poissonDisk({ region: boundsRegion, minDistance: minDist, maxPoints: 100, rng: makeRng(42) })

        for (let i = 0; i < points.length; i++) {
            for (let j = i + 1; j < points.length; j++) {
                const dx = points[i][0] - points[j][0]
                const dz = points[i][1] - points[j][1]
                const dist = Math.sqrt(dx * dx + dz * dz)
                expect(dist).toBeGreaterThanOrEqual(minDist * 0.99) // small tolerance
            }
        }
    })

    it('respects maxPoints limit', () => {
        const points = poissonDisk({ region: boundsRegion, minDistance: 3, maxPoints: 20, rng: makeRng(42) })
        expect(points.length).toBeLessThanOrEqual(20)
    })

    it('is deterministic with same seed', () => {
        const p1 = poissonDisk({ region: boundsRegion, minDistance: 5, maxPoints: 30, rng: makeRng(42) })
        const p2 = poissonDisk({ region: boundsRegion, minDistance: 5, maxPoints: 30, rng: makeRng(42) })
        expect(p1).toEqual(p2)
    })

    it('works with circular region', () => {
        const circle: Region = { type: 'circle', centerX: 0, centerZ: 0, radius: 20 }
        const points = poissonDisk({ region: circle, minDistance: 5, maxPoints: 50, rng: makeRng(42) })
        for (const [x, z] of points) {
            expect(x * x + z * z).toBeLessThanOrEqual(20 * 20 + 1) // small tolerance
        }
    })
})

// ============================================================================
// CLUSTERED
// ============================================================================

describe('clustered', () => {
    it('generates approximately totalCount points', () => {
        const points = clustered({ region: boundsRegion, totalCount: 100, rng: makeRng(42) })
        // Clustered won't always hit exact count (some might fall outside)
        expect(points.length).toBeGreaterThan(50)
        expect(points.length).toBeLessThanOrEqual(100)
    })

    it('all points within region', () => {
        const points = clustered({ region: boundsRegion, totalCount: 80, rng: makeRng(42) })
        for (const [x, z] of points) {
            expect(x).toBeGreaterThanOrEqual(-50)
            expect(x).toBeLessThanOrEqual(50)
            expect(z).toBeGreaterThanOrEqual(-50)
            expect(z).toBeLessThanOrEqual(50)
        }
    })

    it('is deterministic with same seed', () => {
        const p1 = clustered({ region: boundsRegion, totalCount: 50, rng: makeRng(42) })
        const p2 = clustered({ region: boundsRegion, totalCount: 50, rng: makeRng(42) })
        expect(p1).toEqual(p2)
    })
})

// ============================================================================
// DENSITY
// ============================================================================

describe('densityFunction', () => {
    it('generates points up to target count', () => {
        const points = densityFunction({
            region: boundsRegion,
            targetCount: 50,
            rng: makeRng(42),
        })
        expect(points.length).toBeLessThanOrEqual(50)
        expect(points.length).toBeGreaterThan(0)
    })

    it('denser near falloff center', () => {
        const points = densityFunction({
            region: boundsRegion,
            targetCount: 200,
            constraints: [
                { type: 'density_falloff', falloffCenter: [0, 0], falloffRadius: 50 },
            ],
            rng: makeRng(42),
        })

        // Count points within 20 units vs outside 20 units
        let innerCount = 0
        let outerCount = 0
        for (const [x, z] of points) {
            const dist = Math.sqrt(x * x + z * z)
            if (dist < 20) innerCount++
            else outerCount++
        }

        // Inner area is ~1256 sq units, outer is ~8744 sq units
        // But density is higher near center, so inner should have more per-area
        const innerDensity = innerCount / (Math.PI * 20 * 20)
        const outerDensity = outerCount / (Math.PI * 50 * 50 - Math.PI * 20 * 20)
        expect(innerDensity).toBeGreaterThan(outerDensity)
    })
})

// ============================================================================
// GRID
// ============================================================================

describe('grid', () => {
    it('generates points at approximate grid spacing', () => {
        const spacing = 10
        const points = grid({ region: boundsRegion, spacing, rng: makeRng(42) })

        expect(points.length).toBeGreaterThan(0)
        // Should be approximately (100/10)^2 = 100 points
        expect(points.length).toBeGreaterThan(50)
        expect(points.length).toBeLessThan(200)
    })

    it('all points within region', () => {
        const points = grid({ region: boundsRegion, spacing: 10, rng: makeRng(42) })
        for (const [x, z] of points) {
            // Allow jitter overshoot by a small margin
            expect(x).toBeGreaterThanOrEqual(-51)
            expect(x).toBeLessThanOrEqual(51)
            expect(z).toBeGreaterThanOrEqual(-51)
            expect(z).toBeLessThanOrEqual(51)
        }
    })

    it('jitter keeps points near grid positions', () => {
        const spacing = 20
        const points = grid({ region: boundsRegion, spacing, jitter: 0.2, rng: makeRng(42) })

        // Max jitter offset is spacing * 0.2 / 2 = 2
        for (const [x, z] of points) {
            const nearestGridX = Math.round((x + 50) / spacing) * spacing - 50
            const nearestGridZ = Math.round((z + 50) / spacing) * spacing - 50
            expect(Math.abs(x - nearestGridX)).toBeLessThanOrEqual(spacing * 0.2)
            expect(Math.abs(z - nearestGridZ)).toBeLessThanOrEqual(spacing * 0.2)
        }
    })

    it('is deterministic with same seed', () => {
        const p1 = grid({ region: boundsRegion, spacing: 10, rng: makeRng(42) })
        const p2 = grid({ region: boundsRegion, spacing: 10, rng: makeRng(42) })
        expect(p1).toEqual(p2)
    })
})
