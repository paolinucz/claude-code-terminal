// Adapter Java: Eclipse JDT Language Server con il JRE del plugin (scaricati all'installazione).
// Particolarità di jdtls gestite qui:
// - il jar di avvio ha la versione nel nome: si cerca nella cartella plugins;
// - una cartella «-data» per progetto (cache dell'importazione Maven/Gradle);
// - la notifica propria «language/status» mostra l'avanzamento dell'importazione.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { lspAdapter } from './cct-plugin-sdk.mjs'

// Java development pack (cct.java-dev): se è installato porta un JDK completo (jdtls ha bisogno di jdk.jdi per il debug,
// che il JRE non ha), il bundle java-debug e Lombok. I JDK dell'utente li scrive l'app in jdks.json (nella cartella dati del pack).
function pack(ctx) {
  const base = join(dirname(ctx.plugin.dir), 'cct.java-dev')
  const down = join(base, 'downloads')
  const file = (...p) => (existsSync(join(down, ...p)) ? join(down, ...p) : null)
  let runtimes = []
  try {
    const raw = JSON.parse(readFileSync(join(dirname(ctx.plugin.dataDir), 'cct.java-dev', 'jdks.json'), 'utf8'))
    runtimes = Array.isArray(raw) ? raw.filter((r) => r && r.name && r.path && existsSync(r.path)) : []
  } catch {}
  return { jdk: existsSync(join(down, 'jdk', 'bin', 'java.exe')) ? join(down, 'jdk') : null, debug: file('debug', 'java-debug.jar'), lombok: file('lombok', 'lombok.jar'), runtimes }
}

const settingsFor = (p) => ({
  java: {
    import: { maven: { enabled: true }, gradle: { enabled: true } },
    ...(p.runtimes.length ? { configuration: { runtimes: p.runtimes } } : {})
  }
})

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
  server: (ctx, root) => {
    const p = pack(ctx)
    // Con il pack: JDK completo del pack al posto del JRE, e Lombok come agente (compila e analizza i sorgenti con Lombok).
    const rt = p.jdk ? { command: join(p.jdk, 'bin', 'java.exe'), args: ['-Djavax.net.ssl.trustStoreType=Windows-ROOT'] } : null
    const args = [
      ...(p.lombok ? [`-javaagent:${p.lombok}`] : []),
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
    ]
    return rt ? { command: rt.command, args: [...rt.args, ...args] } : ctx.runtime('java', args)
  },
  initializationOptions: (ctx) => {
    const p = pack(ctx)
    return { settings: settingsFor(p), bundles: p.debug ? [p.debug] : [] }
  },
  settings: (ctx) => settingsFor(pack(ctx)),
  onNotification: {
    'language/status': (p, server) => server.setMessage(p?.message),
    'language/progressReport': (p, server) => p?.status && server.setMessage(p.status)
  }
})
