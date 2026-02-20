import { describe, it, expect } from 'vitest'
import { SpeciesRegistry } from '../../src/species/registry.js'

describe('SpeciesRegistry', () => {
    const registry = new SpeciesRegistry()

    it('loads all 21 OpenSim species on construction', () => {
        expect(registry.count).toBe(21)
    })

    it('looks up species by string ID', () => {
        const oak = registry.getById('oak')
        expect(oak).toBeDefined()
        expect(oak!.displayName).toBe('Oak')
        expect(oak!.generator).toBe('ez-tree')
    })

    it('looks up species by OpenSim State integer', () => {
        const pine = registry.getByState(0)
        expect(pine).toBeDefined()
        expect(pine!.id).toBe('pine_1')
        expect(pine!.opensimState).toBe(0)
    })

    it('returns undefined for unknown IDs', () => {
        expect(registry.getById('nonexistent')).toBeUndefined()
        expect(registry.getByState(99)).toBeUndefined()
    })

    it('maps all 21 State IDs (0-20)', () => {
        for (let state = 0; state <= 20; state++) {
            const species = registry.getByState(state)
            expect(species, `Missing species for State ${state}`).toBeDefined()
            expect(species!.opensimState).toBe(state)
        }
    })

    it('filters by generator type', () => {
        const ezTreeSpecies = registry.getByGenerator('ez-tree')
        expect(ezTreeSpecies.length).toBeGreaterThan(10)
        expect(ezTreeSpecies.every(s => s.generator === 'ez-tree')).toBe(true)

        const billboardSpecies = registry.getByGenerator('billboard')
        expect(billboardSpecies.length).toBe(5) // kelp, eelgrass, sea_sword, beach_grass, kelp_2
    })

    it('filters by biome', () => {
        const tropical = registry.getByBiome('tropical')
        expect(tropical.length).toBeGreaterThan(0)
        expect(tropical.every(s => s.biomes.includes('tropical'))).toBe(true)
    })

    it('all species have valid LOD distances', () => {
        for (const species of registry.getAll()) {
            expect(species.lodDistances).toHaveLength(4)
            // Distances should be monotonically increasing
            for (let i = 1; i < 4; i++) {
                expect(
                    species.lodDistances[i],
                    `${species.id}: LOD ${i} should be > LOD ${i - 1}`
                ).toBeGreaterThan(species.lodDistances[i - 1])
            }
        }
    })

    it('all species have valid spacing constraints', () => {
        for (const species of registry.getAll()) {
            expect(species.spacing.min).toBeGreaterThan(0)
            expect(species.spacing.max).toBeGreaterThanOrEqual(species.spacing.min)
        }
    })

    it('all species have seasonal tint entries', () => {
        for (const species of registry.getAll()) {
            expect(species.leafTint).toHaveProperty('spring')
            expect(species.leafTint).toHaveProperty('summer')
            expect(species.leafTint).toHaveProperty('autumn')
            expect(species.leafTint).toHaveProperty('winter')
        }
    })

    it('registers custom species', () => {
        const custom = registry.getById('oak')!
        const alien = {
            ...custom,
            id: 'alien_tentacle',
            displayName: 'Alien Tentacle',
            opensimState: 99,
            biomes: ['alien', 'sci-fi'],
        }
        registry.register(alien)

        expect(registry.getById('alien_tentacle')).toBeDefined()
        expect(registry.getByState(99)?.id).toBe('alien_tentacle')
        expect(registry.count).toBe(22) // 21 + 1
    })
})
