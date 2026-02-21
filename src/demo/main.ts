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
import { RockGenerator } from '../generators/RockGenerator.js'
import { ScatterSystem } from '../scatter/ScatterSystem.js'
import { ProceduralTerrainSampler } from '../scatter/TerrainSampler.js'
import { landscaperMatrix } from './landscaper-matrix.js'
import { BrushController } from './BrushController.js'
import type { BrushMode } from './BrushController.js'
import type { DecorationLayer, DistributionAlgorithm } from '../types/index.js'
import type { MeshGenerator } from '../generators/types.js'

// ============================================================================
// IFRAME DETECTION
// ============================================================================

const isEmbedded = (() => {
    try { return window.self !== window.top }
    catch { return true } // cross-origin restriction means we ARE in an iframe
})()

if (isEmbedded) {
    document.body.classList.add('embedded')
}

// ============================================================================
// SPLASH SCREEN
// ============================================================================

const welcomeScreen = document.getElementById('welcomeScreen')!
const mainApp = document.getElementById('mainApp')!
const welcomeStartBtn = document.getElementById('welcomeStartBtn')!

let sceneInitialized = false

// Auto-skip splash when embedded in World iframe
if (isEmbedded) {
    welcomeScreen.style.display = 'none'
    mainApp.style.display = 'block'
    mainApp.style.opacity = '1'
    sceneInitialized = true
    requestAnimationFrame(() => initScene())
} else {
    landscaperMatrix.init()
    landscaperMatrix.start()
}

welcomeStartBtn.addEventListener('click', () => {
    mainApp.style.display = 'block'
    mainApp.style.opacity = '0'

    if (!sceneInitialized) {
        sceneInitialized = true
        initScene()
    }

    setTimeout(() => {
        welcomeScreen.style.transition = 'opacity 1s ease-out'
        welcomeScreen.style.opacity = '0'
    }, 300)

    setTimeout(() => {
        mainApp.style.transition = 'opacity 0.8s ease-in'
        mainApp.style.opacity = '1'
    }, 800)

    setTimeout(() => {
        welcomeScreen.style.display = 'none'
        landscaperMatrix.stop()
    }, 2000)
})

// ============================================================================
// SCENE INITIALIZATION (deferred until START)
// ============================================================================

function initScene(): void {

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
scene.background = new THREE.Color(0x87ceeb)
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

const gridHelper = new THREE.GridHelper(256, 16, 0x335533, 0x2a4a2a)
gridHelper.position.y = 0.05
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
generators.set('rock', new RockGenerator())

const treeGroup = new THREE.Group()
treeGroup.name = 'trees'
scene.add(treeGroup)

let treeCount = 0
let totalTriangles = 0

// ============================================================================
// UI ELEMENTS
// ============================================================================

const speciesSelect = document.getElementById('species-select') as HTMLSelectElement
const algorithmSelect = document.getElementById('algorithm-select') as HTMLSelectElement
const pergroupSlider = document.getElementById('pergroup-slider') as HTMLInputElement
const populationSlider = document.getElementById('population-slider') as HTMLInputElement
const pergroupValue = document.getElementById('pergroup-value')!
const populationValue = document.getElementById('population-value')!
const totalValue = document.getElementById('total-value')!
const btnScatter = document.getElementById('btn-scatter') as HTMLButtonElement
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement
const statTrees = document.getElementById('stat-trees')!
const statTris = document.getElementById('stat-tris')!
const statDraws = document.getElementById('stat-draws')!
const speciesPreview = document.getElementById('species-preview')!

// Populate species dropdown — grouped by generator type
const allSpecies = registry.getAll()
const ezTreeSpecies = allSpecies.filter(s => s.generator === 'ez-tree')
const rockSpecies = allSpecies.filter(s => s.generator === 'rock')

const treeGroup_opt = document.createElement('optgroup')
treeGroup_opt.label = 'Trees'
for (const species of ezTreeSpecies) {
    const option = document.createElement('option')
    option.value = species.id
    option.textContent = species.displayName
    treeGroup_opt.appendChild(option)
}
speciesSelect.appendChild(treeGroup_opt)

if (rockSpecies.length > 0) {
    const rockGroup_opt = document.createElement('optgroup')
    rockGroup_opt.label = 'Rocks'
    for (const species of rockSpecies) {
        const option = document.createElement('option')
        option.value = species.id
        option.textContent = species.displayName
        rockGroup_opt.appendChild(option)
    }
    speciesSelect.appendChild(rockGroup_opt)
}

speciesSelect.value = 'oak'

// ============================================================================
// SLIDER WIRING
// ============================================================================

function updateTotalDisplay(): void {
    const perGroup = parseInt(pergroupSlider.value)
    const population = parseInt(populationSlider.value)
    pergroupValue.textContent = String(perGroup)
    populationValue.textContent = String(population)
    totalValue.textContent = String(perGroup * population)
}

pergroupSlider.addEventListener('input', updateTotalDisplay)
populationSlider.addEventListener('input', updateTotalDisplay)
updateTotalDisplay()

// ============================================================================
// SPECIES PREVIEW — rotating ghost instance on selection change
// ============================================================================

let previewRenderer: THREE.WebGLRenderer | null = null
let previewScene: THREE.Scene | null = null
let previewCamera: THREE.PerspectiveCamera | null = null
let previewAnimId: number | null = null

function initPreview(): void {
    previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    previewRenderer.setSize(speciesPreview.clientWidth, speciesPreview.clientHeight)
    previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    previewRenderer.toneMapping = THREE.ACESFilmicToneMapping
    previewRenderer.toneMappingExposure = 1.5
    speciesPreview.innerHTML = ''
    speciesPreview.appendChild(previewRenderer.domElement)

    previewScene = new THREE.Scene()
    previewCamera = new THREE.PerspectiveCamera(
        40,
        speciesPreview.clientWidth / speciesPreview.clientHeight,
        0.1, 100
    )

    const ambient = new THREE.AmbientLight(0xccddee, 2.0)
    previewScene.add(ambient)
    const dirLight = new THREE.DirectionalLight(0xffeedd, 2.5)
    dirLight.position.set(5, 10, 5)
    previewScene.add(dirLight)
    const fillPreview = new THREE.DirectionalLight(0x88aacc, 1.2)
    fillPreview.position.set(-5, 5, -5)
    previewScene.add(fillPreview)
}

function updatePreview(): void {
    const speciesId = speciesSelect.value
    const species = registry.getById(speciesId)
    if (!species) return

    const generator = generators.get(species.generator)
    if (!generator) return

    if (!previewRenderer) initPreview()

    // Clear previous preview objects (keep 3 lights)
    while (previewScene!.children.length > 3) {
        previewScene!.remove(previewScene!.children[3])
    }

    const result = generator.generate(species, 12345)
    previewScene!.add(result.object)

    // Auto-frame: position camera to fit the tree
    const box = new THREE.Box3().setFromObject(result.object)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const dist = maxDim * 1.5

    previewCamera!.position.set(
        center.x + dist * 0.6,
        center.y + dist * 0.3,
        center.z + dist * 0.6
    )
    previewCamera!.lookAt(center)

    // Slow rotation
    if (previewAnimId) cancelAnimationFrame(previewAnimId)
    let angle = 0
    function animatePreview(): void {
        angle += 0.005
        result.object.rotation.y = angle
        previewRenderer!.render(previewScene!, previewCamera!)
        previewAnimId = requestAnimationFrame(animatePreview)
    }
    animatePreview()
}

speciesSelect.addEventListener('change', updatePreview)
setTimeout(updatePreview, 100)

// ============================================================================
// SCATTER (unified: per-group × population)
// ============================================================================

const scatterSystem = new ScatterSystem()
const terrain = new ProceduralTerrainSampler()

function sampleGroundHeight(x: number, z: number): number {
    return Math.sin(x * 0.05) * Math.cos(z * 0.05) * 1.5
}

function doScatter(): void {
    const algorithm = algorithmSelect.value as DistributionAlgorithm
    const perGroup = parseInt(pergroupSlider.value) || 1
    const population = parseInt(populationSlider.value) || 25
    const speciesId = speciesSelect.value

    const species = registry.getById(speciesId)
    if (!species) return

    const generator = generators.get(species.generator)
    if (!generator) return

    console.log(`Scattering ${population} × ${perGroup} = ${population * perGroup} ${species.displayName} (${algorithm})...`)
    const startTime = performance.now()

    const layer: DecorationLayer = {
        id: 'demo-forest',
        name: 'Demo Forest',
        instanceTypes: [
            { speciesId: species.id, weight: 1.0, scaleMin: 0.7, scaleMax: 1.3 },
        ],
        algorithm,
        count: population,
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

    // For each scatter position, generate perGroup trees in a local cluster
    for (const inst of result.instances) {
        for (let g = 0; g < perGroup; g++) {
            const seed = Math.floor(Math.random() * 100000)
            const output = generator.generate(species, seed)

            // If perGroup > 1, offset subsequent trees in a small local cluster
            let px = inst.position.x
            let pz = inst.position.z
            if (perGroup > 1 && g > 0) {
                const clusterRadius = species.spacing.min * 0.4
                const a = Math.random() * Math.PI * 2
                const d = Math.random() * clusterRadius
                px += Math.cos(a) * d
                pz += Math.sin(a) * d
            }
            const py = sampleGroundHeight(px, pz)

            output.object.position.set(px, py, pz)
            output.object.rotation.set(
                inst.rotation.x,
                inst.rotation.y + (g > 0 ? Math.random() * Math.PI * 2 : 0),
                inst.rotation.z
            )

            const groupScale = 0.85 + Math.random() * 0.3
            output.object.scale.set(
                inst.scale.x * groupScale,
                inst.scale.y * groupScale,
                inst.scale.z * groupScale
            )

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

            treeGroup.add(output.object)
            treeCount++
            totalTriangles += output.triangleCount
        }
    }

    const elapsed = performance.now() - startTime
    console.log(`Scattered ${result.instances.length} × ${perGroup} = ${treeCount} trees in ${elapsed.toFixed(1)}ms (${algorithm})`)
    updateStats()
}

function clearForest(): void {
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

function updateClearButton(): void {
    if (treeCount > 0) {
        btnClear.disabled = false
        btnClear.classList.add('primary')
    } else {
        btnClear.disabled = true
        btnClear.classList.remove('primary')
    }
}

function updateStats(): void {
    statTrees.textContent = String(treeCount)
    statTris.textContent = totalTriangles.toLocaleString()
    statDraws.textContent = String(renderer.info.render.calls)
    updateClearButton()
    updateActionButtons()
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

btnScatter.addEventListener('click', () => {
    doScatter()
})

btnClear.addEventListener('click', clearForest)

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

// ============================================================================
// BRUSH CONTROLLER
// ============================================================================

// Tool toggle buttons
const toolButtons = {
    orbit: document.getElementById('tool-orbit') as HTMLButtonElement,
    paint: document.getElementById('tool-paint') as HTMLButtonElement,
    erase: document.getElementById('tool-erase') as HTMLButtonElement,
    select: document.getElementById('tool-select') as HTMLButtonElement,
}
const brushSizeRow = document.getElementById('brush-size-row')!
const brushSizeSlider = document.getElementById('brush-size-slider') as HTMLInputElement
const brushSizeValue = document.getElementById('brush-size-value')!

function syncToolUI(mode: BrushMode): void {
    for (const [key, btn] of Object.entries(toolButtons)) {
        btn.classList.toggle('active', key === mode)
    }
    brushSizeRow.style.display = (mode === 'paint' || mode === 'erase') ? '' : 'none'
}

const brush = new BrushController({
    scene,
    camera,
    renderer,
    controls,
    ground,
    treeGroup,
    getSpecies: () => {
        const species = registry.getById(speciesSelect.value)
        if (!species) return null
        const generator = generators.get(species.generator)
        if (!generator) return null
        return { species, generator }
    },
    sampleHeight: sampleGroundHeight,
    onInstanceAdded: (_obj, triCount) => {
        treeCount++
        totalTriangles += triCount
    },
    onInstanceRemoved: (obj) => {
        treeCount = Math.max(0, treeCount - 1)
        totalTriangles = Math.max(0, totalTriangles - (obj.userData.triangleCount ?? 0))
    },
    onStatsChanged: updateStats,
    onModeChanged: syncToolUI,
})

for (const [mode, btn] of Object.entries(toolButtons)) {
    btn.addEventListener('click', () => brush.setMode(mode as BrushMode))
}

brushSizeSlider.addEventListener('input', () => {
    const val = parseInt(brushSizeSlider.value)
    brushSizeValue.textContent = String(val)
    brush.setBrushRadius(val)
})

// ============================================================================
// ACTION BUTTONS — Save to World, Terraformer, Return, Save Locally
// ============================================================================

const btnSaveWorld = document.getElementById('btn-save-world') as HTMLButtonElement | null
const btnOpenTerraformer = document.getElementById('btn-open-terraformer') as HTMLButtonElement | null
const btnReturnWorld = document.getElementById('btn-return-world') as HTMLButtonElement | null
const btnSaveLocal = document.getElementById('btn-save-local') as HTMLButtonElement | null

interface LandscaperManifest {
    version: '1.0'
    timestamp: string
    instanceId?: string
    regionBounds: { type: 'bounds'; minX: number; maxX: number; minZ: number; maxZ: number }
    layers: Array<{
        layerId: string
        speciesId: string
        algorithm: string
        instances: Array<{
            position: { x: number; y: number; z: number }
            rotation: { x: number; y: number; z: number }
            scale: { x: number; y: number; z: number }
        }>
    }>
    stats: { treeCount: number; triangleCount: number }
}

function buildManifest(): LandscaperManifest {
    const instancesBySpecies = new Map<string, Array<{
        position: { x: number; y: number; z: number }
        rotation: { x: number; y: number; z: number }
        scale: { x: number; y: number; z: number }
    }>>()

    for (const child of treeGroup.children) {
        const speciesId = child.userData.speciesId ?? 'unknown'
        if (!instancesBySpecies.has(speciesId)) {
            instancesBySpecies.set(speciesId, [])
        }
        instancesBySpecies.get(speciesId)!.push({
            position: { x: child.position.x, y: child.position.y, z: child.position.z },
            rotation: { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z },
            scale: { x: child.scale.x, y: child.scale.y, z: child.scale.z },
        })
    }

    const layers: LandscaperManifest['layers'] = []
    for (const [speciesId, instances] of instancesBySpecies) {
        layers.push({
            layerId: `layer-${speciesId}`,
            speciesId,
            algorithm: algorithmSelect.value,
            instances,
        })
    }

    return {
        version: '1.0',
        timestamp: new Date().toISOString(),
        instanceId: worldContext?.instanceId,
        regionBounds: { type: 'bounds', minX: -128, maxX: 128, minZ: -128, maxZ: 128 },
        layers,
        stats: { treeCount, triangleCount: totalTriangles },
    }
}

function updateActionButtons(): void {
    const hasContent = treeCount > 0
    if (btnSaveWorld) btnSaveWorld.disabled = !hasContent
    if (btnSaveLocal) btnSaveLocal.disabled = !hasContent
}

// Save Locally — download manifest as JSON file
btnSaveLocal?.addEventListener('click', () => {
    const manifest = buildManifest()
    const json = JSON.stringify(manifest, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `landscaper-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
})

// ============================================================================
// POSTMESSAGE BRIDGE (only when embedded in World)
// ============================================================================

let worldContext: { instanceId?: string; regionBounds?: any; existingManifest?: any } | null = null

function setupPostMessageBridge(): void {
    window.addEventListener('message', (event: MessageEvent) => {
        let msg: any
        try {
            msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        } catch { return }

        if (msg?.source !== 'blackbox-world') return

        switch (msg.type) {
            case 'init-context':
                console.log('[Landscaper] Received context from World:', msg.payload)
                worldContext = msg.payload
                break
            case 'terrain-data':
                console.log('[Landscaper] Received terrain data')
                break
        }
    })

    // Announce readiness to World parent
    window.parent.postMessage(JSON.stringify({
        source: 'blackbox-landscaper',
        type: 'ready',
        payload: { version: '0.1.0' },
    }), '*')
}

if (isEmbedded) {
    setupPostMessageBridge()
}

// Save to World
btnSaveWorld?.addEventListener('click', () => {
    const manifest = buildManifest()
    window.parent.postMessage(JSON.stringify({
        source: 'blackbox-landscaper',
        type: 'save-manifest',
        payload: { manifest },
    }), '*')
})

// Open Terraformer
btnOpenTerraformer?.addEventListener('click', () => {
    window.parent.postMessage(JSON.stringify({
        source: 'blackbox-landscaper',
        type: 'request-terraformer',
        payload: {},
    }), '*')
})

// Return to World (without saving)
btnReturnWorld?.addEventListener('click', () => {
    window.parent.postMessage(JSON.stringify({
        source: 'blackbox-landscaper',
        type: 'close',
        payload: {},
    }), '*')
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

// Generate an initial scatter so the scene isn't empty
doScatter()

console.log(`BlackBox Landscaper — Dev Harness`)
console.log(`Species registered: ${registry.count}`)
console.log(`  ez-tree: ${ezTreeSpecies.length}`)
console.log(`  rock: ${rockSpecies.length}`)
console.log(`  billboard: ${registry.getByGenerator('billboard').length}`)
console.log(`  custom (palm/fern): ${registry.getByGenerator('palm').length + registry.getByGenerator('fern').length}`)

} // end initScene
