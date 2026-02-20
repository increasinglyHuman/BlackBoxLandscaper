/**
 * TerrainSampler — pluggable terrain height and slope queries.
 *
 * The scatter system needs terrain data but shouldn't care where it comes
 * from. This interface decouples scatter algorithms from terrain source.
 */

// ============================================================================
// INTERFACE
// ============================================================================

export interface TerrainSampler {
    /** Get terrain height at world position (x, z) */
    getHeight(x: number, z: number): number

    /**
     * Get terrain slope at world position in degrees.
     * 0 = flat, 90 = vertical wall.
     */
    getSlope(x: number, z: number): number
}

// ============================================================================
// IMPLEMENTATIONS
// ============================================================================

/** Flat terrain — constant height, zero slope. Used for unit tests. */
export class FlatTerrainSampler implements TerrainSampler {
    constructor(private height: number = 0) {}

    getHeight(_x: number, _z: number): number {
        return this.height
    }

    getSlope(_x: number, _z: number): number {
        return 0
    }
}

/**
 * Procedural terrain — matches the dev harness ground geometry.
 * Formula: y = sin(x * 0.05) * cos(z * 0.05) * 1.5
 */
export class ProceduralTerrainSampler implements TerrainSampler {
    getHeight(x: number, z: number): number {
        return Math.sin(x * 0.05) * Math.cos(z * 0.05) * 1.5
    }

    getSlope(x: number, z: number): number {
        return slopeFromSamples(this, x, z)
    }
}

/**
 * Heightmap terrain — samples .r32 heightmap data (Float32Array).
 * Uses bilinear interpolation for sub-cell positions.
 *
 * The .r32 format is a flat 256×256 grid of float32 values,
 * covering a regionSize × regionSize world area.
 */
export class HeightmapTerrainSampler implements TerrainSampler {
    constructor(
        private data: Float32Array,
        private resolution: number = 256,
        private regionSize: number = 256,
        private offsetX: number = 0,
        private offsetZ: number = 0
    ) {}

    getHeight(x: number, z: number): number {
        // Convert world position to heightmap coordinates
        const localX = x - this.offsetX
        const localZ = z - this.offsetZ
        const cellSize = this.regionSize / this.resolution

        const gx = localX / cellSize
        const gz = localZ / cellSize

        // Clamp to valid range
        const x0 = Math.max(0, Math.min(this.resolution - 2, Math.floor(gx)))
        const z0 = Math.max(0, Math.min(this.resolution - 2, Math.floor(gz)))
        const x1 = x0 + 1
        const z1 = z0 + 1

        // Fractional parts for interpolation
        const fx = gx - x0
        const fz = gz - z0

        // Sample four corners
        const h00 = this.data[z0 * this.resolution + x0]
        const h10 = this.data[z0 * this.resolution + x1]
        const h01 = this.data[z1 * this.resolution + x0]
        const h11 = this.data[z1 * this.resolution + x1]

        // Bilinear interpolation
        const h0 = h00 + (h10 - h00) * fx
        const h1 = h01 + (h11 - h01) * fx
        return h0 + (h1 - h0) * fz
    }

    getSlope(x: number, z: number): number {
        return slopeFromSamples(this, x, z)
    }
}

// ============================================================================
// SHARED UTILITIES
// ============================================================================

/**
 * Calculate slope from 3-point terrain sampling.
 * Same approach as SpatialDistributor (lines 618-630).
 *
 * Samples center, center+1 on X, center+1 on Z, computes gradient magnitude,
 * converts to degrees via atan.
 */
function slopeFromSamples(sampler: TerrainSampler, x: number, z: number): number {
    const sampleDist = 1.0
    const h0 = sampler.getHeight(x, z)
    const hX = sampler.getHeight(x + sampleDist, z)
    const hZ = sampler.getHeight(x, z + sampleDist)

    const dx = (hX - h0) / sampleDist
    const dz = (hZ - h0) / sampleDist

    return Math.atan(Math.sqrt(dx * dx + dz * dz)) * (180 / Math.PI)
}
