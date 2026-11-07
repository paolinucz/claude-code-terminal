// Adapter Angular: @angular/language-server, incluso nel pacchetto.
// Particolarità: parte solo nei progetti con angular.json, e cerca TypeScript e @angular/core
// prima nel progetto e poi nel pacchetto (--tsProbeLocations, --ngProbeLocations).
// Riceve i file .html e anche i .ts (manifest: «handles»), insieme al plugin TypeScript.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lspAdapter } from './cct-plugin-sdk.mjs'

const pkgDir = (ctx) => join(ctx.plugin.dir, 'server', 'node_modules', '@angular', 'language-server')
const pkg = (ctx) => JSON.parse(readFileSync(join(pkgDir(ctx), 'package.json'), 'utf8'))

lspAdapter({
  id: 'ngserver',
  name: (ctx) => `Angular Language Service ${pkg(ctx).version}`,
  rootMarkers: ['angular.json'],
  activationFiles: ['angular.json'],
  server: (ctx, root) => {
    const main = join(pkgDir(ctx), (pkg(ctx).main ?? 'index.js').replace(/^\.\//, ''))
    const probe = [join(root, 'node_modules'), join(ctx.plugin.dir, 'server', 'node_modules')].join(',')
    return ctx.node(main, ['--stdio', '--tsProbeLocations', probe, '--ngProbeLocations', probe])
  }
})
