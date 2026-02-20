declare module 'poisson-disk-sampling' {
    interface PoissonDiskSamplingOptions {
        shape: number[]
        minDistance: number
        maxDistance?: number
        tries?: number
        distanceFunction?: (point: number[]) => number
        bias?: number
    }

    class PoissonDiskSampling {
        constructor(options: PoissonDiskSamplingOptions, rng?: () => number)
        fill(): number[][]
        addRandomPoint(): number[]
        addPoint(point: number[]): number[] | null
        next(): number[] | null
    }

    export default PoissonDiskSampling
}
