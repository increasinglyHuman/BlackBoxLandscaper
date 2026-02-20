import { describe, it, expect } from 'vitest'
import { checkConstraints, applyConstraints } from '../../src/scatter/constraints.js'
import { FlatTerrainSampler, ProceduralTerrainSampler } from '../../src/scatter/TerrainSampler.js'
import type { Constraint } from '../../src/types/index.js'

describe('checkConstraints', () => {
    const flatTerrain = new FlatTerrainSampler(10)

    it('slope: accepts flat terrain', () => {
        const c: Constraint[] = [{ type: 'slope', maxDegrees: 30 }]
        expect(checkConstraints(0, 0, c, flatTerrain)).toBe(true)
    })

    it('slope: rejects steep terrain', () => {
        // ProceduralTerrainSampler has some slope
        const c: Constraint[] = [{ type: 'slope', maxDegrees: 0.001 }]
        const terrain = new ProceduralTerrainSampler()
        // At x=20 there's a noticeable gradient
        expect(checkConstraints(20, 0, c, terrain)).toBe(false)
    })

    it('exclusion: rejects points inside radius', () => {
        const c: Constraint[] = [{ type: 'exclusion', center: [0, 0], radius: 10 }]
        expect(checkConstraints(5, 5, c, flatTerrain)).toBe(false)
    })

    it('exclusion: accepts points outside radius', () => {
        const c: Constraint[] = [{ type: 'exclusion', center: [0, 0], radius: 10 }]
        expect(checkConstraints(15, 15, c, flatTerrain)).toBe(true)
    })

    it('height: accepts within range', () => {
        const c: Constraint[] = [{ type: 'height', minHeight: 5, maxHeight: 15 }]
        expect(checkConstraints(0, 0, c, flatTerrain)).toBe(true) // height = 10
    })

    it('height: rejects below minimum', () => {
        const c: Constraint[] = [{ type: 'height', minHeight: 20, maxHeight: 30 }]
        expect(checkConstraints(0, 0, c, flatTerrain)).toBe(false) // height = 10
    })

    it('height: rejects above maximum', () => {
        const c: Constraint[] = [{ type: 'height', minHeight: 0, maxHeight: 5 }]
        expect(checkConstraints(0, 0, c, flatTerrain)).toBe(false) // height = 10
    })

    it('density_falloff: always passes', () => {
        const c: Constraint[] = [
            { type: 'density_falloff', falloffCenter: [0, 0], falloffRadius: 10 },
        ]
        expect(checkConstraints(100, 100, c, flatTerrain)).toBe(true)
    })

    it('multiple constraints: all must pass (AND logic)', () => {
        const c: Constraint[] = [
            { type: 'height', minHeight: 5, maxHeight: 15 },
            { type: 'exclusion', center: [0, 0], radius: 5 },
        ]
        // height passes (10), but exclusion fails (point at 3,3 is inside radius 5)
        expect(checkConstraints(3, 3, c, flatTerrain)).toBe(false)
    })
})

describe('applyConstraints', () => {
    it('filters points correctly', () => {
        const terrain = new FlatTerrainSampler(10)
        const points: Array<[number, number]> = [
            [1, 1],   // inside exclusion zone
            [20, 20], // outside exclusion zone
            [3, 3],   // inside exclusion zone
            [30, 30], // outside exclusion zone
        ]
        const constraints: Constraint[] = [
            { type: 'exclusion', center: [0, 0], radius: 10 },
        ]

        const filtered = applyConstraints(points, constraints, terrain)
        expect(filtered).toEqual([[20, 20], [30, 30]])
    })

    it('returns all points when no constraints', () => {
        const terrain = new FlatTerrainSampler()
        const points: Array<[number, number]> = [[1, 1], [2, 2]]
        expect(applyConstraints(points, [], terrain)).toEqual(points)
    })
})
