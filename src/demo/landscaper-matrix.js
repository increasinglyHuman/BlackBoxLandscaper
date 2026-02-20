/**
 * BlackBox Landscaper — Matrix Rain
 *
 * Themed matrix rain with vegetation, scatter, and terrain vocabulary.
 * Follows the shared BlackBox splash pattern (see Skinner, Animator, Legacy).
 */

export class LandscaperMatrix {
    constructor() {
        this.canvas = null
        this.ctx = null
        this.matrix = []
        this.drops = []
        this.fontSize = 14
        this.columns = 0
        this.animationId = null
        this.isActive = false
    }

    init() {
        this.canvas = document.createElement('canvas')
        this.canvas.id = 'matrixRainCanvas'
        this.canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; opacity: 0.6;'

        const welcomeScreen = document.getElementById('welcomeScreen')
        if (welcomeScreen) {
            welcomeScreen.insertBefore(this.canvas, welcomeScreen.firstChild)
        }

        this.ctx = this.canvas.getContext('2d')
        this.resize()

        // Landscaper-themed character set
        this.matrix = [
            '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
            '0.5', '0.8', '1.0', '256',
            'T', 'R', 'E', 'E',
            'O', 'A', 'K',
            'P', 'I', 'N', 'E',
            'F', 'E', 'R', 'N',
            'P', 'A', 'L', 'M',
            'S', 'C', 'A', 'T', 'T', 'E', 'R',
            'S', 'L', 'O', 'P', 'E',
            'B', 'I', 'O', 'M', 'E',
            'S', 'E', 'E', 'D',
            'L', 'O', 'D',
            '/', '\\', '|', '-', '_', '>', '<', '^',
            '~', '.', ':', '*', '#',
            '{', '}', '[', ']', '(', ')',
            '\u2207', '\u2248', '\u221E', '\u2206', '\u03B8',
            '\u2588', '\u2593', '\u2592', '\u2591', '\u25CF', '\u25CB',
            '\u03B1', '\u03B2', '\u03B3', '\u03B4', '\u03BB',
            '\u{1F331}', '\u{1F332}', '\u{1F333}', '\u{1F33F}', '\u{1F33E}',
            '\u{1F340}', '\u{1F341}', '\u{1F342}', '\u{1F343}',
        ]

        window.addEventListener('resize', () => this.resize())
    }

    resize() {
        this.canvas.width = window.innerWidth
        this.canvas.height = window.innerHeight
        this.columns = Math.floor(this.canvas.width / this.fontSize)

        this.drops = []
        for (let i = 0; i < this.columns; i++) {
            this.drops[i] = Math.random() * -100
        }
    }

    start() {
        if (this.isActive) return
        this.isActive = true
        this.animate()
    }

    stop() {
        this.isActive = false
        if (this.animationId) {
            cancelAnimationFrame(this.animationId)
        }
        if (this.canvas) {
            this.canvas.remove()
        }
    }

    animate() {
        if (!this.isActive) return

        this.ctx.fillStyle = 'rgba(10, 10, 10, 0.05)'
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

        this.ctx.fillStyle = '#66cc88'
        this.ctx.font = this.fontSize + 'px "Space Mono", monospace'

        for (let i = 0; i < this.drops.length; i++) {
            const char = this.matrix[Math.floor(Math.random() * this.matrix.length)]
            const x = i * this.fontSize
            const y = this.drops[i] * this.fontSize

            if (this.drops[i] > 0) {
                const gradient = this.ctx.createLinearGradient(0, y - 50, 0, y)
                gradient.addColorStop(0, 'rgba(102, 204, 136, 0)')
                gradient.addColorStop(0.5, 'rgba(102, 204, 136, 0.5)')
                gradient.addColorStop(1, 'rgba(102, 204, 136, 1)')
                this.ctx.fillStyle = gradient
            }

            this.ctx.fillText(char, x, y)

            if (this.drops[i] * this.fontSize > this.canvas.height && Math.random() > 0.975) {
                this.drops[i] = 0
            }

            this.drops[i]++
        }

        if (Math.random() < 0.001) {
            this.showSpecialMessage()
        }

        this.animationId = requestAnimationFrame(() => this.animate())
    }

    showSpecialMessage() {
        const messages = [
            'SCATTER THE FOREST',
            'POISSON DISK',
            'SEED = 42',
            'TERRAIN SAMPLING',
            'SLOPE CONSTRAINT',
            'CROSS-LAYER EXCLUSION',
            'PROCEDURAL WORLDS',
            'INSTANCED MESH',
            'BIOME: TEMPERATE',
            'BLACKBOX STUDIO',
            'POPULATE THE WORLD',
        ]

        const message = messages[Math.floor(Math.random() * messages.length)]
        const x = Math.random() * (this.canvas.width - message.length * this.fontSize)
        const y = Math.random() * this.canvas.height

        this.ctx.save()
        this.ctx.font = 'bold ' + (this.fontSize * 2) + 'px "Space Mono", monospace'
        this.ctx.fillStyle = '#fff'
        this.ctx.shadowColor = '#66cc88'
        this.ctx.shadowBlur = 20
        this.ctx.fillText(message, x, y)
        this.ctx.restore()
    }
}

export const landscaperMatrix = new LandscaperMatrix()
