// Adapter del plugin Java (cct.java): un solo processo con tutto ciò che riguarda Java, e l'app non ne sa niente.
// - language server (jdtls): completamento, errori, importazione Maven e Gradle, con il JDK del plugin;
// - motore di esecuzione: servizi Maven/Gradle, JDK, run configuration, combo, debug (java-debug dentro jdtls),
//   importazione da IntelliJ.
// Il motore parla con jdtls direttamente (stesso processo), non più da un plugin all'altro.
// L'app gli dà solo impostazioni, terminali, eventi per le sue pagine e l'apertura di indirizzi.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { lspAdapter, type AdapterApp, type AdapterContext, type GutterMarkerOut, type LspBridge } from './cct-plugin-sdk.mjs'
import { JavaDevService } from './JavaDevService.mts'
import type { Combo, ComboStep, DebugState, JavaBreakpoint, RunConfig } from './types.mts'

/** Impostazioni del plugin: tutte con il prefisso «java.» dichiarato nel manifest (i dati già salvati restano). */
const KEYS = ['java.runConfigs', 'java.defaultJdk', 'java.serviceJdk', 'java.serviceSettings', 'java.combos', 'java.breakpoints']

const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

let svc: JavaDevService
let app: AdapterApp
/** Impostazioni in memoria: l'adapter è l'unico a scriverle, la scrittura nell'app è in coda. */
const cache = new Map<string, unknown>()
/** File su cui l'ultima volta abbiamo messo segni nel margine, per toglierli quando non servono più. */
let painted = new Set<string>()

function breakpoints(): Record<string, JavaBreakpoint[]> {
  return svc.breakpoints()
}

/** Chiave con cui un file è già nei breakpoint (stesso percorso scritto in modo diverso), altrimenti il percorso dato. */
function keyFor(file: string): string {
  return Object.keys(breakpoints()).find((f) => norm(f) === norm(file)) ?? file
}

/** Segni nel margine: breakpoint (spenti se disattivati o non verificati dal debugger) e riga in cui il programma è fermo. */
function paintMarkers(): void {
  const dbg: DebugState = svc.debugState()
  const live = dbg.status === 'running' || dbg.status === 'paused'
  const byFile = new Map<string, GutterMarkerOut[]>()
  const add = (file: string, m: GutterMarkerOut) => byFile.set(file, [...(byFile.get(file) ?? []), m])
  for (const [file, list] of Object.entries(breakpoints())) {
    const verifiedKey = Object.keys(dbg.verified).find((f) => norm(f) === norm(file))
    const ok = verifiedKey ? new Set(dbg.verified[verifiedKey]) : null
    for (const b of list) {
      const unverified = live && ok !== null && !ok.has(b.line)
      add(file, { line: b.line, kind: !b.enabled || unverified ? 'breakpoint-disabled' : 'breakpoint', hint: unverified ? 'Breakpoint non verificato dal debugger' : b.condition ? `Breakpoint: ${b.condition}` : 'Breakpoint' })
    }
  }
  const top = dbg.frames[0]
  if (dbg.status === 'paused' && top?.path) add(top.path, { line: top.line, kind: 'stopped', hint: 'Il programma è fermo qui', reveal: true })
  const now = new Set<string>()
  for (const [file, markers] of byFile) {
    app.editor.markers(file, markers)
    now.add(file)
  }
  for (const file of painted) if (!now.has(file)) app.editor.markers(file, [])
  painted = now
}

/** Clic nel margine: aggiunge o toglie il breakpoint di quella riga. */
async function toggleBreakpoint(file: string, line: number): Promise<void> {
  const key = keyFor(file)
  const list = breakpoints()[key] ?? []
  const next = list.some((b) => b.line === line) ? list.filter((b) => b.line !== line) : [...list, { line, enabled: true }].sort((x, y) => x.line - y.line)
  await svc.setBreakpoints(key, next)
  paintMarkers()
  app.emit('breakpoints', breakpoints())
}

/** Avvia il motore di esecuzione (chiamato dall'estensione dell'adapter LSP, con il ponte verso jdtls). */
async function startService(ctx: AdapterContext, lsp: LspBridge): Promise<void> {
    for (const k of KEYS) cache.set(k, await app.settings.get(k).catch(() => null))
    // I JDK scaricati stanno in <dati dell'app>/jdks; i dati del plugin sono <dati>/plugin-data/<id>.
    const userData = dirname(dirname(ctx.plugin.dataDir))
    svc = new JavaDevService({
      getSetting: (k) => cache.get(k) ?? undefined,
      setSetting: (k, v) => {
        cache.set(k, v)
        void app.settings.set(k, v).catch((e) => app.log('warn', `Impostazione non salvata (${k}): ${e?.message ?? e}`))
      },
      userDataDir: userData,
      packDataDir: () => ctx.plugin.dataDir,
      packActive: () => true,
      lsp: (method, params) => lsp.call(method, params),
      createTask: (req) => app.session.create({ ...req }),
      // Un programma lanciato da una run configuration va mostrato subito in un terminale: senza una vista la sessione
      // sparirebbe appena finisce e non si vedrebbero l'avvio, gli errori né i log. Le combo li raccolgono nell'alveare
      // (permesso `terminal`).
      showTerminal: (id) => app.terminal.show(id),
      showHive: (key, title, ids) => app.terminal.hive(key, title, ids),
      emitCombo: (run) => app.emit('combo', run),
      killSession: (id) => void app.session.kill(id).catch(() => {}),
      sessionStatus: async (id) => (await app.session.status(id)) ?? undefined,
      emitDebug: (s) => {
        app.emit('debug', s)
        paintMarkers()
      },
      emitOutput: (o) => app.emit('output', o),
      emitProgress: (p) => app.emit('progress', p),
      emitState: () => app.emit('state', null)
    })
    paintMarkers()
}

/** Richieste delle pagine del plugin (e clic nel margine dell'editor): un metodo per ogni funzione del servizio. */
async function dispatch(method: string, p: Record<string, any>): Promise<unknown> {
    switch (method) {
      case 'state': return svc.state(String(p.root ?? ''), Boolean(p.fresh))
      case 'setDefaultJdk': return svc.setDefaultJdk((p.id as string | null) ?? null)
      case 'setServiceJdk': return svc.setServiceJdk(String(p.root), (p.id as string | null) ?? null)
      case 'downloadJdk': return svc.downloadJdk(Number(p.major))
      // Combo: più servizi avviati insieme, nell'ordine scelto, con i preset.
      case 'saveCombo': return svc.saveCombo(p.combo as Combo)
      case 'deleteCombo': return svc.deleteCombo(String(p.id))
      case 'runCombo': return svc.runCombo({ steps: p.steps as ComboStep[], name: p.name as string | undefined, id: p.id as string | undefined, workspace: String(p.workspace ?? '') })
      case 'stopCombo': return svc.stopCombo()
      case 'dismissCombo': return svc.dismissCombo()
      // Maven, Gradle e variabili d'ambiente per servizio.
      case 'setServiceSettings': return svc.setServiceSettings(String(p.root), { maven: p.maven as string | null | undefined, gradle: p.gradle as string | null | undefined, env: p.env as Record<string, string> | null | undefined })
      case 'toolVersions': return svc.toolVersions(p.kind as 'maven' | 'gradle')
      case 'downloadTool': return svc.downloadBuildTool(p.kind as 'maven' | 'gradle', String(p.version))
      case 'removeTool': return svc.removeBuildTool(p.kind as 'maven' | 'gradle', String(p.version))
      case 'removeJdk': return svc.removeJdk(String(p.id))
      case 'saveConfig': return svc.saveConfig(p.config as RunConfig)
      case 'deleteConfig': return svc.deleteConfig(String(p.id))
      case 'importIdea': return svc.importIdea(String(p.root))
      case 'run': return svc.run(String(p.id), String(p.workspace ?? ''))
      case 'debug': return svc.debug(String(p.id), String(p.workspace ?? ''))
      case 'debugState': return svc.debugState()
      case 'control': return svc.control(p.action as 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut')
      case 'stop': return svc.stop()
      case 'restart': return svc.restart()
      case 'scopes': return svc.scopes(Number(p.frameId)).catch(() => [])
      case 'variables': return svc.variables(Number(p.ref)).catch(() => [])
      case 'evaluate': return svc.evaluate(String(p.expression), p.frameId === undefined ? undefined : Number(p.frameId))
      case 'breakpoints': return svc.breakpoints()
      case 'setBreakpoints': {
        await svc.setBreakpoints(keyFor(String(p.file)), Array.isArray(p.list) ? (p.list as JavaBreakpoint[]) : [])
        paintMarkers()
        app.emit('breakpoints', breakpoints())
        return null
      }
      case 'gutter.click': return toggleBreakpoint(String(p.path), Number(p.line))
      default: throw new Error(`Metodo non gestito: ${method}`)
    }
}

// ---------------------------------------------------------------- language server (jdtls)

/** Cosa porta il pacchetto nella sua cartella dei download: JDK completo, bundle java-debug, Lombok; più i JDK dell'utente. */
function bundle(ctx: AdapterContext) {
  const down = ctx.plugin.downloadsDir
  const file = (...p: string[]) => (existsSync(join(down, ...p)) ? join(down, ...p) : null)
  let runtimes: { name: string; path: string; default?: boolean }[] = []
  try {
    // I JDK dell'utente li scrive il motore di esecuzione in jdks.json (nella cartella dati del plugin), jdtls li legge all'avvio.
    const raw = JSON.parse(readFileSync(join(ctx.plugin.dataDir, 'jdks.json'), 'utf8'))
    runtimes = Array.isArray(raw) ? raw.filter((r) => r && r.name && r.path && existsSync(r.path)) : []
  } catch {
    // nessun elenco: jdtls usa il suo JDK
  }
  return { jdk: existsSync(join(down, 'jdk', 'bin', 'java.exe')) ? join(down, 'jdk') : null, debug: file('debug', 'java-debug.jar'), lombok: file('lombok', 'lombok.jar'), runtimes }
}

const settingsFor = (b: ReturnType<typeof bundle>) => ({
  java: {
    import: { maven: { enabled: true }, gradle: { enabled: true } },
    ...(b.runtimes.length ? { configuration: { runtimes: b.runtimes } } : {})
  }
})

function launcher(ctx: AdapterContext): string {
  const dir = join(ctx.plugin.downloadsDir, 'jdtls', 'plugins')
  const jar = readdirSync(dir).find((f) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(f))
  if (!jar) throw new Error('jar di avvio di jdtls non trovato: reinstalla il plugin Java.')
  return join(dir, jar)
}

// Particolarità di jdtls gestite qui: il jar di avvio ha la versione nel nome; una cartella «-data» per progetto (cache
// dell'importazione Maven/Gradle); la notifica propria «language/status» mostra l'avanzamento dell'importazione.
lspAdapter({
  id: 'jdtls',
  name: 'Eclipse JDT Language Server',
  rootMarkers: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', '.project', '.git'],
  rootStrategy: 'outermost',
  server: (ctx: any, root: string) => {
    const b = bundle(ctx)
    // JDK completo del plugin (jdtls ha bisogno di jdk.jdi per il debug, che un JRE non ha) e Lombok come agente.
    const rt = b.jdk ? { command: join(b.jdk, 'bin', 'java.exe'), args: ['-Djavax.net.ssl.trustStoreType=Windows-ROOT'] } : null
    const args = [
      ...(b.lombok ? [`-javaagent:${b.lombok}`] : []),
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
  initializationOptions: (ctx: any) => {
    const b = bundle(ctx)
    return { settings: settingsFor(b), bundles: b.debug ? [b.debug] : [] }
  },
  settings: (ctx: any) => settingsFor(bundle(ctx)),
  onNotification: {
    'language/status': (p: any, server: any) => server.setMessage(p?.message),
    'language/progressReport': (p: any, server: any) => p?.status && server.setMessage(p.status)
  },
  // Il motore di esecuzione sta nello stesso processo: parla con jdtls tramite il ponte che l'SDK gli dà.
  extend: (ctx: AdapterContext, a: AdapterApp, lsp: LspBridge) => {
    app = a
    return {
      initialize: () => startService(ctx, lsp),
      call: (method: string, p: Record<string, any>) => dispatch(method, p),
      shutdown: () => svc?.shutdown()
    }
  }
})

