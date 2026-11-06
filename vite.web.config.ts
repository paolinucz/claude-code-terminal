// Solo interfaccia, senza Electron: per vedere e provare la UI in un browser.
// Al posto del processo principale usa un archivio in localStorage (src/renderer/src/lib/api.ts).
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [react(), tailwindcss()],
  server: { port: 5199, strictPort: true }
})
