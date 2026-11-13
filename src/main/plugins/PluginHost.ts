import { spawn, type ChildProcess } from 'node:child_process'
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from 'vscode-jsonrpc/node'
import type { Diagnostic, FileDiagnostics, LspStatus } from '@shared/files'
import { normPath } from '@shared/files'
import { renamedPath } from '@shared/textEdits'
import {
  PLUGIN_API_VERSION,
  type ApiCapabilities,
  type ApiCompletionList,
  type ApiDiagnostic,
  type ApiFileEdit,
  type ApiRename,
  type WillRenameResult,
  type ApiHover,
  type ApiLocation,
  type ApiPosition,
  type DiagnosticsNotification,
  type InitializeParams,
  type InitializeResult,
  type LogNotification,
  type StatusNotification
} from '@shared/pluginApi'
import { HOST_EVENT_BROWSER, isOpenableUrl, BROWSER_ID_RE, type BrowserEvent } from '@shared/browser'
import { HOST_EVENT_HIVE, HOST_EVENT_NOTIFY, HOST_EVENT_TERMINAL, type GutterMarker, type GutterMarkersUpdate } from '@shared/plugins'
import { HOST_EVENT_STATUS_ITEM, type PluginAppEvent, type StatusItemPatch } from '@shared/pluginExt'
import type { AdapterSpec, PluginManager } from './PluginManager'

/** Un adapter in esecuzione: un processo per plugin. */
interface Host {
  spec: AdapterSpec
  proc: ChildProcess
  conn: MessageConnection
  /** true quando initialize è andato a buon fine. */
  ready: Promise<boolean>
  caps: ApiCapabilities | null
  alive: boolean
  stopping: boolean
  /** L'uscita è già stata gestita. */
  ended: boolean
  /** Documenti aperti in questo adapter (percorsi normalizzati). */
  docs: Set<string>
  /** Stati dei server gestiti dall'adapter, per id. */
  statuses: Map<string, LspStatus>
  /** Diagnostiche inviate: chiave del server → file (per cancellarle quando l'adapter si ferma). */
  diagnostics: Map<string, Set<string>>
  lastError: string
}

interface Doc {
  path: string
  text: string
  workspace?: string
  /** Plugin a cui il documento è stato mandato. */
  hosts: Set<string>
}

const REQUEST_TIMEOUT = 20000

/**
 * Servizi dell'app a disposizione degli adapter dei plugin (CCT Plugin API, «host/…»): impostazioni, terminali in
 * attività, richieste agli adapter di altri plugin, eventi verso le pagine del plugin. Li fornisce `index.ts`.
 */
export interface HostServices {
  getSetting(key: string): unknown
  setSetting(key: string, value: unknown): void
  createTask(req: Record<string, unknown>): Promise<unknown>
  killSession(id: string): void
  sessionStatus(id: string): string | undefined
  /** Evento dell'adapter per le pagine di quel plugin (le mostra l'interfaccia). */
  emit(pluginId: string, event: string, data: unknown): void
  /** Segni nel margine dell'editor mandati dall'adapter. */
  markers(update: GutterMarkersUpdate): void
  /** Browser integrato (permesso `browser`). */
  browser: {
    open(pluginId: string, id: string, url: string): Promise<void>
    navigate(pluginId: string, id: string, url: string): Promise<void>
    cdp(pluginId: string, id: string, method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>
    close(pluginId: string, id: string): void
    closeAllFor(pluginId: string): void
  }
}

/**
 * Host dei plugin (X1–X9): avvia l'adapter di ogni plugin in un processo Node separato e ci parla
 * con la CCT Plugin API (docs/plugin-api.md). L'app non conosce i language server: le particolarità
 * di ciascuno stanno nel suo adapter. Un file può andare a più plugin (X6): completamento e
 * definizioni si uniscono, la diagnostica resta separata per sorgente.
 */
export class PluginHost {
  private hosts = new Map<string, Host>()
  private docs = new Map<string, Doc>()

  private services: HostServices | null = null
  setServices(s: HostServices): void {
    this.services = s
  }

  constructor(
    private readonly plugins: PluginManager,
    private readonly onDiagnostics: (d: FileDiagnostics) => void,
    private readonly onStatus: (s: LspStatus) => void
  ) {}

  // ---- adapter ----

  private ensure(spec: AdapterSpec): Host {
    const existing = this.hosts.get(spec.pluginId)
    if (existing?.alive) return existing

    const proc = spawn(process.execPath, [spec.main], {
      cwd: spec.dir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    const conn = createMessageConnection(new StreamMessageReader(proc.stdout!), new StreamMessageWriter(proc.stdin!))
    const host: Host = {
      spec,
      proc,
      conn,
      ready: Promise.resolve(false),
      caps: null,
      alive: true,
      stopping: false,
      ended: false,
      docs: new Set(),
      statuses: new Map(),
      diagnostics: new Map(),
      lastError: ''
    }
    this.hosts.set(spec.pluginId, host)

    proc.stderr!.on('data', (d) => {
      const lines = String(d).split(/\r?\n/).filter((l) => l.trim())
      if (lines.length) host.lastError = lines[lines.length - 1].slice(0, 300)
    })
    proc.on('error', (err) => this.lost(host, `Impossibile avviare l'adapter: ${err.message}`))
    proc.on('exit', (code) => this.lost(host, code === 0 ? undefined : `L'adapter del plugin si è fermato (codice ${code})${host.lastError ? `: ${host.lastError}` : ''}.`))

    conn.onNotification('diagnostics', (p: DiagnosticsNotification) => {
      const key = `${spec.pluginId}/${p.source}`
      const set = host.diagnostics.get(key) ?? new Set<string>()
      host.diagnostics.set(key, set)
      if (p.items.length) set.add(p.path)
      else set.delete(p.path)
      this.onDiagnostics({ path: p.path, server: key, diagnostics: p.items.map(toDiagnostic) })
    })
    conn.onNotification('status', (p: StatusNotification) => this.setStatus(host, p))
    conn.onNotification('log', (p: LogNotification) => console.log(`[plugin ${spec.pluginId}] ${p.level}: ${p.message}`))
    this.registerHostRequests(host)
    conn.onError(() => {})
    conn.onClose(() => {})
    conn.listen()

    const params: InitializeParams = {
      apiVersion: PLUGIN_API_VERSION,
      plugin: { id: spec.pluginId, dir: spec.dir, downloadsDir: spec.downloadsDir, dataDir: spec.dataDir },
      runtimes: this.plugins.runtimes(),
      locale: 'it'
    }
    host.ready = (async () => {
      try {
        const res = await withTimeout(conn.sendRequest<InitializeResult>('initialize', params), 30000, 'initialize')
        host.caps = res?.capabilities ?? { completion: false, hover: false, definition: false, diagnostics: false }
        return true
      } catch (err) {
        this.setStatus(host, { id: 'adapter', name: spec.name, state: 'error', message: `L'adapter non risponde: ${(err as Error).message}` })
        host.alive = false
        proc.kill()
        return false
      }
    })()
    return host
  }

  /**
   * Richieste dall'adapter all'app. Ogni plugin vede solo le proprie impostazioni (chiavi `plugin.<id>.…` o i prefissi
   * dichiarati nel manifest in `storage.settingsPrefixes`) e può chiedere un'azione a un altro plugin solo se lo richiede.
   */
  private registerHostRequests(host: Host): void {
    const id = host.spec.pluginId
    const svc = () => {
      if (!this.services) throw new Error('Servizi dell\'app non pronti')
      return this.services
    }
    const prefixes = () => [`plugin.${id}.`, ...(this.plugins.list().find((p) => p.manifest.id === id)?.manifest.storage?.settingsPrefixes ?? [])]
    const keyOf = (p: unknown): string => {
      const key = (p as { key?: unknown } | null)?.key
      if (typeof key !== 'string' || !prefixes().some((x) => key.startsWith(x))) throw new Error(`Il plugin non può usare l'impostazione «${String(key)}»`)
      return key
    }
    host.conn.onRequest('host/settings.get', (p: unknown) => svc().getSetting(keyOf(p)) ?? null)
    host.conn.onRequest('host/settings.set', (p: unknown) => {
      svc().setSetting(keyOf(p), (p as { value?: unknown }).value ?? null)
      return null
    })
    host.conn.onRequest('host/session.create', (p: unknown) => svc().createTask(((p as { request?: Record<string, unknown> })?.request ?? {}) as Record<string, unknown>))
    host.conn.onRequest('host/session.kill', (p: unknown) => (svc().killSession(String((p as { id?: unknown })?.id ?? '')), null))
    host.conn.onRequest('host/session.status', (p: unknown) => svc().sessionStatus(String((p as { id?: unknown })?.id ?? '')) ?? null)
    // Richiesta all'adapter di un altro plugin richiesto da questo (`requires` nel manifest).
    host.conn.onRequest('host/plugin.call', (p: unknown) => {
      const q = p as { plugin?: string; method?: string; params?: Record<string, unknown> }
      const me = this.plugins.list().find((x) => x.manifest.id === id)
      if (!q?.plugin || !q.method || !me?.manifest.requires?.includes(q.plugin)) throw new Error(`Il plugin non può chiamare «${String(q?.plugin)}»: manca in «requires»`)
      return this.call(q.plugin, q.method, q.params ?? {})
    })
    // Browser integrato: serve il permesso `browser`; gli id sono nello spazio del plugin (`<id-plugin>/<id>`).
    const browserId = (p: unknown): string => {
      const raw = (p as { id?: unknown } | null)?.id
      if (typeof raw !== 'string' || !BROWSER_ID_RE.test(raw)) throw new Error(`Id del browser non valido: ${String(raw)}`)
      if (!this.plugins.list().find((x) => x.manifest.id === id)?.manifest.permissions?.includes('browser')) throw new Error('Manca il permesso «browser» nel manifest')
      return `${id}/${raw}`
    }
    host.conn.onRequest('host/browser.open', async (p: { id?: unknown; url?: unknown; title?: unknown }) => {
      const full = browserId(p)
      if (!isOpenableUrl(p.url)) throw new Error('Il browser apre solo indirizzi http e https')
      await svc().browser.open(id, full, p.url)
      this.services?.emit(id, HOST_EVENT_BROWSER, { id: full, title: typeof p.title === 'string' && p.title ? p.title.slice(0, 60) : 'Browser' })
      return null
    })
    host.conn.onRequest('host/browser.navigate', async (p: { url?: unknown }) => (await svc().browser.navigate(id, browserId(p), String(p.url)), null))
    host.conn.onRequest('host/browser.cdp', (p: { method?: unknown; params?: unknown; sessionId?: unknown }) =>
      svc().browser.cdp(id, browserId(p), String(p.method), p.params && typeof p.params === 'object' ? (p.params as Record<string, unknown>) : {}, typeof p.sessionId === 'string' ? p.sessionId : undefined)
    )
    host.conn.onNotification('browser/close', (p: unknown) => {
      try {
        svc().browser.close(id, browserId(p))
      } catch {
        /* id non valido o permesso mancante */
      }
    })
    host.conn.onNotification('editor/markers', (p: { path?: string | null; markers?: unknown }) => {
      const markers = Array.isArray(p?.markers) ? (p.markers as GutterMarker[]).filter((m) => m && Number.isInteger(m.line) && m.line > 0 && ['breakpoint', 'breakpoint-disabled', 'stopped'].includes(m.kind)) : []
      this.services?.markers({ pluginId: id, path: typeof p?.path === 'string' ? p.path : null, markers })
    })
    // Avvisi e terminali dall'adapter: l'interfaccia li gestisce come eventi riservati (`$…`), che non arrivano alle pagine.
    host.conn.onNotification('ui/notify', (p: { message?: unknown; kind?: unknown }) => {
      if (typeof p?.message !== 'string' || !p.message) return
      this.services?.emit(id, HOST_EVENT_NOTIFY, { message: p.message.slice(0, 500), kind: ['info', 'ok', 'warn', 'error'].includes(String(p.kind)) ? p.kind : 'info' })
    })
    host.conn.onNotification('ui/terminal.show', (p: { sessionId?: unknown }) => {
      if (typeof p?.sessionId === 'string' && p.sessionId) this.services?.emit(id, HOST_EVENT_TERMINAL, { sessionId: p.sessionId })
    })
    // Gruppo di terminali (vista «alveare»): chiave stabile, titolo e sessioni; il messaggio sostituisce l'elenco precedente.
    host.conn.onNotification('ui/terminal.hive', (p: { key?: unknown; title?: unknown; sessionIds?: unknown }) => {
      const ids = Array.isArray(p?.sessionIds) ? p.sessionIds.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80).slice(0, 24) : []
      if (typeof p?.key !== 'string' || !/^[\w.:-]{1,80}$/.test(p.key)) return
      this.services?.emit(id, HOST_EVENT_HIVE, { key: p.key, title: typeof p.title === 'string' ? p.title.slice(0, 80) : 'Terminali', sessionIds: ids })
    })
    host.conn.onNotification('ui/event', (p: { event?: string; data?: unknown }) => {
      if (p && typeof p.event === 'string') this.services?.emit(id, p.event, p.data ?? null)
    })
    // Elemento della barra di stato (Plugin API v2): solo quelli dichiarati nel manifest; i testi sono limitati.
    host.conn.onNotification('ui/statusItem', (p: { id?: unknown } & StatusItemPatch) => {
      const declared = this.plugins.list().find((x) => x.manifest.id === id)?.manifest.contributes?.statusBar ?? []
      if (typeof p?.id !== 'string' || !declared.some((s) => s.id === p.id)) return
      const patch: StatusItemPatch = {}
      if (typeof p.text === 'string') patch.text = p.text.slice(0, 60)
      if (typeof p.tooltip === 'string') patch.tooltip = p.tooltip.slice(0, 300)
      if (typeof p.visible === 'boolean') patch.visible = p.visible
      if (['neutral', 'ok', 'warn', 'error', 'busy'].includes(String(p.tone))) patch.tone = p.tone
      this.services?.emit(id, HOST_EVENT_STATUS_ITEM, { id: p.id, ...patch })
    })
  }

  /**
   * Evento dell'app per gli adapter (Plugin API v2): lo riceve (notifica `app/event`) solo l'adapter già in esecuzione di un
   * plugin che lo ha chiesto in `contributes.events`. Non avvia adapter: un evento perso non vale un processo in più.
   */
  broadcast(event: PluginAppEvent, data: unknown): void {
    for (const [pluginId, host] of this.hosts) {
      if (!host.alive || host.stopping) continue
      const wants = this.plugins.list().find((x) => x.manifest.id === pluginId)?.manifest.contributes?.events
      if (wants?.includes(event)) void host.conn.sendNotification('app/event', { event, data })
    }
  }

  private setStatus(host: Host, p: StatusNotification): void {
    const s: LspStatus = {
      key: `${host.spec.pluginId}/${p.id}`,
      pluginId: host.spec.pluginId,
      name: p.name,
      languages: host.spec.handles,
      root: p.root ?? '',
      state: p.state,
      message: p.message
    }
    host.statuses.set(p.id, s)
    this.onStatus(s)
  }

  /** L'adapter si è fermato (uscita, errore, disattivazione): stati e diagnostiche si aggiornano. */
  private lost(host: Host, message?: string): void {
    if (host.ended) return
    host.ended = true
    if (this.hosts.get(host.spec.pluginId) === host) this.hosts.delete(host.spec.pluginId)
    // Senza adapter nessuno pilota più le viste del browser integrato: si chiudono.
    this.services?.browser.closeAllFor(host.spec.pluginId)
    const wasAlive = host.alive
    host.alive = false
    // Durante lo shutdown la connessione serve ancora: si chiude dopo (vedi shutdown).
    if (!host.stopping) host.conn.dispose()
    for (const [key, paths] of host.diagnostics) for (const path of paths) this.onDiagnostics({ path, server: key, diagnostics: [] })
    host.diagnostics.clear()
    for (const d of this.docs.values()) d.hosts.delete(host.spec.pluginId)
    if (!wasAlive && !host.stopping) return
    const state: LspStatus['state'] = host.stopping || !message ? 'stopped' : 'error'
    const msg = host.stopping ? 'Plugin disattivato o aggiornato' : message
    if (!host.statuses.size) host.statuses.set('adapter', { key: `${host.spec.pluginId}/adapter`, pluginId: host.spec.pluginId, name: host.spec.name, languages: host.spec.handles, root: '', state })
    for (const [id, s] of host.statuses) {
      const next = { ...s, state, message: msg }
      host.statuses.set(id, next)
      this.onStatus(next)
    }
  }

  /** L'adapter chiude i suoi server ed esce; se non risponde, si chiude comunque. Si risolve all'uscita. */
  private shutdown(host: Host): Promise<void> {
    host.stopping = true
    const exited = new Promise<void>((resolve) => {
      if (host.proc.exitCode !== null || !host.proc.pid) resolve()
      else host.proc.once('exit', () => resolve())
    })
    void host.ready
      .then((ok) => (ok ? withTimeout(host.conn.sendRequest('shutdown', {}), 8000, 'shutdown') : null))
      .catch(() => {})
      .finally(() => {
        const t = setTimeout(() => host.proc.exitCode === null && host.proc.kill(), 2000)
        void exited.then(() => {
          clearTimeout(t)
          host.conn.dispose()
        })
      })
    return exited
  }

  // ---- documenti ----

  /** Manda il documento a tutti gli adapter che lo gestiscono e non lo hanno ancora. */
  private async attach(doc: Doc): Promise<void> {
    const k = normPath(doc.path)
    await Promise.all(
      this.plugins.adaptersFor(doc.path).map(async ({ spec, languageId }) => {
        const host = this.ensure(spec)
        if (host.docs.has(k)) return
        host.docs.add(k)
        if (!(await host.ready) || !host.alive) return
        doc.hosts.add(spec.pluginId)
        void host.conn.sendNotification('document/open', { path: doc.path, languageId, text: doc.text, workspace: doc.workspace })
      })
    )
  }

  private hostsOf(path: string): Host[] {
    const doc = this.docs.get(normPath(path))
    if (!doc) return []
    return [...doc.hosts].map((id) => this.hosts.get(id)).filter((h): h is Host => Boolean(h?.alive))
  }

  async open(path: string, text: string, workspace?: string): Promise<void> {
    const k = normPath(path)
    const doc = this.docs.get(k) ?? { path, text, workspace, hosts: new Set<string>() }
    doc.text = text
    doc.workspace = workspace ?? doc.workspace
    this.docs.set(k, doc)
    await this.attach(doc)
  }

  async change(path: string, text: string, workspace?: string): Promise<void> {
    const doc = this.docs.get(normPath(path))
    if (!doc) return this.open(path, text, workspace)
    doc.text = text
    for (const h of this.hostsOf(path)) void h.conn.sendNotification('document/change', { path: doc.path, text })
  }

  async save(path: string, text: string): Promise<void> {
    const doc = this.docs.get(normPath(path))
    if (!doc) return
    doc.text = text
    // Al salvataggio si riprova anche con gli adapter fermi (es. dopo un errore).
    await this.attach(doc)
    for (const h of this.hostsOf(path)) void h.conn.sendNotification('document/save', { path: doc.path, text })
  }

  async close(path: string): Promise<void> {
    const k = normPath(path)
    const doc = this.docs.get(k)
    if (!doc) return
    for (const h of this.hostsOf(path)) {
      h.docs.delete(k)
      void h.conn.sendNotification('document/close', { path: doc.path })
    }
    this.docs.delete(k)
  }

  // ---- richieste (X6: risultati uniti) ----

  private async ask<T>(path: string, cap: keyof ApiCapabilities, method: string, position: ApiPosition): Promise<T[]> {
    const hosts = this.hostsOf(path).filter((h) => h.caps?.[cap])
    const results = await Promise.all(
      hosts.map((h) => withTimeout(h.conn.sendRequest<T>(method, { path, position }), REQUEST_TIMEOUT, method).catch(() => null))
    )
    return results.filter((r): r is Awaited<T> => r !== null && r !== undefined) as T[]
  }

  async completion(path: string, position: ApiPosition): Promise<ApiCompletionList> {
    const lists = await this.ask<ApiCompletionList>(path, 'completion', 'completion', position)
    return { items: lists.flatMap((l) => l.items ?? []), incomplete: lists.some((l) => l.incomplete) }
  }

  async hover(path: string, position: ApiPosition): Promise<ApiHover | null> {
    const hovers = await this.ask<ApiHover>(path, 'hover', 'hover', position)
    return hovers.find((h) => h.contents?.length) ?? null
  }

  async definition(path: string, position: ApiPosition): Promise<ApiLocation[]> {
    return (await this.ask<ApiLocation[]>(path, 'definition', 'definition', position)).flat()
  }

  /** Adapter già avviati (hanno aperto un file del progetto) che sanno fare il refactoring allo spostamento. */
  private refactorHosts(): Host[] {
    return [...this.hosts.values()].filter((h) => h.alive && h.caps?.willRename)
  }

  /**
   * Prima di spostare o rinominare: chiede agli adapter le modifiche che tengono coerente il codice (package, import, nome
   * della classe…). I percorsi delle modifiche sono quelli di prima della rinomina. Un adapter che fallisce è ignorato.
   */
  async willRename(renames: ApiRename[]): Promise<ApiFileEdit[]> {
    const results = await Promise.all(
      this.refactorHosts().map((h) =>
        withTimeout(h.conn.sendRequest<WillRenameResult>('refactor/willRename', { renames }), 60000, 'refactor/willRename').catch(() => null)
      )
    )
    const byPath = new Map<string, ApiFileEdit>()
    for (const r of results) {
      for (const f of r?.files ?? []) {
        if (!f || typeof f.path !== 'string' || !Array.isArray(f.edits)) continue
        const k = normPath(f.path)
        const cur = byPath.get(k)
        if (cur) cur.edits.push(...f.edits)
        else byPath.set(k, { path: f.path, edits: [...f.edits] })
      }
    }
    return [...byPath.values()].filter((f) => f.edits.length)
  }

  /** Dopo lo spostamento: gli adapter aggiornano i loro indici (e i documenti aperti seguono i nuovi percorsi). */
  didRename(renames: ApiRename[]): void {
    for (const h of this.refactorHosts()) void h.conn.sendNotification('refactor/didRename', { renames })
    for (const doc of [...this.docs.values()]) {
      const moved = renamedPath(doc.path, renames)
      if (moved === doc.path) continue
      void this.close(doc.path)
    }
  }

  /**
   * Richiesta propria di un plugin (oltre alla API di base): per esempio i comandi del language server Java usati dal debug.
   * Avvia l'adapter se serve; fallisce con un messaggio chiaro se il plugin non è attivo.
   */
  async call<T = unknown>(pluginId: string, method: string, params: Record<string, unknown>, timeoutMs = 90000): Promise<T> {
    const spec = this.plugins.adapter(pluginId)
    if (!spec) throw new Error(`Il plugin «${pluginId}» non è installato o attivo.`)
    const host = this.ensure(spec)
    if (!(await host.ready) || !host.alive) throw new Error(`Il plugin «${pluginId}» non si è avviato${host.lastError ? `: ${host.lastError}` : '.'}`)
    return withTimeout(host.conn.sendRequest<T>('call', { method, params }), timeoutMs, method)
  }

  /**
   * Avvia in anticipo l'adapter di un plugin (senza chiedergli niente), così la prima richiesta non aspetta l'avvio del
   * processo. Restituisce `true` se è pronto.
   */
  async warm(pluginId: string): Promise<boolean> {
    const spec = this.plugins.adapter(pluginId)
    if (!spec) return false
    const host = this.ensure(spec)
    return (await host.ready) && host.alive
  }

  statuses(): LspStatus[] {
    return [...this.hosts.values()].flatMap((h) => [...h.statuses.values()])
  }

  /** Evento del browser integrato per l'adapter proprietario (messaggio CDP, stato, chiusura). */
  sendBrowserEvent(pluginId: string, e: BrowserEvent): void {
    const host = this.hosts.get(pluginId)
    if (host?.alive && !host.ended) void host.conn.sendNotification('browser/event', e)
  }

  /** Ferma l'adapter di un plugin (disattivazione, aggiornamento, disinstallazione). */
  async stopPlugin(pluginId: string): Promise<void> {
    const host = this.hosts.get(pluginId)
    if (!host) return
    const exited = this.shutdown(host)
    this.lost(host)
    await exited
  }

  /** Dopo un'installazione o un'attivazione: i documenti aperti vanno anche ai plugin nuovi. */
  async refresh(): Promise<void> {
    for (const doc of this.docs.values()) await this.attach(doc).catch(() => {})
  }

  /** Chiusura dell'app: ogni adapter chiude i suoi server (anche se l'app esce prima). */
  stopAll(): void {
    for (const h of this.hosts.values()) void this.shutdown(h)
    this.hosts.clear()
  }
}

const SEVERITY: Record<ApiDiagnostic['severity'], Diagnostic['severity']> = { error: 1, warning: 2, info: 3, hint: 4 }

function toDiagnostic(d: ApiDiagnostic): Diagnostic {
  return {
    severity: SEVERITY[d.severity] ?? 1,
    message: d.message,
    source: d.source,
    code: d.code,
    range: { startLine: d.range.start.line, startColumn: d.range.start.column, endLine: d.range.end.line, endColumn: d.range.end.column }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: nessuna risposta in ${Math.round(ms / 1000)} s`)), ms)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e))
    )
  })
}
