/**
 * SpeciesRegistry — Maps OpenSim State IDs to species configurations.
 * JSON-driven, extensible. The single source of truth for "what does State 1 look like?"
 */

import type { SpeciesDefinition, GeneratorType } from '../types/index.js'
import defaultSpecies from './opensim-species.json'

export class SpeciesRegistry {
    private byId: Map<string, SpeciesDefinition> = new Map()
    private byState: Map<number, SpeciesDefinition> = new Map()

    constructor() {
        this.loadDefaults()
    }

    /** Load the built-in OpenSim species definitions */
    private loadDefaults(): void {
        for (const raw of defaultSpecies) {
            const species = this.parseRawSpecies(raw)
            this.register(species)
        }
    }

    /** Parse raw JSON entry into typed SpeciesDefinition */
    private parseRawSpecies(raw: Record<string, unknown>): SpeciesDefinition {
        return {
            id: raw.id as string,
            displayName: raw.displayName as string,
            opensimState: raw.opensimState as number,
            generator: raw.generator as GeneratorType,
            preset: raw.preset as Record<string, unknown>,
            lodDistances: raw.lodDistances as [number, number, number, number],
            billboardTexture: raw.billboardTexture as string | undefined,
            leafTint: raw.leafTint as SpeciesDefinition['leafTint'],
            biomes: raw.biomes as string[],
            minElevation: raw.minElevation as number,
            maxElevation: raw.maxElevation as number,
            preferredSlope: raw.preferredSlope as [number, number],
            spacing: raw.spacing as { min: number; max: number },
        }
    }

    /** Register a species definition */
    register(species: SpeciesDefinition): void {
        this.byId.set(species.id, species)
        this.byState.set(species.opensimState, species)
    }

    /** Look up species by string ID */
    getById(id: string): SpeciesDefinition | undefined {
        return this.byId.get(id)
    }

    /** Look up species by OpenSim State integer */
    getByState(state: number): SpeciesDefinition | undefined {
        return this.byState.get(state)
    }

    /** Get all registered species */
    getAll(): SpeciesDefinition[] {
        return Array.from(this.byId.values())
    }

    /** Get species filtered by generator type */
    getByGenerator(generator: GeneratorType): SpeciesDefinition[] {
        return this.getAll().filter(s => s.generator === generator)
    }

    /** Get species suitable for a given biome */
    getByBiome(biome: string): SpeciesDefinition[] {
        return this.getAll().filter(s => s.biomes.includes(biome))
    }

    /** Total registered species count */
    get count(): number {
        return this.byId.size
    }
}
