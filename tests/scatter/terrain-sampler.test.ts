import { describe, it, expect } from 'vitest'
import {
    FlatTerrainSampler,
    ProceduralTerrainSampler,
    HeightmapTerrainSampler,
} from '../../src/scatter/TerrainSampler.js'

describe('FlatTerrainSampler', () => {
    it('returns constant height', () => {
        const sampler = new FlatTerrainSampler(5)
        expect(sampler.getHeight(0, 0)).toBe(5)
        expect(sampler.getHeight(100, -50)).toBe(5)
    })

    it('defaults to height 0', () => {
        const sampler = new FlatTerrainSampler()
        expect(sampler.getHeight(10, 20)).toBe(0)
    })

    it('returns 0 slope everywhere', () => {
        const sampler = new FlatTerrainSampler(10)
        expect(sampler.getSlope(0, 0)).toBe(0)
        expect(sampler.getSlope(50, 50)).toBe(0)
    })
})

describe('ProceduralTerrainSampler', () => {
    const sampler = new ProceduralTerrainSampler()

    it('matches dev harness formula at origin', () => {
        // sin(0) * cos(0) * 1.5 = 0
        expect(sampler.getHeight(0, 0)).toBeCloseTo(0, 5)
    })

    it('matches dev harness formula at known point', () => {
        const x = 10, z = 5
        const expected = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 1.5
        expect(sampler.getHeight(x, z)).toBeCloseTo(expected, 10)
    })

    it('returns non-zero slope on non-flat terrain', () => {
        // At x=20 the sin curve has a gradient
        const slope = sampler.getSlope(20, 0)
        expect(slope).toBeGreaterThan(0)
        expect(slope).toBeLessThan(90)
    })

    it('returns near-zero slope at flat point', () => {
        // sin(0) and cos(0) have zero derivative
        const slope = sampler.getSlope(0, 0)
        expect(slope).toBeLessThan(5)
    })
})

describe('HeightmapTerrainSampler', () => {
    it('returns correct height at grid cell center', () => {
        // 4x4 heightmap, 4m region
        const data = new Float32Array(16)
        data[0] = 10 // (0,0)
        data[1] = 20 // (1,0)
        data[4] = 30 // (0,1)
        data[5] = 40 // (1,1)

        const sampler = new HeightmapTerrainSampler(data, 4, 4)
        expect(sampler.getHeight(0, 0)).toBeCloseTo(10, 2)
    })

    it('interpolates between grid cells', () => {
        const data = new Float32Array(4)
        data[0] = 0   // (0,0)
        data[1] = 10  // (1,0)
        data[2] = 0   // (0,1)
        data[3] = 10  // (1,1)

        const sampler = new HeightmapTerrainSampler(data, 2, 2)
        // Midpoint in x should be ~5
        const mid = sampler.getHeight(0.5, 0)
        expect(mid).toBeCloseTo(5, 1)
    })
})
