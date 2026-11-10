// Adapter del Java development pack (cct.java-dev): la logica di Java che non sta nell'app ma nel plugin.
// Servizi Maven e Gradle, JDK, run configuration, debug (java-debug dentro jdtls) e importazione da IntelliJ.
// L'app gli dà solo impostazioni, terminali, eventi per le sue pagine e la richiesta al language server (plugin cct.java).
import { dirname } from 'node:path'
import { runAdapter, type AdapterApp, type GutterMarkerOut } from './cct-plugin-sdk.mjs'
import { JavaDevService } from './JavaDevService.mts'
import type { DebugState, JavaBreakpoint, RunConfig } from './types.mts'

const LANGUAGE_SERVER = 'cct.java'
/** Impostazioni del plugin: tutte con il prefisso «java.» dichiarato nel manifest (i dati già salvati restano). */
const KEYS = ['java.runConfigs', 'java.defaultJdk', 'java.serviceJdk', 'java.breakpoints']

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

runAdapter({
  async initialize(ctx, a) {
    app = a
    for (const k of KEYS) cache.set(k, await app.settings.get(k).catch(() => null))
    // I JDK scaricati stanno in <dati dell'app>/jdks (come prima del plugin): i dati del plugin sono <dati>/plugin-data/<id>.
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
      lsp: (method, params) => app.plugin(LANGUAGE_SERVER, method, params),
      createTask: (req) => app.session.create({ ...req }),
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
  },

  /** Richieste delle pagine del plugin (e clic nel margine dell'editor): un metodo per ogni funzione del servizio. */
  async call(method, p) {
    switch (method) {
      case 'state': return svc.state(String(p.root ?? ''), Boolean(p.fresh))
      case 'setDefaultJdk': return svc.setDefaultJdk((p.id as string | null) ?? null)
      case 'setServiceJdk': return svc.setServiceJdk(String(p.root), (p.id as string | null) ?? null)
      case 'downloadJdk': return svc.downloadJdk(Number(p.major))
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
  },

  shutdown() {
    svc?.shutdown()
  }
})

