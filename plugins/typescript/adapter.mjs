// Adapter TypeScript e JavaScript: server nativo di TypeScript 7 (tsc --lsp), scaricato all'installazione.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lspAdapter } from './cct-plugin-sdk.mjs'

const tscDir = (ctx) => join(ctx.plugin.downloadsDir, 'tsc')

lspAdapter({
  id: 'tsc',
  name: (ctx) => {
    try {
      return `TypeScript ${JSON.parse(readFileSync(join(tscDir(ctx), 'package.json'), 'utf8')).version}`
    } catch {
      return 'TypeScript'
    }
  },
  rootMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json', '.git'],
  server: (ctx) => ({ command: join(tscDir(ctx), 'lib', 'tsc.exe'), args: ['--lsp', '--stdio'] })
})
