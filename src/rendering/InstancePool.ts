/**
 * InstancePool — manages THREE.InstancedMesh per species per LOD level.
 *
 * Phase 1 stub: basic add/clear/dispose. Full implementation in Phase 2
 * when the scatter system provides positions to instance.
 *
 * Design: pool is keyed by `{speciesId}_{lodLevel}`. Each pool entry
 * holds an InstancedMesh with a matrix buffer that auto-grows.
 */

import * as THREE from 'three'

interface PoolEntry {
    mesh: THREE.InstancedMesh
    count: number
    capacity: number
}

export class InstancePool {
    private pools: Map<string, PoolEntry> = new Map()
    private scene: THREE.Scene

    constructor(scene: THREE.Scene) {
        this.scene = scene
    }

    /**
     * Register a source geometry + material for instancing.
     * Must be called before add() for a given key.
     */
    register(
        key: string,
        geometry: THREE.BufferGeometry,
        material: THREE.Material | THREE.Material[],
        initialCapacity: number = 100
    ): void {
        if (this.pools.has(key)) return

        const mesh = new THREE.InstancedMesh(geometry, material, initialCapacity)
        mesh.count = 0 // Start with no visible instances
        mesh.name = `instancePool_${key}`
        this.scene.add(mesh)

        this.pools.set(key, {
            mesh,
            count: 0,
            capacity: initialCapacity,
        })
    }

    /**
     * Add an instance at the given position/rotation/scale.
     * @returns Instance index, or -1 if pool not registered
     */
    add(
        key: string,
        position: THREE.Vector3,
        rotation: THREE.Euler,
        scale: THREE.Vector3
    ): number {
        const entry = this.pools.get(key)
        if (!entry) return -1

        // Auto-grow if at capacity
        if (entry.count >= entry.capacity) {
            this.grow(key, entry.capacity * 2)
        }

        const matrix = new THREE.Matrix4()
        const quaternion = new THREE.Quaternion().setFromEuler(rotation)
        matrix.compose(position, quaternion, scale)

        entry.mesh.setMatrixAt(entry.count, matrix)
        entry.mesh.instanceMatrix.needsUpdate = true
        entry.mesh.count = entry.count + 1
        entry.count++

        return entry.count - 1
    }

    /** Grow pool capacity by creating a new larger InstancedMesh */
    private grow(key: string, newCapacity: number): void {
        const entry = this.pools.get(key)
        if (!entry) return

        const oldMesh = entry.mesh
        const newMesh = new THREE.InstancedMesh(
            oldMesh.geometry,
            oldMesh.material,
            newCapacity
        )
        newMesh.name = oldMesh.name

        // Copy existing matrices
        for (let i = 0; i < entry.count; i++) {
            const matrix = new THREE.Matrix4()
            oldMesh.getMatrixAt(i, matrix)
            newMesh.setMatrixAt(i, matrix)
        }
        newMesh.count = entry.count
        newMesh.instanceMatrix.needsUpdate = true

        // Swap in scene
        this.scene.remove(oldMesh)
        oldMesh.dispose()
        this.scene.add(newMesh)

        entry.mesh = newMesh
        entry.capacity = newCapacity
    }

    /** Get instance count for a pool */
    getCount(key: string): number {
        return this.pools.get(key)?.count ?? 0
    }

    /** Clear all instances from a specific pool */
    clear(key: string): void {
        const entry = this.pools.get(key)
        if (!entry) return
        entry.count = 0
        entry.mesh.count = 0
        entry.mesh.instanceMatrix.needsUpdate = true
    }

    /** Clear and remove all pools */
    clearAll(): void {
        for (const [, entry] of this.pools) {
            this.scene.remove(entry.mesh)
            entry.mesh.dispose()
        }
        this.pools.clear()
    }

    /** Dispose of all resources */
    dispose(): void {
        this.clearAll()
    }
}
