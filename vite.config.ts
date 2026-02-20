import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  // Library build: npm run build:lib (external three.js)
  if (mode === 'lib') {
    return {
      resolve: {
        alias: { '@landscaper': resolve(__dirname, 'src') },
      },
      build: {
        lib: {
          entry: resolve(__dirname, 'src/index.ts'),
          formats: ['es'],
          fileName: 'index',
        },
        rollupOptions: {
          external: [/^three/],
        },
        target: 'es2022',
        outDir: 'dist',
      },
    }
  }

  // App build: npm run build (bundles everything for deployment)
  return {
    base: '/landscaper/',
    resolve: {
      alias: { '@landscaper': resolve(__dirname, 'src') },
    },
    build: {
      target: 'es2022',
      outDir: 'dist-app',
    },
  }
})
