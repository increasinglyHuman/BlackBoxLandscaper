/**
 * EzTreeAdapter — wraps @dgreenheck/ez-tree for the Landscaper generator interface.
 *
 * Maps SpeciesDefinition presets to ez-tree's TreeOptions and produces
 * THREE.Object3D outputs with triangle counts for budgeting.
 *
 * Key: ez-tree's TreeOptions has deeply nested defaults (branch.sections,
 * branch.segments, etc.). We must use tree.options.copy() for deep merge —
 * Object.assign would shallow-replace and lose critical defaults.
 */

import { Tree } from '@dgreenheck/ez-tree'
import * as THREE from 'three'
import type { MeshGenerator } from './types.js'
import type { GeneratorOutput, SpeciesDefinition } from '../types/index.js'

export class EzTreeAdapter implements MeshGenerator {
    readonly type = 'ez-tree'

    /**
     * Generate a full-detail tree mesh from species configuration.
     * @param species - Species definition with ez-tree preset in `preset` field
     * @param seed - Optional seed for reproducible generation (default: random)
     */
    generate(species: SpeciesDefinition, seed?: number): GeneratorOutput {
        const tree = new Tree()

        // Deep merge preset onto defaults — preserves sections/segments/etc.
        const preset = this.resolveColors(species.preset)
        // copy() does deep recursive merge — safe with partial objects at runtime
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tree.options.copy(preset as any)
        tree.options.seed = seed ?? Math.floor(Math.random() * 100000)

        tree.generate()

        const triangleCount = this.countTriangles(tree)

        // Compute bounding sphere for culling
        const box = new THREE.Box3().setFromObject(tree)
        const sphere = new THREE.Sphere()
        box.getBoundingSphere(sphere)

        return {
            object: tree,
            triangleCount,
            boundingRadius: sphere.radius,
        }
    }

    /**
     * Generate a simplified tree for LOD 1 (mid-distance).
     * Reduces branch levels and leaf count.
     */
    generateSimplified(species: SpeciesDefinition, seed?: number): GeneratorOutput {
        const simplified = structuredClone(species.preset)

        // Reduce branch complexity
        if (simplified.branch) {
            const branch = simplified.branch as Record<string, unknown>
            const levels = (branch.levels as number) || 3
            branch.levels = Math.max(1, levels - 1)
        }

        // Reduce leaf count
        if (simplified.leaves) {
            const leaves = simplified.leaves as Record<string, unknown>
            const count = (leaves.count as number) || 10
            leaves.count = Math.max(1, Math.floor(count * 0.5))
        }

        const modifiedSpecies = { ...species, preset: simplified }
        return this.generate(modifiedSpecies, seed)
    }

    /**
     * Recursively convert hex color strings ("0x448844") to numbers
     * for ez-tree's tint fields. Only converts values for known color keys.
     */
    private resolveColors(preset: Record<string, unknown>): Record<string, unknown> {
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(preset)) {
            if ((key === 'tint') && typeof value === 'string') {
                result[key] = parseInt(value.replace('0x', ''), 16)
            } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                result[key] = this.resolveColors(value as Record<string, unknown>)
            } else {
                result[key] = value
            }
        }
        return result
    }

    /** Count triangles across all meshes in the tree object */
    private countTriangles(object: THREE.Object3D): number {
        let count = 0
        object.traverse((child) => {
            if (child instanceof THREE.Mesh && child.geometry) {
                const geo = child.geometry as THREE.BufferGeometry
                if (geo.index) {
                    count += geo.index.count / 3
                } else {
                    const pos = geo.getAttribute('position')
                    if (pos) count += pos.count / 3
                }
            }
        })
        return Math.floor(count)
    }

    dispose(): void {
        // ez-tree doesn't hold persistent resources
    }
}
