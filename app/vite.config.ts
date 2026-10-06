import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  build: {
    outDir: resolve(appDir, 'dist'),
    rollupOptions: {
      input: {
        main: resolve(appDir, 'main.ts'),
        preload: resolve(appDir, 'preload.ts'),
      },
      output: {
        format: 'cjs',
        entryFileNames: '[name].cjs',
      },
      external: ['electron'],
    },
    emptyOutDir: true,
    minify: false,
    target: 'node20',
    ssr: true,
  },
})
