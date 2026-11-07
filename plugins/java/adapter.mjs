// Adapter Java: Eclipse JDT Language Server con il JRE del plugin (scaricati all'installazione).
// Particolarità di jdtls gestite qui:
// - il jar di avvio ha la versione nel nome: si cerca nella cartella plugins;
// - una cartella «-data» per progetto (cache dell'importazione Maven/Gradle);
// - la notifica propria «language/status» mostra l'avanzamento dell'importazione.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { lspAdapter } from './cct-plugin-sdk.mjs'

const settings = { java: { import: { maven: { enabled: true }, gradle: { enabled: true } } } }

function launcher(ctx) {
  const dir = join(ctx.plugin.downloadsDir, 'jdtls', 'plugins')
  const jar = readdirSync(dir).find((f) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(f))
  if (!jar) throw new Error('jar di avvio di jdtls non trovato: reinstalla il plugin Java.')
  return join(dir, jar)
}

lspAdapter({
  id: 'jdtls',
  name: 'Eclipse JDT Language Server',
  rootMarkers: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', '.project', '.git'],
  rootStrategy: 'outermost',
  server: (ctx, root) =>
    ctx.runtime('java', [
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '-Dlog.level=WARNING',
      '-Xms256m',
      '-Xmx1G',
      '--add-modules=ALL-SYSTEM',
      '--add-opens', 'java.base/java.util=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
      '-jar', launcher(ctx),
      // config_win contiene config.ini; jdtls ci scrive le sue cache (cartella dei download, esclusa dall'impronta).
      '-configuration', join(ctx.plugin.downloadsDir, 'jdtls', 'config_win'),
      '-data', join(ctx.dataDirFor(root), 'workspace')
    ]),
  initializationOptions: () => ({ settings }),
  settings,
  onNotification: {
    'language/status': (p, server) => server.setMessage(p?.message),
    'language/progressReport': (p, server) => p?.status && server.setMessage(p.status)
  }
})
