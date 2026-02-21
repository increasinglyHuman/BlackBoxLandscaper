/**
 * BrushController — Interactive placement tools for the Landscaper dev harness.
 *
 * Modes: orbit (default), paint (add instances), erase (remove), select (pick + delete).
 * Owns the raycaster, brush cursor, and pointer event handling.
 * Disables OrbitControls when a brush mode is active.
 */

import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { SpeciesDefinition, GeneratorOutput } from '../types/index.js'
import type { MeshGenerator } from '../generators/types.js'

export type BrushMode = 'orbit' | 'paint' | 'erase' | 'select'

export const BRUSH_MODES: BrushMode[] = ['orbit', 'paint', 'erase', 'select']

export interface BrushControllerOptions {
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    renderer: THREE.WebGLRenderer
    controls: OrbitControls
    ground: THREE.Mesh
    treeGroup: THREE.Group
    getSpecies: () => { species: SpeciesDefinition; generator: MeshGenerator } | null
    sampleHeight: (x: number, z: number) => number
    onInstanceAdded: (obj: THREE.Object3D, triCount: number) => void
    onInstanceRemoved: (obj: THREE.Object3D) => void
    onStatsChanged: () => void
    onModeChanged?: (mode: BrushMode) => void
}

const CURSOR_COLORS: Record<BrushMode, number> = {
    orbit: 0x66cc88,
    paint: 0x66cc88,
    erase: 0xcc8866,
    select: 0x6688cc,
}

export class BrushController {
    mode: BrushMode = 'orbit'
    brushRadius = 10

    private scene: THREE.Scene
    private camera: THREE.PerspectiveCamera
    private renderer: THREE.WebGLRenderer
    private controls: OrbitControls
    private ground: THREE.Mesh
    private treeGroup: THREE.Group
    private getSpecies: BrushControllerOptions['getSpecies']
    private sampleHeight: BrushControllerOptions['sampleHeight']
    private onInstanceAdded: BrushControllerOptions['onInstanceAdded']
    private onInstanceRemoved: BrushControllerOptions['onInstanceRemoved']
    private onStatsChanged: BrushControllerOptions['onStatsChanged']
    private onModeChanged: BrushControllerOptions['onModeChanged']

    private raycaster = new THREE.Raycaster()
    private pointer = new THREE.Vector2()
    private cursor: THREE.Mesh
    private cursorMaterial: THREE.MeshBasicMaterial
    private transformControls: TransformControls

    private isPointerDown = false
    private lastPaintPos: THREE.Vector3 | null = null
    private selectedSet = new Set<THREE.Object3D>()

    // Bound handlers for cleanup
    private _onPointerDown: (e: PointerEvent) => void
    private _onPointerMove: (e: PointerEvent) => void
    private _onPointerUp: (e: PointerEvent) => void
    private _onKeyDown: (e: KeyboardEvent) => void

    constructor(options: BrushControllerOptions) {
        this.scene = options.scene
        this.camera = options.camera
        this.renderer = options.renderer
        this.controls = options.controls
        this.ground = options.ground
        this.treeGroup = options.treeGroup
        this.getSpecies = options.getSpecies
        this.sampleHeight = options.sampleHeight
        this.onInstanceAdded = options.onInstanceAdded
        this.onInstanceRemoved = options.onInstanceRemoved
        this.onStatsChanged = options.onStatsChanged
        this.onModeChanged = options.onModeChanged

        // Create brush cursor — ring geometry flat on ground
        this.cursorMaterial = new THREE.MeshBasicMaterial({
            color: CURSOR_COLORS.paint,
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide,
            depthWrite: false,
        })
        const cursorGeo = new THREE.RingGeometry(
            this.brushRadius - 0.3,
            this.brushRadius,
            48
        )
        cursorGeo.rotateX(-Math.PI / 2)
        this.cursor = new THREE.Mesh(cursorGeo, this.cursorMaterial)
        this.cursor.visible = false
        this.cursor.renderOrder = 999
        this.scene.add(this.cursor)

        // Transform gizmo for rotate/move/scale on selected tree
        this.transformControls = new TransformControls(this.camera, this.renderer.domElement)
        this.transformControls.setMode('rotate')
        this.transformControls.setSpace('local')
        ;(this.transformControls as any).visible = false
        this.transformControls.enabled = false
        this.scene.add(this.transformControls as any)

        // Disable orbit while dragging the gizmo
        this.transformControls.addEventListener('dragging-changed', (event: any) => {
            this.controls.enabled = !event.value && this.mode === 'orbit'
        })

        // Bind event handlers
        this._onPointerDown = this.handlePointerDown.bind(this)
        this._onPointerMove = this.handlePointerMove.bind(this)
        this._onPointerUp = this.handlePointerUp.bind(this)
        this._onKeyDown = this.handleKeyDown.bind(this)

        const canvas = this.renderer.domElement
        canvas.addEventListener('pointerdown', this._onPointerDown)
        canvas.addEventListener('pointermove', this._onPointerMove)
        canvas.addEventListener('pointerup', this._onPointerUp)
        canvas.addEventListener('pointerleave', this._onPointerUp)
        window.addEventListener('keydown', this._onKeyDown)
    }

    setMode(mode: BrushMode): void {
        this.mode = mode
        this.controls.enabled = (mode === 'orbit')
        this.cursor.visible = (mode === 'paint' || mode === 'erase')
        this.cursorMaterial.color.setHex(CURSOR_COLORS[mode])
        this.isPointerDown = false
        this.lastPaintPos = null

        // Clear selection and detach gizmo when leaving select mode
        if (mode !== 'select') {
            this.clearSelection()
        }

        this.onModeChanged?.(mode)
    }

    /** Cycle to the next tool mode (spacebar) */
    cycleMode(): void {
        const idx = BRUSH_MODES.indexOf(this.mode)
        const next = BRUSH_MODES[(idx + 1) % BRUSH_MODES.length]
        this.setMode(next)
    }

    setBrushRadius(radius: number): void {
        this.brushRadius = radius
        // Rebuild cursor geometry at new radius
        this.cursor.geometry.dispose()
        const geo = new THREE.RingGeometry(radius - 0.3, radius, 48)
        geo.rotateX(-Math.PI / 2)
        this.cursor.geometry = geo
    }

    // ========================================================================
    // POINTER EVENTS
    // ========================================================================

    private updatePointer(event: PointerEvent): void {
        const rect = this.renderer.domElement.getBoundingClientRect()
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    }

    private raycastGround(): THREE.Vector3 | null {
        this.raycaster.setFromCamera(this.pointer, this.camera)
        const hits = this.raycaster.intersectObject(this.ground)
        return hits.length > 0 ? hits[0].point.clone() : null
    }

    private raycastTrees(): THREE.Object3D | null {
        this.raycaster.setFromCamera(this.pointer, this.camera)
        const hits = this.raycaster.intersectObjects(this.treeGroup.children, true)
        if (hits.length === 0) return null

        // Walk up to direct child of treeGroup
        let obj = hits[0].object
        while (obj.parent && obj.parent !== this.treeGroup) {
            obj = obj.parent
        }
        return obj.parent === this.treeGroup ? obj : null
    }

    private handlePointerDown(event: PointerEvent): void {
        if (this.mode === 'orbit') return
        if (event.button !== 0) return // left click only

        this.updatePointer(event)
        this.isPointerDown = true

        if (this.mode === 'paint') {
            this.paintAtPointer()
        } else if (this.mode === 'erase') {
            this.eraseAtPointer()
        } else if (this.mode === 'select') {
            this.selectAtPointer(event.shiftKey)
        }
    }

    private handlePointerMove(event: PointerEvent): void {
        if (this.mode === 'orbit') return

        this.updatePointer(event)

        // Update cursor position
        const hit = this.raycastGround()
        if (hit && (this.mode === 'paint' || this.mode === 'erase')) {
            this.cursor.position.set(hit.x, hit.y + 0.15, hit.z)
            this.cursor.visible = true
        }

        // Continuous action while dragging
        if (this.isPointerDown) {
            if (this.mode === 'paint') {
                this.paintAtPointer()
            } else if (this.mode === 'erase') {
                this.eraseAtPointer()
            }
        }
    }

    private handlePointerUp(_event: PointerEvent): void {
        this.isPointerDown = false
        this.lastPaintPos = null
    }

    private handleKeyDown(event: KeyboardEvent): void {
        // Ignore if user is typing in an input
        const tag = (event.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

        if (event.key === ' ') {
            event.preventDefault()
            this.cycleMode()
        } else if (this.mode === 'select' && (event.key === 'Delete' || event.key === 'Backspace')) {
            this.deleteSelected()
        } else if (this.mode === 'select' && this.selectedSet.size === 1) {
            // Gizmo mode shortcuts (Blender-style)
            if (event.key === 'r' || event.key === 'R') {
                this.transformControls.setMode('rotate')
            } else if (event.key === 'g' || event.key === 'G') {
                this.transformControls.setMode('translate')
            } else if (event.key === 's' || event.key === 'S') {
                this.transformControls.setMode('scale')
            }
        }
    }

    // ========================================================================
    // PAINT MODE — scatter instances within brush radius
    // ========================================================================

    private paintAtPointer(): void {
        const hit = this.raycastGround()
        if (!hit) return

        const speciesData = this.getSpecies()
        if (!speciesData) return
        const { species, generator } = speciesData

        const minSpacing = species.spacing.min

        // Throttle by cursor travel — must move at least half the brush radius
        if (this.lastPaintPos) {
            const dx = hit.x - this.lastPaintPos.x
            const dz = hit.z - this.lastPaintPos.z
            const dist = Math.sqrt(dx * dx + dz * dz)
            if (dist < this.brushRadius * 0.4) return
        }
        this.lastPaintPos = hit.clone()

        // Attempt to place 1-3 trees at random positions within the brush circle
        const attempts = Math.max(1, Math.floor(this.brushRadius / 8))
        let placed = 0

        for (let a = 0; a < attempts * 3 && placed < attempts; a++) {
            // Random point within brush circle (sqrt for uniform area distribution)
            const angle = Math.random() * Math.PI * 2
            const radius = Math.sqrt(Math.random()) * this.brushRadius
            const px = hit.x + Math.cos(angle) * radius
            const pz = hit.z + Math.sin(angle) * radius

            // Check not too close to existing trees
            let tooClose = false
            for (const child of this.treeGroup.children) {
                const dx = px - child.position.x
                const dz = pz - child.position.z
                if (dx * dx + dz * dz < minSpacing * minSpacing * 0.5) {
                    tooClose = true
                    break
                }
            }
            if (tooClose) continue

            const seed = Math.floor(Math.random() * 100000)
            const output = generator.generate(species, seed)

            const py = this.sampleHeight(px, pz)
            output.object.position.set(px, py, pz)
            output.object.rotation.y = Math.random() * Math.PI * 2

            const scale = 0.8 + Math.random() * 0.4
            output.object.scale.setScalar(scale)

            output.object.userData = {
                speciesId: species.id,
                triangleCount: output.triangleCount,
            }

            output.object.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.castShadow = true
                    child.receiveShadow = true
                }
            })

            this.treeGroup.add(output.object)
            this.onInstanceAdded(output.object, output.triangleCount)
            placed++
        }

        if (placed > 0) {
            this.onStatsChanged()
        }
    }

    // ========================================================================
    // ERASE MODE — remove instances within brush radius
    // ========================================================================

    private eraseAtPointer(): void {
        const hit = this.raycastGround()
        if (!hit) return

        const rSq = this.brushRadius * this.brushRadius
        const toRemove: THREE.Object3D[] = []

        for (const child of this.treeGroup.children) {
            const dx = child.position.x - hit.x
            const dz = child.position.z - hit.z
            if (dx * dx + dz * dz < rSq) {
                toRemove.push(child)
            }
        }

        for (const obj of toRemove) {
            this.selectedSet.delete(obj)
            this.disposeObject(obj)
            this.treeGroup.remove(obj)
            this.onInstanceRemoved(obj)
        }

        if (toRemove.length > 0) {
            this.onStatsChanged()
        }
    }

    // ========================================================================
    // SELECT MODE — pick instances, highlight, delete key removes
    // ========================================================================

    private selectAtPointer(shiftKey: boolean): void {
        const obj = this.raycastTrees()

        if (!obj) {
            // Clicked empty space — clear selection (unless shift)
            if (!shiftKey) {
                this.clearSelection()
            }
            return
        }

        if (this.selectedSet.has(obj)) {
            // Deselect
            this.selectedSet.delete(obj)
            this.setHighlight(obj, false)
        } else {
            // Clear previous selection if not shift-clicking
            if (!shiftKey) {
                this.clearSelection()
            }
            this.selectedSet.add(obj)
            this.setHighlight(obj, true)
        }

        this.updateGizmo()
    }

    private setHighlight(obj: THREE.Object3D, selected: boolean): void {
        obj.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material) {
                const mat = child.material as THREE.MeshStandardMaterial
                if (mat.emissive) {
                    mat.emissive.setHex(selected ? 0x336644 : 0x000000)
                }
            }
        })
    }

    private clearSelection(): void {
        for (const obj of this.selectedSet) {
            this.setHighlight(obj, false)
        }
        this.selectedSet.clear()
        this.detachGizmo()
    }

    private updateGizmo(): void {
        if (this.selectedSet.size === 1) {
            const [obj] = this.selectedSet
            this.transformControls.attach(obj)
            ;(this.transformControls as any).visible = true
            this.transformControls.enabled = true
        } else {
            this.detachGizmo()
        }
    }

    private detachGizmo(): void {
        this.transformControls.detach()
        ;(this.transformControls as any).visible = false
        this.transformControls.enabled = false
    }

    private deleteSelected(): void {
        if (this.selectedSet.size === 0) return

        this.detachGizmo()
        for (const obj of this.selectedSet) {
            this.disposeObject(obj)
            this.treeGroup.remove(obj)
            this.onInstanceRemoved(obj)
        }
        this.selectedSet.clear()
        this.onStatsChanged()
    }

    // ========================================================================
    // UTILITIES
    // ========================================================================

    private disposeObject(obj: THREE.Object3D): void {
        obj.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.geometry?.dispose()
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose())
                } else {
                    child.material?.dispose()
                }
            }
        })
    }

    dispose(): void {
        const canvas = this.renderer.domElement
        canvas.removeEventListener('pointerdown', this._onPointerDown)
        canvas.removeEventListener('pointermove', this._onPointerMove)
        canvas.removeEventListener('pointerup', this._onPointerUp)
        canvas.removeEventListener('pointerleave', this._onPointerUp)
        window.removeEventListener('keydown', this._onKeyDown)

        this.cursor.geometry.dispose()
        this.cursorMaterial.dispose()
        this.scene.remove(this.cursor)
        this.detachGizmo()
        this.transformControls.dispose()
        this.scene.remove(this.transformControls as any)
        this.clearSelection()
    }
}
