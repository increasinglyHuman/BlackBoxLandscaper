import { describe, it, expect } from 'vitest'
import { ScatterSystem } from '../../src/scatter/ScatterSystem.js'
import { FlatTerrainSampler, ProceduralTerrainSampler } from '../../src/scatter/TerrainSampler.js'
import type { DecorationLayer, Region } from '../../src/types/index.js'

const region: Region = { type: 'bounds', minX: -50, maxX: 50, minZ: -50, maxZ: 50 }

function makeLayer(overrides: Partial<DecorationLayer> = {}): DecorationLayer {
    return {
        id: 'test',
        name: 'Test Layer',
        instanceTypes: [
            { speciesId: 'oak', weight: 1.0, scaleMin: 0.8, scaleMax: 1.2 },
        ],
        algorithm: 'poisson',
        count: 30,
        minDistance: 5,
        constraints: [],
        priority: 10,
        ...overrides,
    }
}

describe('ScatterSystem.scatter', () => {
    const scatter = new ScatterSystem()
    const terrain = new FlatTerrainSampler()

    it('produces PlacedInstance array', () => {
        const result = scatter.scatter(makeLayer(), { terrain, region, seed: 42 })
        expect(result.instances.length).toBeGreaterThan(0)
        expect(result.manifest.layerId).toBe('test')
    })

    it('instances have terrain height in y', () => {
        const hillTerrain = new FlatTerrainSampler(15)
        const result = scatter.scatter(makeLayer(), { terrain: hillTerrain, region, seed: 42 })
        for (const inst of result.instances) {
            expect(inst.position.y).toBe(15)
        }
    })

    it('instances have randomized scale within range', () => {
        const result = scatter.scatter(
            makeLayer({ instanceTypes: [{ speciesId: 'oak', weight: 1, scaleMin: 0.5, scaleMax: 2.0 }] }),
            { terrain, region, seed: 42 }
        )
        for (const inst of result.instances) {
            expect(inst.scale.x).toBeGreaterThanOrEqual(0.5)
            expect(inst.scale.x).toBeLessThanOrEqual(2.0)
            // Uniform scale
            expect(inst.scale.x).toBe(inst.scale.y)
            expect(inst.scale.x).toBe(inst.scale.z)
        }
    })

    it('respects slope constraints', () => {
        const terrain = new ProceduralTerrainSampler()
        const result = scatter.scatter(
            makeLayer({ constraints: [{ type: 'slope', maxDegrees: 0.1 }], count: 100 }),
            { terrain, region, seed: 42 }
        )
        // Very restrictive slope — should filter out many points
        expect(result.instances.length).toBeLessThan(100)
    })

    it('deterministic output with same seed', () => {
        const r1 = scatter.scatter(makeLayer(), { terrain, region, seed: 42 })
        const r2 = scatter.scatter(makeLayer(), { terrain, region, seed: 42 })
        expect(r1.instances.length).toBe(r2.instances.length)
        for (let i = 0; i < r1.instances.length; i++) {
            expect(r1.instances[i].position).toEqual(r2.instances[i].position)
        }
    })

    it('different seeds produce different results', () => {
        const r1 = scatter.scatter(makeLayer(), { terrain, region, seed: 42 })
        const r2 = scatter.scatter(makeLayer(), { terrain, region, seed: 999 })
        // Extremely unlikely to be identical
        expect(r1.instances[0]?.position).not.toEqual(r2.instances[0]?.position)
    })

    it('manifest has correct metadata', () => {
        const result = scatter.scatter(makeLayer({ algorithm: 'grid', minDistance: 10 }), {
            terrain,
            region,
            seed: 42,
        })
        expect(result.manifest.algorithm).toBe('grid')
        expect(result.manifest.region).toBe(region)
        expect(result.manifest.createdAt).toBeInstanceOf(Date)
    })
})

describe('ScatterSystem.scatterLayers', () => {
    const scatter = new ScatterSystem()
    const terrain = new FlatTerrainSampler()

    it('processes multiple layers', () => {
        const layers = [
            makeLayer({ id: 'trees', priority: 10, count: 20 }),
            makeLayer({ id: 'bushes', priority: 5, count: 30, minDistance: 3 }),
        ]
        const results = scatter.scatterLayers(layers, { terrain, region, seed: 42 })
        expect(results.has('trees')).toBe(true)
        expect(results.has('bushes')).toBe(true)
    })

    it('processes highest priority first', () => {
        // Can't easily test ordering directly, but we can test
        // cross-layer exclusion which depends on ordering
        const layers = [
            makeLayer({ id: 'ruins', priority: 15, count: 20, minDistance: 10 }),
            makeLayer({
                id: 'trees',
                priority: 5,
                count: 50,
                minDistance: 5,
                excludesLayers: ['ruins'],
            }),
        ]
        const results = scatter.scatterLayers(layers, { terrain, region, seed: 42 })

        // Trees should avoid ruin positions
        const ruinPositions = results.get('ruins')!.instances
        const treePositions = results.get('trees')!.instances

        for (const tree of treePositions) {
            for (const ruin of ruinPositions) {
                const dx = tree.position.x - ruin.position.x
                const dz = tree.position.z - ruin.position.z
                const dist = Math.sqrt(dx * dx + dz * dz)
                // Trees should be at least minDistance from ruins
                expect(dist).toBeGreaterThanOrEqual(4.9) // small tolerance
            }
        }
    })
})
