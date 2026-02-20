import { describe, it, expect } from 'vitest'
import {
    getRegionBounds,
    isPointInRegion,
    pointInPolygon,
    getRegionArea,
} from '../../src/scatter/RegionHelper.js'

describe('getRegionBounds', () => {
    it('returns exact bounds for bounds region', () => {
        const b = getRegionBounds({ type: 'bounds', minX: -10, maxX: 10, minZ: -20, maxZ: 20 })
        expect(b).toEqual({ minX: -10, maxX: 10, minZ: -20, maxZ: 20 })
    })

    it('returns correct AABB for circle region', () => {
        const b = getRegionBounds({ type: 'circle', centerX: 5, centerZ: 5, radius: 10 })
        expect(b).toEqual({ minX: -5, maxX: 15, minZ: -5, maxZ: 15 })
    })

    it('computes bounding box for polygon region', () => {
        const b = getRegionBounds({
            type: 'polygon',
            points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 5, z: 8 }],
        })
        expect(b.minX).toBe(0)
        expect(b.maxX).toBe(10)
        expect(b.minZ).toBe(0)
        expect(b.maxZ).toBe(8)
    })
})

describe('isPointInRegion', () => {
    it('bounds: inside returns true', () => {
        const region = { type: 'bounds' as const, minX: 0, maxX: 10, minZ: 0, maxZ: 10 }
        expect(isPointInRegion(5, 5, region)).toBe(true)
    })

    it('bounds: outside returns false', () => {
        const region = { type: 'bounds' as const, minX: 0, maxX: 10, minZ: 0, maxZ: 10 }
        expect(isPointInRegion(15, 5, region)).toBe(false)
    })

    it('circle: center is inside', () => {
        const region = { type: 'circle' as const, centerX: 0, centerZ: 0, radius: 10 }
        expect(isPointInRegion(0, 0, region)).toBe(true)
    })

    it('circle: beyond radius is outside', () => {
        const region = { type: 'circle' as const, centerX: 0, centerZ: 0, radius: 10 }
        expect(isPointInRegion(11, 0, region)).toBe(false)
    })

    it('polygon: inside returns true', () => {
        const region = {
            type: 'polygon' as const,
            points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }],
        }
        expect(isPointInRegion(5, 5, region)).toBe(true)
    })

    it('polygon: outside returns false', () => {
        const region = {
            type: 'polygon' as const,
            points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }],
        }
        expect(isPointInRegion(15, 5, region)).toBe(false)
    })
})

describe('pointInPolygon', () => {
    const triangle = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 5, z: 10 }]

    it('center of triangle is inside', () => {
        expect(pointInPolygon(5, 3, triangle)).toBe(true)
    })

    it('far outside is outside', () => {
        expect(pointInPolygon(20, 20, triangle)).toBe(false)
    })
})

describe('getRegionArea', () => {
    it('bounds: returns width * depth', () => {
        expect(getRegionArea({ type: 'bounds', minX: 0, maxX: 10, minZ: 0, maxZ: 20 })).toBe(200)
    })

    it('circle: returns pi * r^2', () => {
        const area = getRegionArea({ type: 'circle', centerX: 0, centerZ: 0, radius: 10 })
        expect(area).toBeCloseTo(Math.PI * 100, 5)
    })

    it('polygon: square returns correct area', () => {
        const area = getRegionArea({
            type: 'polygon',
            points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }],
        })
        expect(area).toBeCloseTo(100, 1)
    })
})
