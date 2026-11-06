import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = {
  '@': resolve(__dirname, 'src/renderer/src'),
  '@shared': resolve(__dirname, 'src/shared')
}

export default defineConfig({
  // In electron-vite 6 le dipendenze di main e preload sono esterne di default (build.externalizeDeps).
  main: {
    resolve: { alias }
  },
  preload: {
    resolve: { alias }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    }
  }
})
