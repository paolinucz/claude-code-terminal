import net from 'node:net'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  emptyDebugState,
  type DebugFrame,
  type DebugOutput,
  type DebugScope,
  type DebugState,
  type DebugVariable,
  type IdeaImportResult,
  type JavaBreakpoint,
  type JavaProgress,
  type JavaService,
  type JavaState,
  type JdkInfo,
  type RunConfig
} from './types.mts'
import { DapClient, type DapEvent } from './dap.mts'
import { readIdeaProject } from './ideaImport.mts'
import { detectJdks, downloadTemurin, removeManagedJdk, whichOnPath } from './jdks.mts'
import { buildLaunch, type LaunchContext } from './runConfig.mts'
import { detectServices, nodeDisk, type Disk } from './services.mts'

/** Richiesta di una sessione «task» (un comando in un terminale dell'app, senza shell). */
export interface TaskRequest {
  kind: 'task'
  title: string
  cwd: string
  file: string
  args: string[]
  env: Record<string, string>
}

export interface JavaDevDeps {
  getSetting(key: string): unknown
  setSetting(key: string, value: unknown): void
  /** Cartella dati dell'app (i JDK scaricati stanno in «jdks»). */
  userDataDir: string
  /** Cartella dati del pack (per scrivere i JDK che jdtls deve conoscere). */
  packDataDir(): string
  /** Il pack è installato e attivo. */
  packActive(): boolean
  /** Richiesta all'adapter Java (comandi di jdtls). */
  lsp(method: 'lsp/executeCommand' | 'lsp/state', params: Record<string, unknown>): Promise<unknown>
  createTask(req: TaskRequest): Promise<{ id: string }>
  killSession(id: string): void
  /** Stato della sessione terminale (undefined se non esiste più). */
  sessionStatus(id: string): Promise<string | undefined>
  emitDebug(s: DebugState): void
  emitOutput(o: DebugOutput): void
  emitProgress(p: JavaProgress): void
  emitState(): void
}

const K_CONFIGS = 'java.runConfigs'
const K_DEFAULT_JDK = 'java.defaultJdk'
const K_SERVICE_JDK = 'java.serviceJdk'
const K_BREAKPOINTS = 'java.breakpoints'

const key = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
const inside = (child: string, parent: string) => key(child) === key(parent) || key(child).startsWith(key(parent) + '\\')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const toUri = (p: string) => 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '')

/**
 * La porta di debug dell'applicazione è già in ascolto? Non ci si collega per provare: un agente JDWP accetta un solo
 * debugger e una connessione di prova lo lascerebbe bloccato nell'handshake. Si prova invece a occupare la porta:
 * se è già occupata, qualcuno (l'applicazione) è in ascolto.
 */
function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'EADDRINUSE'))
    s.once('listening', () => s.close(() => resolve(false)))
    s.listen({ port, host: '127.0.0.1', exclusive: true })
  })
}

/**
 * Java development pack: rileva i servizi Java di una cartella, gestisce i JDK (Eclipse Temurin), le run
 * configuration (anche importate da IntelliJ), le avvia in un terminale dell'app e le debugga con java-debug
 * (il server di debug dentro il language server Java, parlato con il Debug Adapter Protocol).
 */
export class JavaDevService {
  private disk: Disk | null = null
  private serviceCache = new Map<string, { at: number; list: JavaService[] }>()
  private dap: DapClient | null = null
  private dbg: DebugState = emptyDebugState()
  private launched = false
  private cancelStart = false
  private lastCfg: { cfg: RunConfig; workspace: string } | null = null

  constructor(private readonly d: JavaDevDeps) {}

  private get managedDir(): string {
    return join(this.d.userDataDir, 'jdks')
  }

  // ---------------------------------------------------------------- stato

  private configs(): RunConfig[] {
    const raw = this.d.getSetting(K_CONFIGS)
    return Array.isArray(raw) ? (raw as RunConfig[]) : []
  }

  private async services(root: string, fresh = false): Promise<JavaService[]> {
    const k = key(root)
    const hit = this.serviceCache.get(k)
    if (!fresh && hit && Date.now() - hit.at < 20000) return hit.list
    this.disk ??= await nodeDisk()
    const list = detectServices(root, this.disk)
    this.serviceCache.set(k, { at: Date.now(), list })
    return list
  }

  async state(root: string, fresh = false): Promise<JavaState> {
    const services = root ? await this.services(root, fresh) : []
    return {
      enabled: this.d.packActive(),
      services,
      jdks: detectJdks(this.managedDir),
      configs: this.configs().filter((c) => !root || inside(c.root, root) || services.some((s) => inside(c.root, s.root))),
      defaultJdk: (this.d.getSetting(K_DEFAULT_JDK) as string | undefined) || undefined,
      serviceJdk: (this.d.getSetting(K_SERVICE_JDK) as Record<string, string> | undefined) ?? {}
    }
  }

  // ---------------------------------------------------------------- JDK

  /** Scrive l'elenco dei JDK per jdtls (java.configuration.runtimes), letto dall'adapter all'avvio. */
  private writeRuntimes(): void {
    try {
      const jdks = detectJdks(this.managedDir)
      const def = this.d.getSetting(K_DEFAULT_JDK) as string | undefined
      const seen = new Set<number>()
      const runtimes = jdks
        .filter((j) => (seen.has(j.major) ? false : (seen.add(j.major), true)))
        .map((j) => ({ name: j.major <= 8 ? 'JavaSE-1.8' : `JavaSE-${j.major}`, path: j.path, ...(def === j.id ? { default: true } : {}) }))
      const dir = this.d.packDataDir()
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'jdks.json'), JSON.stringify(runtimes, null, 2))
    } catch {
      // se la cartella non è scrivibile jdtls usa il suo JDK
    }
  }

  setDefaultJdk(id: string | null): void {
    this.d.setSetting(K_DEFAULT_JDK, id ?? '')
    this.writeRuntimes()
    this.d.emitState()
  }

  setServiceJdk(serviceRoot: string, id: string | null): void {
    const map = { ...((this.d.getSetting(K_SERVICE_JDK) as Record<string, string> | undefined) ?? {}) }
    if (id) map[key(serviceRoot)] = id
    else delete map[key(serviceRoot)]
    this.d.setSetting(K_SERVICE_JDK, map)
    this.d.emitState()
  }

  async downloadJdk(major: number): Promise<{ ok: boolean; error?: string }> {
    try {
      await downloadTemurin(major, this.managedDir, (p) => this.d.emitProgress(p))
      this.writeRuntimes()
      this.d.emitState()
      return { ok: true }
    } catch (e) {
      const error = (e as Error).message
      this.d.emitProgress({ step: 'Errore', progress: 0, error })
      return { ok: false, error }
    }
  }

  removeJdk(id: string): boolean {
    const jdk = detectJdks(this.managedDir).find((j) => j.id === id)
    const ok = jdk ? removeManagedJdk(jdk, this.managedDir) : false
    this.writeRuntimes()
    this.d.emitState()
    return ok
  }

  /** JDK per una configurazione: quello scelto, poi quello del servizio, poi il predefinito, poi il più adatto alla versione richiesta. */
  private jdkFor(cfg: RunConfig, services: JavaService[]): JdkInfo {
    const jdks = detectJdks(this.managedDir)
    if (!jdks.length) throw new Error('Nessun JDK trovato. Scarica Eclipse Temurin dalla sezione «JDK» del pannello Esegui e debug.')
    const byId = (id: string | undefined) => jdks.find((j) => j.id === id)
    const service = services.filter((s) => inside(cfg.root, s.root)).sort((a, b) => b.root.length - a.root.length)[0]
    const serviceJdk = (this.d.getSetting(K_SERVICE_JDK) as Record<string, string> | undefined) ?? {}
    const chosen = byId(cfg.jdk) ?? (service ? byId(serviceJdk[service.id]) : undefined) ?? byId(this.d.getSetting(K_DEFAULT_JDK) as string | undefined)
    if (chosen) return chosen
    const need = Number.parseInt(service?.javaVersion ?? '', 10)
    if (need) {
      const fit = jdks.filter((j) => j.major >= need).sort((a, b) => a.major - b.major)[0]
      if (fit) return fit
    }
    return jdks[0]
  }

  // ---------------------------------------------------------------- run configuration

  saveConfig(cfg: RunConfig): RunConfig {
    const list = this.configs()
    const next: RunConfig = { ...cfg, id: cfg.id || randomUUID(), env: cfg.env ?? {}, debugPort: cfg.debugPort || 5005 }
    const i = list.findIndex((c) => c.id === next.id)
    if (i >= 0) list[i] = next
    else list.push(next)
    this.d.setSetting(K_CONFIGS, list)
    this.d.emitState()
    return next
  }

  deleteConfig(id: string): void {
    this.d.setSetting(K_CONFIGS, this.configs().filter((c) => c.id !== id))
    this.d.emitState()
  }

  async importIdea(root: string): Promise<IdeaImportResult> {
    this.disk ??= await nodeDisk()
    // Il progetto IntelliJ può stare nella cartella scelta o in una sopra (.idea): si risale fino a trovarla.
    let dir = root
    for (let i = 0; i < 6; i++) {
      if (existsSync(join(dir, '.idea')) || existsSync(join(dir, '.run'))) break
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
    const r = readIdeaProject(dir, this.disk, randomUUID)
    if (!existsSync(join(dir, '.idea')) && !existsSync(join(dir, '.run'))) r.warnings.unshift(`Nessuna cartella .idea o .run trovata in ${root} né sopra.`)
    else if (!r.configs.length) r.warnings.unshift('Nessuna run configuration di IntelliJ trovata (.idea/runConfigurations, .run, workspace.xml).')
    return r
  }

  // ---------------------------------------------------------------- avvio

  private findScript(from: string, workspace: string, names: string[], fallbackNames: string[]): string | null {
    for (let dir = from; ; dir = dirname(dir)) {
      for (const n of names) if (existsSync(join(dir, n))) return join(dir, n)
      if (dirname(dir) === dir || (workspace && key(dir) === key(dirname(workspace)))) break
    }
    return whichOnPath(fallbackNames)
  }

  private async launchContext(cfg: RunConfig, services: JavaService[], mode: 'run' | 'debug', workspace: string): Promise<{ ctx: LaunchContext; jdk: JdkInfo }> {
    const jdk = this.jdkFor(cfg, services)
    const ctx: LaunchContext = {
      mode,
      jdkHome: jdk.path,
      mavenCmd: this.findScript(cfg.root, workspace, ['mvnw.cmd'], ['mvn.cmd', 'mvn.bat']) ?? undefined,
      gradleCmd: this.findScript(cfg.root, workspace, ['gradlew.bat'], ['gradle.bat', 'gradle.cmd']) ?? undefined,
      path: process.env.PATH ?? process.env.Path ?? '',
      userEnv: { JAVA_TOOL_OPTIONS: process.env.JAVA_TOOL_OPTIONS, MAVEN_OPTS: process.env.MAVEN_OPTS, GRADLE_OPTS: process.env.GRADLE_OPTS },
      windowsRootCerts: process.platform === 'win32'
    }
    if (cfg.type === 'application') ctx.classpath = await this.resolveClasspath(cfg, services, workspace)
    return { ctx, jdk }
  }

  private async lsp(command: string, args: unknown[], workspace: string, root: string, timeout = 60000): Promise<unknown> {
    return this.d.lsp('lsp/executeCommand', { workspace, root, command, arguments: args, timeout })
  }

  /** Aspetta che jdtls abbia importato il progetto (Maven e Gradle possono scaricare dipendenze: ci vuole tempo). */
  private async waitImported(root: string, workspace: string, say: (m: string) => void): Promise<void> {
    const started = Date.now()
    for (;;) {
      if (this.cancelStart) throw new Error('Avvio annullato.')
      const all = (await this.lsp('java.project.getAll', [], workspace, root, 30000).catch(() => [])) as string[]
      const mine = Array.isArray(all) && all.some((u) => typeof u === 'string' && inside(decodeURIComponent(u.replace(/^file:\/+/, '')).replace(/\//g, '\\'), root))
      if (mine) return
      if (Date.now() - started > 240000) throw new Error('Il language server Java non ha ancora importato il progetto (timeout). Controlla lo stato in basso nell\'editor.')
      say('Importazione del progetto da parte del language server Java… (la prima volta può scaricare le dipendenze)')
      await sleep(2500)
    }
  }

  private async projectNameOf(cfg: RunConfig, services: JavaService[], workspace: string): Promise<string | undefined> {
    try {
      const mains = (await this.lsp('vscode.java.resolveMainClass', [toUri(cfg.root)], workspace, cfg.root, 30000)) as { projectName?: string; filePath?: string }[]
      const mine = Array.isArray(mains) ? mains.find((m) => m.filePath && inside(m.filePath, cfg.root)) : undefined
      if (mine?.projectName) return mine.projectName
    } catch {
      // senza main (per esempio Quarkus) si usa il nome del servizio
    }
    return services.filter((s) => inside(cfg.root, s.root)).sort((a, b) => b.root.length - a.root.length)[0]?.name
  }

  private async resolveClasspath(cfg: RunConfig, services: JavaService[], workspace: string): Promise<string[]> {
    await this.waitImported(cfg.root, workspace, () => {})
    const projectName = await this.projectNameOf(cfg, services, workspace)
    const r = (await this.lsp('vscode.java.resolveClasspath', [cfg.mainClass, projectName], workspace, cfg.root)) as [string[], string[]]
    return [...(r?.[0] ?? []), ...(r?.[1] ?? [])]
  }

  /** Esegui senza debug: il comando parte in un terminale dell'app. */
  async run(configId: string, workspace: string): Promise<{ ok: boolean; error?: string; sessionId?: string }> {
    try {
      const cfg = this.configs().find((c) => c.id === configId)
      if (!cfg) throw new Error('Configurazione non trovata.')
      if (cfg.type === 'attach') throw new Error('«Attach» si usa solo con Debug.')
      const services = await this.services(workspace || cfg.root)
      const { ctx } = await this.launchContext(cfg, services, 'run', workspace)
      const launch = buildLaunch(cfg, ctx)
      const session = await this.d.createTask({ kind: 'task', title: launch.title, cwd: launch.cwd, file: launch.file, args: launch.args, env: launch.env })
      return { ok: true, sessionId: session.id }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  // ---------------------------------------------------------------- debug

  private setDbg(patch: Partial<DebugState>): void {
    this.dbg = { ...this.dbg, ...patch }
    this.d.emitDebug(this.dbg)
  }

  debugState(): DebugState {
    return this.dbg
  }

  breakpoints(): Record<string, JavaBreakpoint[]> {
    return (this.d.getSetting(K_BREAKPOINTS) as Record<string, JavaBreakpoint[]> | undefined) ?? {}
  }

  /** Imposta i breakpoint di un file (e li manda al debugger se c'è una sessione attiva). */
  async setBreakpoints(file: string, list: JavaBreakpoint[]): Promise<void> {
    const all = { ...this.breakpoints() }
    if (list.length) all[file] = list
    else delete all[file]
    this.d.setSetting(K_BREAKPOINTS, all)
    if (this.dap && (this.dbg.status === 'running' || this.dbg.status === 'paused')) await this.sendBreakpoints(file).catch(() => {})
  }

  private async sendBreakpoints(file: string): Promise<void> {
    const list = (this.breakpoints()[file] ?? []).filter((b) => b.enabled)
    const r = await this.dap!.request<{ breakpoints?: { verified: boolean; line: number }[] }>('setBreakpoints', {
      source: { path: file },
      breakpoints: list.map((b) => ({ line: b.line, ...(b.condition ? { condition: b.condition } : {}) }))
    })
    const verified = { ...this.dbg.verified }
    verified[file] = (r.breakpoints ?? []).filter((b) => b.verified).map((b) => b.line)
    this.setDbg({ verified })
  }

  private onEvent(e: DapEvent): void {
    const b = e.body
    switch (e.event) {
      case 'stopped': {
        const threadId = Number(b.threadId)
        void this.dap
          ?.request<{ stackFrames?: { id: number; name: string; line: number; column?: number; source?: { path?: string } }[] }>('stackTrace', { threadId, startFrame: 0, levels: 40 })
          .then((r) => {
            const frames: DebugFrame[] = (r.stackFrames ?? []).map((f) => ({ id: f.id, name: f.name, path: f.source?.path, line: f.line, column: f.column }))
            this.setDbg({ status: 'paused', threadId, reason: String(b.reason ?? ''), frames })
          })
          .catch(() => this.setDbg({ status: 'paused', threadId, reason: String(b.reason ?? ''), frames: [] }))
        break
      }
      case 'continued':
        this.setDbg({ status: 'running', frames: [], reason: undefined })
        break
      case 'output':
        this.d.emitOutput({ category: String(b.category ?? 'console'), text: String(b.output ?? '') })
        break
      case 'terminated':
      case 'exited':
        this.finish('Il programma è terminato.')
        break
    }
  }

  private finish(message?: string): void {
    const dap = this.dap
    this.dap = null
    dap?.close()
    this.launched = false
    if (this.dbg.status !== 'idle') this.setDbg({ status: 'terminated', frames: [], threadId: undefined, reason: undefined, message })
  }

  /** Avvia la configurazione in debug (o si collega, con «attach») e si ferma ai breakpoint. */
  async debug(configId: string, workspace: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.d.packActive()) return { ok: false, error: 'Installa il Java development pack per usare il debugger.' }
    if (this.dbg.status === 'starting' || this.dbg.status === 'running' || this.dbg.status === 'paused') return { ok: false, error: 'C\'è già una sessione di debug: fermala prima.' }
    const cfg = this.configs().find((c) => c.id === configId)
    if (!cfg) return { ok: false, error: 'Configurazione non trovata.' }
    this.cancelStart = false
    this.lastCfg = { cfg, workspace }
    this.dbg = { ...emptyDebugState(), status: 'starting', configId: cfg.id, configName: cfg.name, message: 'Preparo il debug…' }
    this.d.emitDebug(this.dbg)
    const say = (message: string) => this.setDbg({ message })
    try {
      const services = await this.services(workspace || cfg.root)
      // 1) il language server deve conoscere il progetto
      say('Avvio il language server Java…')
      await this.waitImported(cfg.root, workspace, say)
      const projectName = await this.projectNameOf(cfg, services, workspace)
      // Come VS Code: oggetti con i loro campi (non con il solo toString), statici nascosti, hot code replace automatico.
      await this.lsp('vscode.java.updateDebugSettings', [JSON.stringify({ showToString: false, showLogicalStructure: true, showStaticVariables: false, showQualifiedNames: false, showHex: false, enableHotCodeReplace: true, hotCodeReplace: 'auto', stepFilters: { skipClasses: ['$JDK'], skipSynthetics: true, skipStaticInitializers: false, skipConstructors: false } })], workspace, cfg.root).catch(() => undefined)
      const dapPort = Number(await this.lsp('vscode.java.startDebugSession', [], workspace, cfg.root))
      if (!dapPort) throw new Error('Il server di debug di java-debug non si è avviato (il bundle è nel pack?).')

      // 2) il processo da debuggare
      let host = cfg.host || 'localhost'
      let port = cfg.type === 'attach' ? (cfg.port ?? cfg.debugPort) : cfg.debugPort
      if (cfg.type !== 'attach') {
        say('Avvio il programma…')
        const { ctx } = await this.launchContext(cfg, services, 'debug', workspace)
        const launch = buildLaunch(cfg, ctx)
        port = launch.debugPort ?? port
        host = '127.0.0.1'
        const session = await this.d.createTask({ kind: 'task', title: launch.title, cwd: launch.cwd, file: launch.file, args: launch.args, env: launch.env })
        this.launched = true
        this.setDbg({ sessionId: session.id })
        say(`Aspetto che l'applicazione apra la porta di debug ${port}…`)
        for (let i = 0; ; i++) {
          if (this.cancelStart) throw new Error('Avvio annullato.')
          if (await probe(port)) break
          const st = await this.d.sessionStatus(session.id)
          if (st === undefined || st === 'exited') throw new Error('Il programma si è fermato prima di aprire la porta di debug: guarda il terminale per l\'errore.')
          if (i > 600) throw new Error(`La porta di debug ${port} non si è aperta in 5 minuti.`)
          await sleep(500)
        }
      }

      // 3) DAP: collegamento, breakpoint, via
      say('Collego il debugger…')
      this.dap = new DapClient((e) => this.onEvent(e), () => this.finish('Debug terminato.'))
      await this.dap.connect(dapPort)
      await this.dap.request('initialize', { clientID: 'cct', clientName: 'Claude Code Terminal', adapterID: 'java', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path', supportsVariableType: true })
      const attached = this.dap.request('attach', { hostName: host === '127.0.0.1' ? 'localhost' : host, port, timeout: 30000, ...(projectName ? { projectName } : {}) }, 60000)
      await attached
      for (const file of Object.keys(this.breakpoints())) await this.sendBreakpoints(file).catch(() => {})
      await this.dap.request('configurationDone', {})
      this.setDbg({ status: 'running', message: undefined })
      return { ok: true }
    } catch (e) {
      const error = (e as Error).message
      const dap = this.dap
      this.dap = null
      dap?.close()
      if (this.launched && this.dbg.sessionId) this.d.killSession(this.dbg.sessionId)
      this.launched = false
      this.dbg = { ...emptyDebugState(), status: 'terminated', configId: cfg.id, configName: cfg.name, message: error }
      this.d.emitDebug(this.dbg)
      return { ok: false, error }
    }
  }

  private requireDap(): DapClient {
    if (!this.dap) throw new Error('Nessuna sessione di debug attiva.')
    return this.dap
  }

  async control(action: 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut'): Promise<void> {
    const dap = this.requireDap()
    const threadId = this.dbg.threadId ?? 1
    // java-debug non manda «continued» dopo continue o un passo: lo stato passa a «in esecuzione» qui, PRIMA della richiesta,
    // così lo «stopped» di un passo (che può arrivare prima della risposta) non viene sovrascritto.
    if (action !== 'pause') this.setDbg({ status: 'running', frames: [], reason: undefined })
    if (action === 'continue') await dap.request('continue', { threadId })
    else if (action === 'pause') await dap.request('pause', { threadId })
    else if (action === 'next') await dap.request('next', { threadId })
    else if (action === 'stepIn') await dap.request('stepIn', { threadId })
    else await dap.request('stepOut', { threadId })
  }

  /** Ferma il debug (e il programma, se l'ha avviato l'app). */
  async stop(): Promise<void> {
    this.cancelStart = true
    const dap = this.dap
    const session = this.dbg.sessionId
    const launched = this.launched
    if (dap) await dap.request('disconnect', { terminateDebuggee: launched }, 5000).catch(() => {})
    if (launched && session) this.d.killSession(session)
    this.finish('Debug fermato.')
    this.dbg = emptyDebugState()
    this.d.emitDebug(this.dbg)
  }

  async restart(): Promise<{ ok: boolean; error?: string }> {
    const last = this.lastCfg
    if (!last) return { ok: false, error: 'Niente da riavviare.' }
    await this.stop()
    await sleep(800)
    return this.debug(last.cfg.id, last.workspace)
  }

  async scopes(frameId: number): Promise<DebugScope[]> {
    const r = await this.requireDap().request<{ scopes?: { name: string; variablesReference: number }[] }>('scopes', { frameId })
    return (r.scopes ?? []).map((s) => ({ name: s.name, ref: s.variablesReference }))
  }

  async variables(ref: number): Promise<DebugVariable[]> {
    const r = await this.requireDap().request<{ variables?: { name: string; value: string; type?: string; variablesReference?: number }[] }>('variables', { variablesReference: ref })
    const list = (r.variables ?? []).map((v) => ({ name: v.name, value: v.value, type: v.type, ref: v.variablesReference ?? 0 }))
    // Un solo figlio senza nome è la «vista logica» dell'oggetto (per esempio con toString): si mostrano direttamente i suoi campi.
    if (list.length === 1 && !list[0].name && list[0].ref > 0 && list[0].ref !== ref) return this.variables(list[0].ref)
    return list
  }

  async evaluate(expression: string, frameId?: number): Promise<{ ok: boolean; result?: string; type?: string; ref?: number; error?: string }> {
    try {
      const r = await this.requireDap().request<{ result: string; type?: string; variablesReference?: number }>('evaluate', { expression, frameId, context: 'repl' })
      return { ok: true, result: r.result, type: r.type, ref: r.variablesReference ?? 0 }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /** Chiusura dell'app: se c'è un debug in corso si ferma. */
  shutdown(): void {
    this.cancelStart = true
    this.dap?.close()
  }
}
