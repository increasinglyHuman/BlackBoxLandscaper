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
import { PalmGenerator } from '../generators/PalmGenerator.js'
import { FernGenerator } from '../generators/FernGenerator.js'
import { GrassGenerator } from '../generators/GrassGenerator.js'
import { KelpGenerator } from '../generators/KelpGenerator.js'
import { ScatterSystem } from '../scatter/ScatterSystem.js'
import { ProceduralTerrainSampler, HeightmapTerrainSampler, type TerrainSampler } from '../scatter/TerrainSampler.js'
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
let ground = new THREE.Mesh(groundGeo, groundMat)
ground.receiveShadow = true
scene.add(ground)

let gridHelper: THREE.GridHelper = new THREE.GridHelper(256, 16, 0x335533, 0x2a4a2a)
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
generators.set('palm', new PalmGenerator())
generators.set('fern', new FernGenerator())
generators.set('grass', new GrassGenerator())
generators.set('kelp', new KelpGenerator())

const treeGroup = new THREE.Group()
treeGroup.name = 'trees'
scene.add(treeGroup)

let treeCount = 0
let totalTriangles = 0

// ============================================================================
// UI ELEMENTS
// ============================================================================

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

// Populate species category dropdowns
const allSpecies = registry.getAll()
const ezTreeSpecies = allSpecies.filter(s => s.generator === 'ez-tree')
const palmFernSpecies = allSpecies.filter(s => s.generator === 'palm' || s.generator === 'fern')
const grassSpecies = allSpecies.filter(s => s.generator === 'grass')
const kelpSpecies = allSpecies.filter(s => s.generator === 'kelp')
const rockSpecies = allSpecies.filter(s => s.generator === 'rock')

const speciesSelectTrees = document.getElementById('species-select-trees') as HTMLSelectElement
const speciesSelectPalms = document.getElementById('species-select-palms') as HTMLSelectElement
const speciesSelectGrass = document.getElementById('species-select-grass') as HTMLSelectElement
const speciesSelectKelp = document.getElementById('species-select-kelp') as HTMLSelectElement
const speciesSelectRocks = document.getElementById('species-select-rocks') as HTMLSelectElement
const activeSpeciesLabel = document.getElementById('active-species-label')!

const categorySelects: HTMLSelectElement[] = [
    speciesSelectTrees, speciesSelectPalms, speciesSelectGrass,
    speciesSelectKelp, speciesSelectRocks,
]

function populateCategory(selectEl: HTMLSelectElement, species: typeof allSpecies, countId: string): void {
    for (const s of species) {
        const option = document.createElement('option')
        option.value = s.id
        option.textContent = s.displayName
        selectEl.appendChild(option)
    }
    const countEl = document.getElementById(countId)
    if (countEl) countEl.textContent = String(species.length)
}

populateCategory(speciesSelectTrees, ezTreeSpecies, 'cat-count-trees')
populateCategory(speciesSelectPalms, palmFernSpecies, 'cat-count-palms')
populateCategory(speciesSelectGrass, grassSpecies, 'cat-count-grass')
populateCategory(speciesSelectKelp, kelpSpecies, 'cat-count-kelp')
populateCategory(speciesSelectRocks, rockSpecies, 'cat-count-rocks')

speciesSelectTrees.value = 'oak'

// Track which category dropdown is active
let activeSpeciesSelect: HTMLSelectElement = speciesSelectTrees

function getActiveSpeciesId(): string {
    return activeSpeciesSelect.value
}

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
// ACCORDION SYSTEM — collapsible left-panel sections + species categories
// ============================================================================

// Map category IDs to their select elements
const categorySelectMap: Record<string, HTMLSelectElement> = {
    'trees': speciesSelectTrees,
    'palms-ferns': speciesSelectPalms,
    'grass': speciesSelectGrass,
    'kelp': speciesSelectKelp,
    'rocks': speciesSelectRocks,
}

// Main accordion banners — allow multiple open simultaneously
document.querySelectorAll<HTMLElement>('.accordion-banner').forEach(banner => {
    banner.addEventListener('click', () => {
        const section = banner.dataset.section!
        const content = document.querySelector(
            `.accordion-content[data-section="${section}"]`
        ) as HTMLElement
        if (!content) return

        const isExpanded = banner.classList.contains('expanded')
        if (isExpanded) {
            banner.classList.remove('expanded')
            content.style.display = 'none'
        } else {
            banner.classList.add('expanded')
            content.style.display = 'flex'
        }
    })
})

// Species category banners — mutually exclusive within Species section
document.querySelectorAll<HTMLElement>('.category-banner').forEach(catBanner => {
    catBanner.addEventListener('click', () => {
        const category = catBanner.dataset.category!

        // Collapse all category contents
        document.querySelectorAll<HTMLElement>('.category-banner').forEach(cb => {
            cb.classList.remove('active')
            const content = document.querySelector(
                `.category-content[data-category="${cb.dataset.category}"]`
            ) as HTMLElement
            if (content) content.style.display = 'none'
        })

        // Expand clicked category
        catBanner.classList.add('active')
        const content = document.querySelector(
            `.category-content[data-category="${category}"]`
        ) as HTMLElement
        if (content) content.style.display = ''

        // Switch active species select to this category
        const sel = categorySelectMap[category]
        if (sel) {
            activeSpeciesSelect = sel
            const species = registry.getById(sel.value)
            activeSpeciesLabel.textContent = species?.displayName ?? sel.value
            updatePreview()
        }
    })
})

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
    const speciesId = getActiveSpeciesId()
    const species = registry.getById(speciesId)
    if (!species) return

    // Update active species label below preview
    activeSpeciesLabel.textContent = species.displayName

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

// Wire up all category selects to update preview and become active
for (const sel of categorySelects) {
    sel.addEventListener('change', () => {
        activeSpeciesSelect = sel
        const species = registry.getById(sel.value)
        activeSpeciesLabel.textContent = species?.displayName ?? sel.value
        updatePreview()
    })
}
setTimeout(updatePreview, 100)

// ============================================================================
// SCATTER (unified: per-group × population)
// ============================================================================

const scatterSystem = new ScatterSystem()
let terrain: TerrainSampler = new ProceduralTerrainSampler()

let sampleGroundHeight = (x: number, z: number): number => {
    return Math.sin(x * 0.05) * Math.cos(z * 0.05) * 1.5
}

function doScatter(): void {
    const algorithm = algorithmSelect.value as DistributionAlgorithm
    const perGroup = parseInt(pergroupSlider.value) || 1
    const population = parseInt(populationSlider.value) || 25
    const speciesId = getActiveSpeciesId()

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
            const base = species.baseScale ?? 1
            output.object.scale.set(
                inst.scale.x * groupScale * base,
                inst.scale.y * groupScale * base,
                inst.scale.z * groupScale * base
            )

            output.object.userData = {
                speciesId: species.id,
                seed,
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

const modeIndicator = document.getElementById('mode-indicator')!
const modeLabel = modeIndicator.querySelector('.mode-label')!
const MODE_LABELS: Record<BrushMode, string> = {
    orbit: 'Orbit', paint: 'Paint', erase: 'Erase', select: 'Select',
}

function syncToolUI(mode: BrushMode): void {
    for (const [key, btn] of Object.entries(toolButtons)) {
        btn.classList.toggle('active', key === mode)
    }
    brushSizeRow.style.display = (mode === 'paint' || mode === 'erase') ? '' : 'none'

    // Update mode indicator badge
    modeIndicator.dataset.mode = mode
    modeLabel.textContent = MODE_LABELS[mode]
}

const brush = new BrushController({
    scene,
    camera,
    renderer,
    controls,
    ground,
    treeGroup,
    getSpecies: () => {
        const species = registry.getById(getActiveSpeciesId())
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

// ── Manifest types — matches VegetationConsumer.VegetationLayer format ───────

interface VegetationPreset {
    name: string       // Species ID (for display/logging)
    seed?: number      // Base seed from preset
    config?: any       // Full ez-tree preset config (inline, self-contained)
}

interface VegetationLayer {
    id: string
    presets: VegetationPreset[]
    /** Compact placements: [presetIdx, x, y, z, rotY, scale, seedOffset] */
    placements: number[][]
}

interface LandscaperManifest {
    version: '1.0'
    timestamp: string
    mode: 'replace' | 'additive' | 'subtractive'
    instanceId?: string
    instanceName?: string
    userId?: string
    userDisplayName?: string
    terrainAssetId?: string
    regionBounds: { type: 'bounds'; minX: number; maxX: number; minZ: number; maxZ: number }
    vegetation_layers: VegetationLayer[]
    stats: { treeCount: number; triangleCount: number; speciesCount: number }
}

/**
 * Recursively convert hex color strings ("0x448844") to numbers for tint fields.
 * opensim-species presets store tints as strings; BabylonTree expects numbers.
 */
function resolvePresetColors(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
        if (key === 'tint' && typeof value === 'string') {
            result[key] = parseInt(value.replace('0x', ''), 16)
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            result[key] = resolvePresetColors(value as Record<string, unknown>)
        } else {
            result[key] = value
        }
    }
    return result
}

function buildManifest(): LandscaperManifest {
    // Group trees by species, collecting compact placement data
    const speciesGroups = new Map<string, {
        species: any  // SpeciesDefinition
        placements: number[][]
    }>()

    for (const child of treeGroup.children) {
        const speciesId = child.userData.speciesId ?? 'unknown'
        const seed = child.userData.seed ?? 0

        if (!speciesGroups.has(speciesId)) {
            const species = registry.getById(speciesId)
            speciesGroups.set(speciesId, { species, placements: [] })
        }

        // Uniform scale (average of xyz) for compact encoding
        const avgScale = (child.scale.x + child.scale.y + child.scale.z) / 3

        speciesGroups.get(speciesId)!.placements.push([
            0,                   // presetIdx (one preset per layer, always 0)
            child.position.x,
            child.position.y,
            child.position.z,
            child.rotation.y,
            avgScale,
            seed,                // seedOffset = per-tree seed
        ])
    }

    // Build vegetation layers in VegetationConsumer format
    const vegetation_layers: VegetationLayer[] = []
    for (const [speciesId, group] of speciesGroups) {
        // Resolve hex string tints → numbers before serializing to manifest
        const rawConfig = group.species?.preset
        const presets: VegetationPreset[] = [{
            name: speciesId,
            config: rawConfig ? resolvePresetColors(rawConfig) : undefined,
        }]

        vegetation_layers.push({
            id: `layer-${speciesId}`,
            presets,
            placements: group.placements,
        })
    }

    const modeSelect = document.getElementById('manifest-mode') as HTMLSelectElement | null
    const mode = (modeSelect?.value || 'replace') as 'replace' | 'additive' | 'subtractive'
    const bounds = worldContext?.regionBounds || { minX: -128, maxX: 128, minZ: -128, maxZ: 128 }

    return {
        version: '1.0',
        timestamp: new Date().toISOString(),
        mode,
        instanceId: worldContext?.instanceId,
        instanceName: worldContext?.instanceName,
        userId: worldContext?.userId,
        userDisplayName: worldContext?.userDisplayName,
        terrainAssetId: worldContext?.terrainAssetId,
        regionBounds: { type: 'bounds', ...bounds },
        vegetation_layers,
        stats: { treeCount, triangleCount: totalTriangles, speciesCount: vegetation_layers.length },
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
// WORLD CONTEXT — identity, instance, terrain state
// ============================================================================

interface WorldContext {
    instanceId: string
    instanceName: string
    userId: string
    userDisplayName: string
    regionBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
    terrainAssetId?: string
    waterHeight?: number
    terrainOrigin?: string
    biome?: string
}

let worldContext: WorldContext | null = null

/** Update the right drawer context display */
function updateDrawerContext(): void {
    const ctxName = document.getElementById('ctx-instance-name')
    const ctxUser = document.getElementById('ctx-user-name')
    if (worldContext) {
        if (ctxName) {
            ctxName.textContent = worldContext.instanceName || worldContext.instanceId
            ctxName.classList.remove('placeholder')
        }
        if (ctxUser) {
            ctxUser.textContent = worldContext.userDisplayName || worldContext.userId
            ctxUser.classList.remove('placeholder')
        }
    }
}

/** Also check URL params as fallback (Terraformer pattern) */
function parseUrlContext(): void {
    const params = new URLSearchParams(window.location.search)
    const instanceId = params.get('instance')
    if (instanceId) {
        worldContext = {
            instanceId,
            instanceName: params.get('name') || instanceId,
            userId: params.get('userId') || '',
            userDisplayName: params.get('displayName') || '',
            regionBounds: {
                minX: -128, maxX: 128, minZ: -128, maxZ: 128,
            },
        }
        updateDrawerContext()
        console.log('[Landscaper] Context from URL params:', worldContext)
    }
}

// ============================================================================
// TERRAIN LOADING — decode heightmap from postMessage (PNG or Float32Array)
// ============================================================================

/**
 * Decode a base64 PNG heightmap into Float32Array of actual heights.
 * PNG encodes heights as 16-bit RG channels (auto-detects 8-bit grayscale).
 * Returns normalized 0-1 values scaled by elevation.
 */
function decodePNGHeightmap(
    base64Data: string, minHeight: number, maxHeight: number,
): Promise<{ heights: Float32Array; width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = img.width
            canvas.height = img.height
            const ctx = canvas.getContext('2d')!
            ctx.drawImage(img, 0, 0)

            const imageData = ctx.getImageData(0, 0, img.width, img.height)
            const heights = new Float32Array(img.width * img.height)

            // Auto-detect 16-bit (RG channels) vs 8-bit (grayscale)
            let is16Bit = false
            const sampleSize = Math.min(100, imageData.data.length / 4)
            for (let i = 0; i < sampleSize; i++) {
                if (imageData.data[i * 4 + 1] > 0 && imageData.data[i * 4] !== imageData.data[i * 4 + 1]) {
                    is16Bit = true
                    break
                }
            }

            const range = maxHeight - minHeight
            console.log(`[Landscaper] PNG heightmap: ${img.width}x${img.height}, ${is16Bit ? '16-bit RG' : '8-bit grayscale'}, height range: ${minHeight.toFixed(1)}–${maxHeight.toFixed(1)}m`)

            for (let i = 0; i < heights.length; i++) {
                let normalized: number
                if (is16Bit) {
                    const hi = imageData.data[i * 4]
                    const lo = imageData.data[i * 4 + 1]
                    normalized = ((hi << 8) | lo) / 65535.0
                } else {
                    normalized = imageData.data[i * 4] / 255.0
                }
                heights[i] = minHeight + normalized * range
            }

            URL.revokeObjectURL(img.src)
            resolve({ heights, width: img.width, height: img.height })
        }
        img.onerror = () => reject(new Error('[Landscaper] Failed to decode PNG heightmap'))

        const binary = atob(base64Data)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i)
        }
        img.src = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
    })
}

/**
 * Load real terrain from postMessage payload.
 *
 * Handles three envelope formats:
 *  - NEXUS response: { terrain_asset_id, terrain_data: {...BBT...} }
 *  - Spec wrapper:   { terrainAssetId, terrain: {...heightmap_v1...} }
 *  - Direct:         {...heightmap_v1...} or {...BBT...}
 *
 * Handles two data encodings:
 *  - Base64-encoded PNG (BBT format, 16-bit RG channels)
 *  - Base64-encoded Float32Array (canonical heightmap_v1)
 */
async function loadRealTerrain(terrainPayload: any): Promise<void> {
    // --- Unwrap envelope ---
    const terrainData = terrainPayload.terrain_data
        || terrainPayload.terrain
        || terrainPayload

    // Store terrain asset ID
    const assetId = terrainPayload.terrain_asset_id || terrainPayload.terrainAssetId
    if (assetId && worldContext) {
        worldContext.terrainAssetId = assetId
    }

    if (!terrainData?.data) {
        console.warn('[Landscaper] Invalid terrain payload — missing heightmap data')
        return
    }

    const dataStr = terrainData.data as string
    const isCanonical = terrainData.format === 'heightmap_v1' || Array.isArray(terrainData.resolution)
    const isPNG = dataStr.startsWith('iVBOR')

    // --- Decode heightmap + determine grid dimensions ---
    let heights: Float32Array
    let cols: number
    let rows: number

    if (isPNG) {
        // BBT format: base64-encoded PNG heightmap
        // Match BBTLoader's dual-mode height detection (ADR-018):
        //   heightRange.max > 1.5 → world-space (BBT files): use min..max directly
        //   heightRange.max <= 1.5 → normalized (NEXUS): scale by elevation ceiling
        const heightRange = terrainData.stats?.heightRange
        const elevation = terrainData.terrain?.elevation
            || terrainData.elevation || 50

        let minHeight = 0
        let maxHeight = elevation
        if (heightRange && heightRange.max > 1.5) {
            minHeight = heightRange.min ?? 0
            maxHeight = heightRange.max
        }

        const decoded = await decodePNGHeightmap(dataStr, minHeight, maxHeight)
        heights = decoded.heights
        cols = decoded.width
        rows = decoded.height
    } else if (isCanonical) {
        // Canonical heightmap_v1: base64-encoded Float32Array
        const bytes = Uint8Array.from(atob(dataStr), (c: string) => c.charCodeAt(0))
        heights = new Float32Array(bytes.buffer)
        ;[cols, rows] = terrainData.resolution
    } else {
        // Unknown format — try Float32Array with derived dimensions
        const bytes = Uint8Array.from(atob(dataStr), (c: string) => c.charCodeAt(0))
        heights = new Float32Array(bytes.buffer)
        const subs = terrainData.terrain?.subdivisions || terrainData.subdivisions || 256
        cols = subs + 1
        rows = subs + 1
    }

    // --- Determine bounds ---
    let bounds = terrainData.bounds
    if (!bounds) {
        const size = terrainData.terrain?.size || terrainData.size || 256
        const half = size / 2
        bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half }
    }

    const sizeX = bounds.maxX - bounds.minX
    const sizeZ = bounds.maxZ - bounds.minZ

    console.log(`[Landscaper] Loading terrain: ${cols}x${rows}, bounds: ${sizeX}x${sizeZ}m, ${heights.length} values, format: ${isPNG ? 'PNG' : 'Float32Array'}`)

    // Remove existing ground + grid
    scene.remove(ground)
    ground.geometry.dispose()
    scene.remove(gridHelper)

    // Build new geometry from heightmap
    const newGeo = new THREE.PlaneGeometry(sizeX, sizeZ, cols - 1, rows - 1)
    newGeo.rotateX(-Math.PI / 2)

    const terrainPosAttr = newGeo.getAttribute('position')
    const expectedVerts = cols * rows

    if (terrainPosAttr.count !== expectedVerts) {
        console.warn(`[Landscaper] Vertex mismatch: geometry has ${terrainPosAttr.count}, heightmap has ${expectedVerts}`)
    }

    const vertCount = Math.min(terrainPosAttr.count, heights.length)
    for (let i = 0; i < vertCount; i++) {
        terrainPosAttr.setY(i, heights[i])
    }
    newGeo.computeVertexNormals()

    // Apply splatmap texture if available (BBT terrain_data.splatmap.data)
    // Splatmap is a blend map: R=low(grass), G=mid(dirt), B=high(rock), peak=1-(R+G+B)/255
    // Composite into a visible color image for the Landscaper preview
    if (terrainData.splatmap?.data) {
        try {
            const splatB64 = terrainData.splatmap.data as string
            const splatBin = atob(splatB64)
            const splatBytes = new Uint8Array(splatBin.length)
            for (let i = 0; i < splatBin.length; i++) {
                splatBytes[i] = splatBin.charCodeAt(i)
            }
            const splatBlob = new Blob([splatBytes], { type: 'image/png' })
            const splatImg = new Image()
            splatImg.onload = () => {
                // Decode splatmap pixels
                const cv = document.createElement('canvas')
                cv.width = splatImg.width
                cv.height = splatImg.height
                const ctx = cv.getContext('2d')!
                ctx.drawImage(splatImg, 0, 0)
                const imgData = ctx.getImageData(0, 0, cv.width, cv.height)
                const px = imgData.data

                // Biome layer colors (typical BBT terrain)
                const biome = (terrainData.terrain?.biome || terrainData.biome || 'grassland') as string
                let lowR = 74, lowG = 124, lowB = 63    // grass green
                let midR = 139, midG = 115, midB = 85   // dirt brown
                let hiR = 136, hiG = 136, hiB = 136     // rock gray
                let pkR = 220, pkG = 220, pkB = 225     // snow white

                if (biome === 'desert' || biome === 'arid') {
                    lowR = 194; lowG = 178; lowB = 128  // sand
                    midR = 160; midG = 120; midB = 80   // dry dirt
                    hiR = 120; hiG = 100; hiB = 80      // sandstone
                    pkR = 200; pkG = 180; pkB = 140     // light sand
                } else if (biome === 'arctic' || biome === 'tundra' || biome === 'snow') {
                    lowR = 180; lowG = 200; lowB = 180  // pale grass
                    midR = 160; midG = 160; midB = 170  // frozen dirt
                    hiR = 100; hiG = 100; hiB = 110     // dark rock
                    pkR = 240; pkG = 245; pkB = 250     // snow
                }

                // Composite: blend layer colors by splatmap weights
                for (let i = 0; i < px.length; i += 4) {
                    const r = px[i]! / 255    // low weight
                    const g = px[i+1]! / 255  // mid weight
                    const b = px[i+2]! / 255  // high weight
                    const pk = Math.max(0, 1 - r - g - b)  // peak weight

                    px[i]   = Math.min(255, lowR * r + midR * g + hiR * b + pkR * pk) | 0
                    px[i+1] = Math.min(255, lowG * r + midG * g + hiG * b + pkG * pk) | 0
                    px[i+2] = Math.min(255, lowB * r + midB * g + hiB * b + pkB * pk) | 0
                    px[i+3] = 255
                }

                ctx.putImageData(imgData, 0, 0)
                const tex = new THREE.CanvasTexture(cv)
                tex.colorSpace = THREE.SRGBColorSpace
                tex.wrapS = THREE.ClampToEdgeWrapping
                tex.wrapT = THREE.ClampToEdgeWrapping
                groundMat.map = tex
                groundMat.color.set(0xffffff)
                groundMat.needsUpdate = true
                URL.revokeObjectURL(splatImg.src)
                console.log(`[Landscaper] Splatmap composited (${biome} palette, ${cv.width}x${cv.height})`)
            }
            splatImg.src = URL.createObjectURL(splatBlob)
        } catch (e) {
            console.warn('[Landscaper] Failed to decode splatmap:', e)
        }
    }

    // Replace ground mesh
    ground = new THREE.Mesh(newGeo, groundMat)
    ground.receiveShadow = true
    scene.add(ground)

    // Rebuild grid helper
    const gridDivisions = Math.max(8, Math.round(sizeX / 16))
    gridHelper = new THREE.GridHelper(Math.max(sizeX, sizeZ), gridDivisions, 0x335533, 0x2a4a2a)
    gridHelper.position.y = 0.05
    ;(gridHelper.material as THREE.Material).opacity = 0.3
    ;(gridHelper.material as THREE.Material).transparent = true
    scene.add(gridHelper)

    // Update terrain sampler for scatter system + brush
    // offsetX/Z = world-space origin (min corner) of the heightmap grid
    const regionSize = Math.max(sizeX, sizeZ)
    const heightmapSampler = new HeightmapTerrainSampler(heights, cols, regionSize, bounds.minX, bounds.minZ)

    // Replace both the scatter terrain reference and the height sampling function
    terrain = heightmapSampler
    sampleGroundHeight = (x: number, z: number) => heightmapSampler.getHeight(x, z)

    // Update brush controller's ground reference
    brush.updateGround(ground)

    // Update terrain info in left panel
    const terrainInfo = document.getElementById('terrain-info')
    if (terrainInfo) {
        const biome = terrainData.terrain?.biome || terrainData.biome || 'custom'
        const hRange = terrainData.stats?.heightRange || terrainData.heightRange
        const rangeStr = hRange ? ` (${Number(hRange.min).toFixed(1)}–${Number(hRange.max).toFixed(1)}m)` : ''

        // Show provenance from init-context
        const origin = worldContext?.terrainOrigin
        const originStr = origin && origin !== 'none'
            ? `<br><span style="color:#888">${origin === 'bbt' ? 'Created in Terraformer' : origin} · active in poqpoq</span>`
            : ''

        // Show water height if available
        const waterStr = worldContext?.waterHeight != null && worldContext.waterHeight !== 0
            ? `<br>Water: ${Number(worldContext.waterHeight).toFixed(1)}m`
            : ''

        terrainInfo.innerHTML = `${sizeX}&times;${sizeZ}m &mdash; ${biome} terrain${rangeStr}${originStr}${waterStr}<br>Grid: ${gridDivisions} divisions`
    }

    console.log(`[Landscaper] Terrain loaded successfully`)
}

// ============================================================================
// POSTMESSAGE BRIDGE (only when embedded in World)
// ============================================================================

const terrainLoadingEl = document.getElementById('terrain-loading')
const terrainLoadingMsg = document.getElementById('terrain-loading-msg')

function showTerrainLoading(msg: string): void {
    if (terrainLoadingMsg) terrainLoadingMsg.textContent = msg
    terrainLoadingEl?.classList.add('visible')
}

function hideTerrainLoading(): void {
    terrainLoadingEl?.classList.remove('visible')
}

function setupPostMessageBridge(): void {
    // Show loading indicator — we're embedded and waiting for World to send terrain
    showTerrainLoading('Waiting for terrain from World...')

    window.addEventListener('message', (event: MessageEvent) => {
        let msg: any
        try {
            msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        } catch { return }

        if (msg?.source !== 'blackbox-world') return

        switch (msg.type) {
            case 'init-context':
                console.log('[Landscaper] Received context from World:', msg.payload)
                worldContext = msg.payload as WorldContext
                updateDrawerContext()
                showTerrainLoading(`Loading terrain for ${worldContext.instanceName || 'instance'}...`)
                break
            case 'terrain-data':
                console.log('[Landscaper] Received terrain data from World')
                showTerrainLoading('Decoding terrain...')
                loadRealTerrain(msg.payload).then(() => {
                    hideTerrainLoading()
                }).catch(err => {
                    console.error('[Landscaper] Failed to load terrain:', err)
                    showTerrainLoading('Terrain load failed — using default')
                    setTimeout(hideTerrainLoading, 4000)
                })
                break
        }
    })

    // Also check URL params (Terraformer pattern fallback)
    parseUrlContext()

    // Announce readiness to World parent
    window.parent.postMessage(JSON.stringify({
        source: 'blackbox-landscaper',
        type: 'ready',
        payload: { version: '0.2.0' },
    }), '*')
}

if (isEmbedded) {
    setupPostMessageBridge()
}

// ============================================================================
// RIGHT DRAWER — toggle + world action handlers
// ============================================================================

const rightDrawer = document.getElementById('right-drawer')
const drawerToggle = document.getElementById('drawer-toggle')
const drawerFeedback = document.getElementById('drawer-feedback')

drawerToggle?.addEventListener('click', () => {
    rightDrawer?.classList.toggle('open')
})

// Auto-open drawer when embedded so user sees World integration immediately
if (isEmbedded) {
    rightDrawer?.classList.add('open')
}

/** Show inline success/error dialog in the drawer */
function showDrawerDialog(type: 'success' | 'error', title: string, message: string, details?: string[]): void {
    if (!drawerFeedback) return

    const detailRows = (details || []).map(d => `<div class="dialog-detail-row">${d}</div>`).join('')

    drawerFeedback.innerHTML = `
        <div class="drawer-dialog drawer-dialog--${type} visible">
            <div class="dialog-icon">${type === 'success' ? '&#x2714;' : '&#x26A0;'}</div>
            <div class="dialog-title">${title}</div>
            <div class="dialog-message">${message}</div>
            ${detailRows ? `<div class="dialog-details">${detailRows}</div>` : ''}
            <div class="dialog-actions">
                <button class="dialog-btn-done" id="dialog-dismiss">Done</button>
            </div>
        </div>
    `
    drawerFeedback.style.display = ''
    document.getElementById('dialog-dismiss')?.addEventListener('click', () => {
        drawerFeedback.style.display = 'none'
        drawerFeedback.innerHTML = ''
    })
}

// Send to poqpoq (hero button)
btnSaveWorld?.addEventListener('click', () => {
    if (!worldContext?.instanceId) {
        showDrawerDialog('error', 'No World Context', 'Cannot send vegetation — no instance context received from poqpoq World.')
        return
    }

    const manifest = buildManifest()
    window.parent.postMessage(JSON.stringify({
        source: 'blackbox-landscaper',
        type: 'save-manifest',
        payload: manifest,
    }), '*')

    const name = worldContext.instanceName || worldContext.instanceId
    showDrawerDialog('success', 'Vegetation Sent', `Your vegetation for <strong>${name}</strong> has been sent to poqpoq World.`, [
        `&#x1F333; ${manifest.stats.treeCount} objects across ${manifest.stats.speciesCount} species`,
        `&#x1F4D0; ${manifest.stats.triangleCount.toLocaleString()} triangles`,
        `&#x1F4CB; Mode: ${manifest.mode}`,
    ])
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
        type: 'tool_close',
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

// Generate an initial scatter so the scene isn't empty (standalone only)
if (!isEmbedded) {
    doScatter()
}

console.log(`BlackBox Landscaper — Dev Harness`)
console.log(`Species registered: ${registry.count}`)
console.log(`  ez-tree: ${ezTreeSpecies.length}`)
console.log(`  palm: ${registry.getByGenerator('palm').length}`)
console.log(`  fern: ${registry.getByGenerator('fern').length}`)
console.log(`  grass: ${grassSpecies.length}`)
console.log(`  kelp: ${kelpSpecies.length}`)
console.log(`  rock: ${rockSpecies.length}`)

} // end initScene
