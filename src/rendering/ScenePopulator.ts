/**
 * ScenePopulator — connects scatter output to the Three.js scene.
 *
 * Takes PlacedInstance[] from ScatterSystem and:
 *   1. Groups instances by speciesId
 *   2. For each species: generates template mesh, extracts geometry+material
 *   3. Registers with InstancePool, adds instance transforms
 *
 * This is the "convenience glue" that keeps ScatterSystem pure math
 * and InstancePool generic.
 */

import * as THREE from 'three'
import type { PlacedInstance } from '../types/index.js'
import type { MeshGenerator } from '../generators/types.js'
import { InstancePool } from './InstancePool.js'
import { SpeciesRegistry } from '../species/registry.js'
import type { ScatterResult } from '../scatter/ScatterSystem.js'

export interface PopulatorConfig {
    scene: THREE.Scene
    registry: SpeciesRegistry
    generators: Map<string, MeshGenerator>
}

export interface PopulateResult {
    instanceCount: number
    speciesCount: number
    estimatedTriangles: number
    estimatedDrawCalls: number
    timeMs: number
}

export class ScenePopulator {
    private pool: InstancePool
    private config: PopulatorConfig
    /** Cache of template meshes — one per speciesId */
    private templateCache = new Map<string, {
        geometry: THREE.BufferGeometry
        material: THREE.Material | THREE.Material[]
        triangleCount: number
    }>()

    constructor(config: PopulatorConfig) {
        this.config = config
        this.pool = new InstancePool(config.scene)
    }

    /**
     * Populate the scene from scatter results.
     * Groups by speciesId, generates template meshes, instances them.
     */
    populate(instances: PlacedInstance[]): PopulateResult {
        const startTime = performance.now()

        // Group instances by speciesId
        const groups = new Map<string, PlacedInstance[]>()
        for (const inst of instances) {
            let group = groups.get(inst.speciesId)
            if (!group) {
                group = []
                groups.set(inst.speciesId, group)
            }
            group.push(inst)
        }

        let totalTriangles = 0
        let totalDrawCalls = 0

        for (const [speciesId, group] of groups) {
            const template = this.getTemplate(speciesId)
            if (!template) {
                console.warn(`ScenePopulator: no template for species "${speciesId}"`)
                continue
            }

            // Register pool for this species (if not already)
            const poolKey = `scatter_${speciesId}`
            this.pool.register(poolKey, template.geometry, template.material, group.length)

            // Add each instance transform
            for (const inst of group) {
                this.pool.add(
                    poolKey,
                    new THREE.Vector3(inst.position.x, inst.position.y, inst.position.z),
                    new THREE.Euler(inst.rotation.x, inst.rotation.y, inst.rotation.z),
                    new THREE.Vector3(inst.scale.x, inst.scale.y, inst.scale.z)
                )
            }

            totalTriangles += template.triangleCount * group.length
            totalDrawCalls++
        }

        return {
            instanceCount: instances.length,
            speciesCount: groups.size,
            estimatedTriangles: totalTriangles,
            estimatedDrawCalls: totalDrawCalls,
            timeMs: performance.now() - startTime,
        }
    }

    /**
     * Populate from multiple layers at once.
     * Convenience wrapper for scatterLayers() output.
     */
    populateAll(results: Map<string, ScatterResult>): PopulateResult {
        const allInstances: PlacedInstance[] = []
        for (const [, result] of results) {
            allInstances.push(...result.instances)
        }
        return this.populate(allInstances)
    }

    /** Clear all populated instances from the scene. */
    clear(): void {
        this.pool.clearAll()
    }

    dispose(): void {
        this.pool.dispose()
        // Dispose cached template geometries (clones, safe to dispose)
        for (const [, template] of this.templateCache) {
            template.geometry.dispose()
        }
        this.templateCache.clear()
    }

    /**
     * Get or create a template mesh for a species.
     * Generates one tree/plant via the appropriate generator,
     * then extracts geometry and material from the first Mesh child.
     */
    private getTemplate(speciesId: string): {
        geometry: THREE.BufferGeometry
        material: THREE.Material | THREE.Material[]
        triangleCount: number
    } | null {
        const cached = this.templateCache.get(speciesId)
        if (cached) return cached

        const species = this.config.registry.getById(speciesId)
        if (!species) return null

        const generator = this.config.generators.get(species.generator)
        if (!generator) return null

        // Generate a template mesh
        const result = generator.generate(species, 12345) // fixed seed for template

        // Find the first Mesh in the generated object
        let geometry: THREE.BufferGeometry | null = null
        let material: THREE.Material | THREE.Material[] | null = null

        result.object.traverse((child) => {
            if (!geometry && child instanceof THREE.Mesh) {
                geometry = child.geometry.clone()
                material = child.material
            }
        })

        if (!geometry || !material) return null

        const template = {
            geometry,
            material,
            triangleCount: result.triangleCount,
        }

        this.templateCache.set(speciesId, template)
        return template
    }
}
