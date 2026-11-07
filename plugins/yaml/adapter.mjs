// Adapter YAML: yaml-language-server, incluso nel pacchetto con le sue dipendenze.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lspAdapter } from './cct-plugin-sdk.mjs'

const pkgDir = (ctx) => join(ctx.plugin.dir, 'server', 'node_modules', 'yaml-language-server')

lspAdapter({
  id: 'yaml-ls',
  name: (ctx) => {
    try {
      return `YAML Language Server ${JSON.parse(readFileSync(join(pkgDir(ctx), 'package.json'), 'utf8')).version}`
    } catch {
      return 'YAML Language Server'
    }
  },
  rootMarkers: ['.git'],
  server: (ctx) => ctx.node(join(pkgDir(ctx), 'bin', 'yaml-language-server'), ['--stdio']),
  // Il server legge le impostazioni solo con workspace/didChangeConfiguration e workspace/configuration.
  settings: {
    yaml: {
      validate: true,
      hover: true,
      completion: true,
      format: { enable: true },
      schemaStore: { enable: true, url: 'https://www.schemastore.org/api/json/catalog.json' }
    }
  }
})
