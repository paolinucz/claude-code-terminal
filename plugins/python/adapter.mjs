// Adapter Python: Pyright (pacchetto npm autosufficiente, scaricato all'installazione).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lspAdapter } from './cct-plugin-sdk.mjs'

const pyrightDir = (ctx) => join(ctx.plugin.downloadsDir, 'pyright')

lspAdapter({
  id: 'pyright',
  name: (ctx) => {
    try {
      return `Pyright ${JSON.parse(readFileSync(join(pyrightDir(ctx), 'package.json'), 'utf8')).version}`
    } catch {
      return 'Pyright'
    }
  },
  rootMarkers: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'pyrightconfig.json', '.git'],
  server: (ctx) => ctx.node(join(pyrightDir(ctx), 'langserver.index.js'), ['--stdio']),
  settings: { python: { analysis: { autoSearchPaths: true, useLibraryCodeForTypes: true, diagnosticMode: 'openFilesOnly' } } }
})
