// Adapter Maven (e XML): LemMinX con l'estensione lemminx-maven, eseguiti con il runtime «java»
// fornito dal plugin Java. I jar sono nella cartella server del pacchetto.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { lspAdapter } from './cct-plugin-sdk.mjs'

const settings = { xml: { validation: { enabled: true }, format: { enabled: true } } }

lspAdapter({
  id: 'lemminx',
  name: (ctx) => {
    const jar = readdirSync(join(ctx.plugin.dir, 'server')).find((j) => /^org\.eclipse\.lemminx-[\d.]+\.jar$/.test(j))
    return `LemMinX ${jar?.match(/-([\d.]+)\.jar$/)?.[1] ?? ''}`.trim()
  },
  rootMarkers: ['pom.xml', '.git'],
  rootStrategy: 'outermost',
  server: (ctx) => ctx.runtime('java', ['-Xmx512m', '-cp', join(ctx.plugin.dir, 'server', '*'), 'org.eclipse.lemminx.XMLServerLauncher']),
  initializationOptions: () => ({ settings }),
  settings
})
