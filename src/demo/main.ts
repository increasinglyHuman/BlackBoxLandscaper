/**
 * BlackBox Landscaper — Dev Harness
 *
 * Three.js scene with species picker and scatter system demo.
 * Phase 2 — scatter algorithms, constraints, terrain sampling.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { SpeciesRegistry } from '../species/registry.js'
import { EzTreeAdapter } from '../generators/EzTreeAdapter.js'
import { BillboardGenerator } from '../generators/BillboardGenerator.js'
import { ScatterSystem } from '../scatter/ScatterSystem.js'
import { ProceduralTerrainSampler } from '../scatter/TerrainSampler.js'
import type { DecorationLayer, DistributionAlgorithm } from '../types/index.js'
import type { MeshGenerator } from '../generators/types.js'

// ============================================================================
// SCENE SETUP
// ============================================================================

const container = document.getElementById('canvas-container')!
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.8
container.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x87ceeb) // Sky blue
scene.fog = new THREE.Fog(0x87ceeb, 100, 500)

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.set(60, 40, 60)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 5, 0)
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.update()

// ============================================================================
// LIGHTING
// ============================================================================

const ambientLight = new THREE.AmbientLight(0x8899bb, 1.0)
scene.add(ambientLight)

const sunLight = new THREE.DirectionalLight(0xffeedd, 2.0)
sunLight.position.set(50, 80, 30)
sunLight.castShadow = true
sunLight.shadow.mapSize.set(4096, 4096)
// Shadow camera must cover the entire ground plane (256x256)
sunLight.shadow.camera.left = -140
sunLight.shadow.camera.right = 140
sunLight.shadow.camera.top = 140
sunLight.shadow.camera.bottom = -140
sunLight.shadow.camera.near = 1
sunLight.shadow.camera.far = 250
sunLight.shadow.bias = -0.001
scene.add(sunLight)

const fillLight = new THREE.DirectionalLight(0x8899cc, 0.6)
fillLight.position.set(-30, 20, -20)
scene.add(fillLight)

// ============================================================================
// GROUND
// ============================================================================

const groundGeo = new THREE.PlaneGeometry(256, 256, 64, 64)
groundGeo.rotateX(-Math.PI / 2)

// Add subtle elevation variation
const posAttr = groundGeo.getAttribute('position')
for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i)
    const z = posAttr.getZ(i)
    const y = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 1.5
    posAttr.setY(i, y)
}
groundGeo.computeVertexNormals()

const groundMat = new THREE.MeshStandardMaterial({
    color: 0x4a7c3f,
    roughness: 0.9,
    metalness: 0.0,
})
const ground = new THREE.Mesh(groundGeo, groundMat)
ground.receiveShadow = true
scene.add(ground)

// Reference grid — 256x256, 16m divisions (each square = 16x16 meters)
const gridHelper = new THREE.GridHelper(256, 16, 0x335533, 0x2a4a2a)
gridHelper.position.y = 0.05 // Slightly above ground to avoid z-fighting
gridHelper.material.opacity = 0.3
gridHelper.material.transparent = true
scene.add(gridHelper)

// ============================================================================
// LANDSCAPER CORE
// ============================================================================

const registry = new SpeciesRegistry()
const generators = new Map<string, MeshGenerator>()
generators.set('ez-tree', new EzTreeAdapter())
generators.set('billboard', new BillboardGenerator())

const treeGroup = new THREE.Group()
treeGroup.name = 'trees'
scene.add(treeGroup)

let treeCount = 0
let totalTriangles = 0

// ============================================================================
// UI SETUP
// ============================================================================

const speciesSelect = document.getElementById('species-select') as HTMLSelectElement
const countSelect = document.getElementById('count-select') as HTMLSelectElement
const btnGenerate = document.getElementById('btn-generate') as HTMLButtonElement
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement
const statTrees = document.getElementById('stat-trees')!
const statTris = document.getElementById('stat-tris')!
const statDraws = document.getElementById('stat-draws')!

// Populate species dropdown — only show ez-tree species for now
const allSpecies = registry.getAll()
const ezTreeSpecies = allSpecies.filter(s => s.generator === 'ez-tree')

for (const species of ezTreeSpecies) {
    const option = document.createElement('option')
    option.value = species.id
    option.textContent = `${species.displayName} (State ${species.opensimState})`
    speciesSelect.appendChild(option)
}

// Default to oak
speciesSelect.value = 'oak'

// ============================================================================
// GENERATION
// ============================================================================

function generateTrees(): void {
    // Clear previous trees so Generate replaces, not accumulates
    clearScene()

    const speciesId = speciesSelect.value
    const species = registry.getById(speciesId)
    if (!species) {
        console.warn(`Species not found: ${speciesId}`)
        return
    }

    const generator = generators.get(species.generator)
    if (!generator) {
        console.warn(`Generator not available: ${species.generator}`)
        return
    }

    const count = parseInt(countSelect.value) || 5

    console.log(`Generating ${count}x ${species.displayName} (${species.generator})...`)
    const startTime = performance.now()

    // Spread proportional to count and species spacing
    // Species spacing.max gives natural inter-tree distance
    const spacing = species.spacing.max
    const spread = Math.max(spacing * 2, Math.sqrt(count) * spacing)

    for (let i = 0; i < count; i++) {
        const seed = Math.floor(Math.random() * 100000)
        const result = generator.generate(species, seed)

        const x = (Math.random() - 0.5) * spread
        const z = (Math.random() - 0.5) * spread

        // Sample ground height at position
        const y = sampleGroundHeight(x, z)

        result.object.position.set(x, y, z)

        // Random Y rotation
        result.object.rotation.y = Math.random() * Math.PI * 2

        // Scale variation (±20%)
        const scale = 0.8 + Math.random() * 0.4
        result.object.scale.setScalar(scale)

        // Enable shadows on all meshes
        result.object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true
                child.receiveShadow = true
            }
        })

        treeGroup.add(result.object)
        treeCount++
        totalTriangles += result.triangleCount
    }

    const elapsed = performance.now() - startTime
    console.log(`Generated in ${elapsed.toFixed(1)}ms`)
    updateStats()
}

function clearScene(): void {
    while (treeGroup.children.length > 0) {
        const child = treeGroup.children[0]
        treeGroup.remove(child)
        child.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry?.dispose()
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose())
                } else {
                    obj.material?.dispose()
                }
            }
        })
    }
    treeCount = 0
    totalTriangles = 0
    updateStats()
}

function sampleGroundHeight(x: number, z: number): number {
    return Math.sin(x * 0.05) * Math.cos(z * 0.05) * 1.5
}

function updateStats(): void {
    statTrees.textContent = String(treeCount)
    statTris.textContent = totalTriangles.toLocaleString()
    statDraws.textContent = String(renderer.info.render.calls)
}

// ============================================================================
// SCATTER SYSTEM
// ============================================================================

const scatterSystem = new ScatterSystem()
const terrain = new ProceduralTerrainSampler()
const scatterGroup = new THREE.Group()
scatterGroup.name = 'scatter'
scene.add(scatterGroup)

const algorithmSelect = document.getElementById('algorithm-select') as HTMLSelectElement
const scatterCountSelect = document.getElementById('scatter-count') as HTMLSelectElement
const btnScatter = document.getElementById('btn-scatter') as HTMLButtonElement

function scatterForest(): void {
    const algorithm = algorithmSelect.value as DistributionAlgorithm
    const count = parseInt(scatterCountSelect.value) || 50
    const speciesId = speciesSelect.value

    const species = registry.getById(speciesId)
    if (!species) return

    const generator = generators.get(species.generator)
    if (!generator) return

    console.log(`Scattering ${count}x ${species.displayName} (${algorithm})...`)
    const startTime = performance.now()

    const layer: DecorationLayer = {
        id: 'demo-forest',
        name: 'Demo Forest',
        instanceTypes: [
            { speciesId: species.id, weight: 1.0, scaleMin: 0.7, scaleMax: 1.3 },
        ],
        algorithm,
        count,
        minDistance: species.spacing.min,
        constraints: [
            { type: 'slope', maxDegrees: 30 },
        ],
        priority: 10,
    }

    const region = {
        type: 'bounds' as const,
        minX: -112,
        maxX: 112,
        minZ: -112,
        maxZ: 112,
    }

    const result = scatterSystem.scatter(layer, {
        terrain,
        region,
        seed: Math.floor(Math.random() * 100000),
    })

    // Place individual trees at scattered positions
    for (const inst of result.instances) {
        const seed = Math.floor(Math.random() * 100000)
        const output = generator.generate(species, seed)

        output.object.position.set(inst.position.x, inst.position.y, inst.position.z)
        output.object.rotation.set(inst.rotation.x, inst.rotation.y, inst.rotation.z)
        output.object.scale.set(inst.scale.x, inst.scale.y, inst.scale.z)

        output.object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true
                child.receiveShadow = true
            }
        })

        scatterGroup.add(output.object)
        treeCount++
        totalTriangles += output.triangleCount
    }

    const elapsed = performance.now() - startTime
    console.log(`Scattered ${result.instances.length} trees in ${elapsed.toFixed(1)}ms (${algorithm})`)
    updateStats()
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

btnGenerate.addEventListener('click', generateTrees)
btnClear.addEventListener('click', () => {
    clearScene()
    // Also clear scatter group
    while (scatterGroup.children.length > 0) {
        const child = scatterGroup.children[0]
        scatterGroup.remove(child)
        child.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry?.dispose()
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose())
                } else {
                    obj.material?.dispose()
                }
            }
        })
    }
})
btnScatter.addEventListener('click', scatterForest)

// Generate on Enter key
speciesSelect.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') generateTrees()
})

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

// ============================================================================
// RENDER LOOP
// ============================================================================

function animate(): void {
    requestAnimationFrame(animate)
    controls.update()
    renderer.render(scene, camera)
    updateStats()
}

animate()

// Generate an initial tree so the scene isn't empty
generateTrees()

console.log(`BlackBox Landscaper — Dev Harness`)
console.log(`Species registered: ${registry.count}`)
console.log(`  ez-tree: ${ezTreeSpecies.length}`)
console.log(`  billboard: ${registry.getByGenerator('billboard').length}`)
console.log(`  custom (palm/fern): ${registry.getByGenerator('palm').length + registry.getByGenerator('fern').length}`)
