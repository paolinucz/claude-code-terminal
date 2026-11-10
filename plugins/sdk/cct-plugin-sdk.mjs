// CCT Plugin SDK · per la CCT Plugin API v1 (docs/plugin-api.md). Nessuna dipendenza: si copia
// nel pacchetto del plugin accanto all'adapter.
//
//   runAdapter(handlers)  implementa il protocollo verso l'app: basta dare le funzioni.
//   lspAdapter(options)   adapter completo per un language server LSP (stdio o named pipe).
//
// L'app parla con l'adapter in JSON-RPC su stdin/stdout: per questo stdout è riservato e
// console.log scrive su stderr.

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const API_VERSION = 1

// ---------------------------------------------------------------------------------------------
// JSON-RPC con intestazioni Content-Length (lo stesso formato per l'app e per i language server)

export class Connection {
  #out
  #buf = Buffer.alloc(0)
  #id = 0
  #pending = new Map()
  #requests = new Map()
  #notifications = new Map()
  #closed = false
  #onClose = []
  /** Richieste senza gestore: per i language server rispondere null è la scelta più tollerata. */
  onUnhandledRequest = () => null
  onUnhandledNotification = () => {}
  onError = (err) => console.error(err)

  constructor(input, output) {
    this.#out = output
    input.on('data', (chunk) => this.#data(chunk))
    input.on('end', () => this.#close())
    input.on('close', () => this.#close())
    input.on('error', () => this.#close())
    output.on('error', () => this.#close())
  }

  get closed() {
    return this.#closed
  }

  onRequest(method, handler) {
    this.#requests.set(method, handler)
  }

  onNotification(method, handler) {
    this.#notifications.set(method, handler)
  }

  onClose(cb) {
    this.#onClose.push(cb)
  }

  request(method, params, timeoutMs) {
    if (this.#closed) return Promise.reject(new Error('connessione chiusa'))
    const id = ++this.#id
    return new Promise((res, rej) => {
      const timer = timeoutMs ? setTimeout(() => (this.#pending.delete(id), rej(new Error(`${method}: nessuna risposta in ${timeoutMs} ms`))), timeoutMs) : null
      this.#pending.set(id, {
        resolve: (v) => (clearTimeout(timer), res(v)),
        reject: (e) => (clearTimeout(timer), rej(e))
      })
      this.#send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method, params) {
    this.#send({ jsonrpc: '2.0', method, params })
  }

  #send(msg) {
    if (this.#closed) return
    const body = Buffer.from(JSON.stringify(msg), 'utf8')
    this.#out.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.#out.write(body)
  }

  #close() {
    if (this.#closed) return
    this.#closed = true
    for (const p of this.#pending.values()) p.reject(new Error('connessione chiusa'))
    this.#pending.clear()
    for (const cb of this.#onClose) cb()
  }

  #data(chunk) {
    this.#buf = this.#buf.length ? Buffer.concat([this.#buf, chunk]) : chunk
    for (;;) {
      const sep = this.#buf.indexOf('\r\n\r\n')
      if (sep < 0) return
      const m = /content-length:\s*(\d+)/i.exec(this.#buf.subarray(0, sep).toString('ascii'))
      if (!m) {
        this.#buf = this.#buf.subarray(sep + 4)
        continue
      }
      const end = sep + 4 + Number(m[1])
      if (this.#buf.length < end) return
      const body = this.#buf.subarray(sep + 4, end).toString('utf8')
      this.#buf = this.#buf.subarray(end)
      let msg
      try {
        msg = JSON.parse(body)
      } catch {
        continue
      }
      void this.#dispatch(msg)
    }
  }

  async #dispatch(msg) {
    if (typeof msg.method === 'string') {
      if (msg.id !== undefined && msg.id !== null) {
        const h = this.#requests.get(msg.method)
        try {
          const result = h ? await h(msg.params) : await this.onUnhandledRequest(msg.method, msg.params)
          this.#send({ jsonrpc: '2.0', id: msg.id, result: result ?? null })
        } catch (err) {
          this.#send({ jsonrpc: '2.0', id: msg.id, error: { code: err?.code ?? -32603, message: String(err?.message ?? err) } })
        }
      } else {
        try {
          const h = this.#notifications.get(msg.method)
          await (h ? h(msg.params) : this.onUnhandledNotification(msg.method, msg.params))
        } catch (err) {
          this.onError(err)
        }
      }
    } else if (msg.id !== undefined) {
      const p = this.#pending.get(msg.id)
      if (!p) return
      this.#pending.delete(msg.id)
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code, data: msg.error.data }))
      else p.resolve(msg.result)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Protocollo verso l'app

/**
 * Avvia l'adapter. `handlers` (tutte facoltative):
 * - initialize(ctx, app) → capabilities parziali (le altre si deducono dalle funzioni presenti)
 * - open({path, languageId, text, workspace}), change({path, text}), save({path, text}), close({path})
 * - completion({path, position}), hover(...), definition(...)
 * - call(method, params): richieste proprie del plugin (l'app le manda con `PluginHost.call`)
 * - shutdown()
 *
 * `app` serve per mandare all'app: app.diagnostics(path, source, items), app.status(s), app.log(level, message), e per
 * usare i servizi dell'app (Plugin API «host/…»): app.settings.get/set, app.session.create/kill/status,
 * app.plugin(idPlugin, metodo, parametri) verso un plugin richiesto, app.emit(evento, dati) verso le pagine del plugin,
 * app.notify(messaggio, tipo) per un avviso, app.terminal.show(idSessione) per mostrare il terminale di una sessione,
 * app.terminal.hive(chiave, titolo, idSessioni) per mostrarne più insieme in un mosaico.
 */
export function runAdapter(handlers) {
  // stdout è il canale del protocollo.
  console.log = console.info = console.debug = console.error
  const conn = new Connection(process.stdin, process.stdout)
  const app = {
    diagnostics: (path, source, items) => conn.notify('diagnostics', { path, source, items }),
    status: (s) => conn.notify('status', s),
    log: (level, message) => conn.notify('log', { level, message }),
    // Servizi dell'app. Le impostazioni valgono solo per le chiavi «plugin.<id>.…» o per i prefissi dichiarati nel manifest.
    settings: {
      get: (key) => conn.request('host/settings.get', { key }, 15000),
      set: (key, value) => conn.request('host/settings.set', { key, value }, 15000)
    },
    session: {
      create: (request) => conn.request('host/session.create', { request }, 60000),
      kill: (id) => conn.request('host/session.kill', { id }, 15000),
      status: (id) => conn.request('host/session.status', { id }, 15000)
    },
    plugin: (plugin, method, params = {}) => conn.request('host/plugin.call', { plugin, method, params }),
    // Segni nel margine dell'editor (contributo `editorGutter`): tipi 'breakpoint', 'breakpoint-disabled', 'stopped'.
    // `markers(path, [{line, kind, hint?, reveal?}])` sostituisce i segni di quel file; `clearMarkers()` li toglie tutti.
    editor: {
      markers: (path, markers) => conn.notify('editor/markers', { path, markers }),
      clearMarkers: () => conn.notify('editor/markers', { path: null, markers: [] })
    },
    // Avviso nell'app (toast). `kind`: 'info' (predefinito), 'ok', 'warn', 'error'.
    notify: (message, kind = 'info') => conn.notify('ui/notify', { message, kind }),
    // Mostra in un pannello il terminale di una sessione avviata con `session.create` (serve il permesso `terminal`).
    terminal: {
      show: (sessionId) => conn.notify('ui/terminal.show', { sessionId }),
      // Vista «alveare»: un pannello con più terminali in un mosaico. `key` è stabile (la stessa chiave aggiorna lo stesso
      // pannello, con l'elenco nuovo); si può richiamare man mano che le sessioni partono (serve il permesso `terminal`).
      hive: (key, title, sessionIds) => conn.notify('ui/terminal.hive', { key, title, sessionIds })
    },
    /** Evento per le pagine di questo plugin (le mostra l'interfaccia): avanzamento, stato del debug… */
    emit: (event, data) => conn.notify('ui/event', { event, data })
  }
  process.on('uncaughtException', (err) => app.log('error', `Errore nell'adapter: ${err?.stack ?? err}`))
  process.on('unhandledRejection', (err) => app.log('error', `Errore nell'adapter: ${err?.stack ?? err}`))

  let stopping = null
  const stop = () => (stopping ??= Promise.resolve(handlers.shutdown?.()).catch(() => {}))

  conn.onRequest('initialize', async (params) => {
    if (params.apiVersion !== API_VERSION) app.log('warn', `L'app usa la versione ${params.apiVersion} dell'API, l'adapter la ${API_VERSION}.`)
    const ctx = createContext(params)
    const caps = (await handlers.initialize?.(ctx, app)) ?? {}
    return {
      capabilities: {
        completion: Boolean(handlers.completion),
        hover: Boolean(handlers.hover),
        definition: Boolean(handlers.definition),
        diagnostics: true,
        ...caps
      }
    }
  })
  conn.onRequest('completion', async (p) => (handlers.completion ? ((await handlers.completion(p)) ?? { items: [], incomplete: false }) : { items: [], incomplete: false }))
  conn.onRequest('hover', async (p) => (handlers.hover ? ((await handlers.hover(p)) ?? null) : null))
  conn.onRequest('definition', async (p) => (handlers.definition ? ((await handlers.definition(p)) ?? []) : []))
  // Richieste proprie del plugin oltre alla Plugin API di base (es. comandi del server per il debug): `handlers.call(method, params)`.
  conn.onRequest('call', async (p) => {
    if (!handlers.call) throw new Error(`Il plugin non gestisce «${p?.method}».`)
    return (await handlers.call(p.method, p.params ?? {})) ?? null
  })
  conn.onRequest('shutdown', async () => {
    await stop()
    setTimeout(() => process.exit(0), 50)
    return null
  })
  conn.onNotification('document/open', (p) => handlers.open?.(p))
  conn.onNotification('document/change', (p) => handlers.change?.(p))
  conn.onNotification('document/save', (p) => handlers.save?.(p))
  conn.onNotification('document/close', (p) => handlers.close?.(p))
  // L'app si è chiusa senza shutdown: si fermano comunque i server.
  conn.onClose(() => void stop().finally(() => process.exit(0)))
  return app
}

/** Contesto passato all'adapter: cartelle del plugin, runtime e funzioni di comodo. */
function createContext(params) {
  const ctx = {
    apiVersion: params.apiVersion,
    plugin: params.plugin,
    runtimes: params.runtimes ?? {},
    locale: params.locale ?? 'it',
    /** Comando per un runtime fornito da un plugin (es. «java»), con gli argomenti aggiunti. */
    runtime(name, args = []) {
      const rt = ctx.runtimes[name]
      if (!rt) throw new Error(`Runtime «${name}» non disponibile: installa e attiva il plugin che lo fornisce.`)
      return { command: rt.command, args: [...(rt.args ?? []), ...args] }
    },
    /** Comando per uno script Node (Electron in modalità Node, già impostata per l'adapter). */
    node(script, args = []) {
      return { command: process.execPath, args: [script, ...args], env: { ELECTRON_RUN_AS_NODE: '1' } }
    },
    /** Cartella dati scrivibile, separata per progetto. */
    dataDirFor(root) {
      const dir = join(ctx.plugin.dataDir, createHash('sha1').update(root.toLowerCase()).digest('hex').slice(0, 12))
      mkdirSync(dir, { recursive: true })
      return dir
    }
  }
  return ctx
}

// ---------------------------------------------------------------------------------------------
// Utilità

export const normPath = (p) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
export const toUri = (path) => pathToFileURL(path).href
export const fromUri = (uri) => fileURLToPath(uri)

/**
 * Radice del progetto: la cartella con uno dei `markers`, risalendo dal file fino al workspace.
 * «outermost» prende la più esterna (progetti multi-modulo), «nearest» la più vicina.
 */
export function findRoot(file, workspace, markers = ['.git'], strategy = 'nearest') {
  const limit = workspace ? normPath(workspace) : null
  let dir = dirname(resolve(file))
  let found = null
  for (;;) {
    if (markers.some((m) => existsSync(join(dir, m)))) {
      found = dir
      if (strategy !== 'outermost') break
    }
    const parent = dirname(dir)
    if (parent === dir || (limit && normPath(dir) === limit)) break
    dir = parent
  }
  return found ?? workspace ?? dirname(resolve(file))
}

/** Valore di una sezione «a.b.c» nelle impostazioni. */
export function lookup(obj, section) {
  if (!section) return obj
  if (obj && section in obj) return obj[section]
  let cur = obj
  for (const part of section.split('.')) {
    if (!cur || typeof cur !== 'object' || !(part in cur)) return null
    cur = cur[part]
  }
  return cur
}

// ---- conversioni LSP → CCT Plugin API (righe e colonne da 1) ----

const SEVERITY = [undefined, 'error', 'warning', 'info', 'hint']
const KINDS = [undefined, 'text', 'method', 'function', 'constructor', 'field', 'variable', 'class', 'interface', 'module', 'property', 'unit', 'value', 'enum', 'keyword', 'snippet', 'color', 'file', 'reference', 'folder', 'enumMember', 'constant', 'struct', 'event', 'operator', 'typeParameter']

export const lsp = {
  position: (p) => ({ line: p.line - 1, character: p.column - 1 }),
  toPosition: (p) => ({ line: p.line + 1, column: p.character + 1 }),
  toRange: (r) => ({ start: lsp.toPosition(r.start), end: lsp.toPosition(r.end) }),

  toDiagnostic: (d) => ({
    severity: SEVERITY[d.severity ?? 1] ?? 'error',
    message: d.message,
    code: d.code === undefined || d.code === null ? undefined : String(d.code),
    source: d.source,
    range: lsp.toRange(d.range)
  }),

  markdown(c) {
    if (c === undefined || c === null) return []
    if (Array.isArray(c)) return c.flatMap((x) => lsp.markdown(x))
    if (typeof c === 'string') return c ? [c] : []
    if ('kind' in c) return c.value ? [c.value] : []
    if ('language' in c) return c.value ? ['```' + c.language + '\n' + c.value + '\n```'] : []
    return []
  },

  toHover: (h) => {
    const contents = h ? lsp.markdown(h.contents) : []
    return contents.length ? { contents, range: h.range ? lsp.toRange(h.range) : undefined } : null
  },

  toLocations(res) {
    if (!res) return []
    return (Array.isArray(res) ? res : [res])
      .map((l) => ('targetUri' in l ? { uri: l.targetUri, range: l.targetSelectionRange ?? l.targetRange } : l))
      .filter((l) => l?.uri?.startsWith('file:'))
      .map((l) => ({ path: fromUri(l.uri), range: lsp.toRange(l.range) }))
  },

  toCompletionList(res) {
    if (!res) return { items: [], incomplete: false }
    const list = Array.isArray(res) ? { items: res, isIncomplete: false } : res
    const defaults = list.itemDefaults ?? {}
    return {
      incomplete: Boolean(list.isIncomplete),
      items: (list.items ?? []).map((it) => {
        const label = typeof it.label === 'string' ? it.label : it.label?.label ?? ''
        let edit = it.textEdit
        if (!edit && defaults.editRange) edit = { newText: it.textEditText ?? it.insertText ?? label, ...('insert' in defaults.editRange ? { insert: defaults.editRange.insert } : { range: defaults.editRange }) }
        const range = edit ? ('range' in edit ? edit.range : edit.insert) : undefined
        const doc = it.documentation
        return {
          label,
          kind: KINDS[it.kind ?? 1] ?? 'text',
          detail: it.detail ?? it.labelDetails?.description,
          documentation: typeof doc === 'string' ? doc : doc?.value,
          insertText: edit?.newText ?? it.insertText ?? label,
          snippet: (it.insertTextFormat ?? defaults.insertTextFormat) === 2,
          range: range ? lsp.toRange(range) : undefined,
          sortText: it.sortText,
          filterText: it.filterText
        }
      })
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Adapter per un language server LSP

/**
 * Adapter completo per un language server LSP. Opzioni:
 *
 * - id                 id del server (predefinito «lsp»), usato per stato e diagnostica
 * - name               nome per l'utente; stringa o (ctx) => stringa
 * - server(ctx, root)  comando: { command, args, env?, transport?: 'stdio' | 'pipe' }.
 *                      Con «pipe» l'SDK apre una named pipe e mette il suo nome al posto di ${pipe} negli argomenti.
 * - rootMarkers        file che indicano la radice del progetto (predefinito [".git"])
 * - rootStrategy       «nearest» (predefinito) o «outermost»
 * - activationFiles    il server parte solo se nella radice c'è uno di questi file
 * - languageId(path, languageId)          linguaggio LSP del documento, se diverso
 * - initializationOptions(ctx, root)      opzioni di initialize
 * - settings           risposte a workspace/configuration; oggetto o (ctx, root) => oggetto
 * - onNotification     { metodo: (params, server) => … } per le notifiche proprie del server
 * - onRequest          { metodo: (params, server) => risultato } per le richieste proprie del server
 * - onReady(server)    dopo initialized
 *
 * `server` (nei gestori) ha: root, conn, setMessage(testo), setStatus(stato, testo), log(livello, testo).
 */
export function lspAdapter(options) {
  const id = options.id ?? 'lsp'
  /** radice (normalizzata) → server */
  const servers = new Map()
  /** documento (normalizzato) → { path, uri, languageId, version, text, server } */
  const docs = new Map()
  let ctx
  let app
  let name = ''

  function ensure(root) {
    const key = normPath(root)
    const existing = servers.get(key)
    if (existing && existing.alive) return existing
    const s = startServer(root)
    servers.set(key, s)
    return s
  }

  function startServer(root) {
    const statusId = `${id}|${root}`
    const s = {
      root,
      alive: true,
      ready: null,
      conn: null,
      proc: null,
      pull: false,
      pullTimers: new Map(),
      opened: new Set(),
      published: new Set(),
      state: 'starting',
      setStatus(state, message) {
        s.state = state
        app.status({ id: statusId, name, root, state, message })
      },
      setMessage(message) {
        if (s.state === 'starting') s.setStatus('starting', message)
      },
      log: (level, message) => app.log(level, message)
    }
    s.setStatus('starting', 'Avvio…')

    let spec
    try {
      spec = options.server(ctx, root)
    } catch (err) {
      s.alive = false
      s.ready = Promise.resolve()
      s.setStatus('error', err.message)
      return s
    }
    const pipe = spec.transport === 'pipe' ? `\\\\.\\pipe\\cct-lsp-${randomUUID()}` : null
    let pipeServer = null
    const socket = pipe
      ? new Promise((res, rej) => {
          pipeServer = createServer((sock) => res(sock))
          pipeServer.on('error', rej)
          pipeServer.listen(pipe)
          setTimeout(() => rej(new Error('il server non si è collegato alla pipe entro 60 secondi')), 60000)
        })
      : null
    const args = pipe ? spec.args.map((a) => a.split('${pipe}').join(pipe)) : spec.args
    const proc = spawn(spec.command, args, { cwd: spec.cwd ?? root, env: { ...process.env, ...(spec.env ?? {}) }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    s.proc = proc
    let lastErr = ''
    proc.stderr.on('data', (d) => {
      const lines = String(d).split(/\r?\n/).filter((l) => l.trim())
      if (lines.length) lastErr = lines[lines.length - 1].slice(0, 300)
    })
    if (pipe) proc.stdout.on('data', () => {})
    proc.on('error', (err) => {
      s.alive = false
      s.setStatus('error', `Avvio non riuscito: ${err.message}`)
    })
    proc.on('exit', (code) => {
      pipeServer?.close()
      const wasAlive = s.alive
      s.alive = false
      clearDiagnostics(s)
      if (s.stopping) return s.setStatus('stopped')
      if (!wasAlive) return // errore già segnalato
      s.setStatus(code === 0 ? 'stopped' : 'error', code === 0 ? undefined : `Il language server si è fermato (codice ${code})${lastErr ? `: ${lastErr}` : ''}.`)
    })

    s.ready = (async () => {
      const conn = socket ? await socket.then((sock) => new Connection(sock, sock)) : new Connection(proc.stdout, proc.stdin)
      s.conn = conn
      wire(s, conn)
      const init = await conn.request('initialize', {
        processId: process.pid,
        clientInfo: { name: 'Magnolia' },
        locale: ctx.locale,
        rootUri: toUri(root),
        rootPath: root,
        workspaceFolders: [{ uri: toUri(root), name: root }],
        initializationOptions: options.initializationOptions?.(ctx, root),
        capabilities: {
          textDocument: {
            synchronization: { didSave: true, dynamicRegistration: false },
            completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], insertReplaceSupport: true, labelDetailsSupport: true }, completionList: { itemDefaults: ['editRange', 'insertTextFormat'] } },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: { linkSupport: true },
            publishDiagnostics: { relatedInformation: false, versionSupport: false },
            diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false }
          },
          workspace: { configuration: true, workspaceFolders: true, diagnostics: { refreshSupport: true } },
          window: { workDoneProgress: false }
        }
      })
      s.pull = Boolean(init?.capabilities?.diagnosticProvider)
      conn.notify('initialized', {})
      const settings = settingsFor(root)
      if (settings && Object.keys(settings).length) conn.notify('workspace/didChangeConfiguration', { settings })
      await options.onReady?.(s)
      if (s.alive) s.setStatus('ready')
    })().catch((err) => {
      if (!s.alive) return
      s.alive = false
      s.setStatus('error', `Avvio non riuscito: ${err.message}${lastErr ? ` (${lastErr})` : ''}`)
      try {
        proc.kill()
      } catch {}
    })
    return s
  }

  function settingsFor(root) {
    return typeof options.settings === 'function' ? options.settings(ctx, root) : (options.settings ?? {})
  }

  function wire(s, conn) {
    conn.onUnhandledRequest = () => null
    conn.onRequest('workspace/configuration', (p) => {
      const settings = settingsFor(s.root)
      return (p?.items ?? []).map((it) => lookup(settings, it.section) ?? null)
    })
    conn.onRequest('workspace/workspaceFolders', () => [{ uri: toUri(s.root), name: s.root }])
    conn.onRequest('workspace/diagnostic/refresh', () => {
      for (const k of s.opened) schedulePull(s, k)
      return null
    })
    conn.onNotification('textDocument/publishDiagnostics', (p) => {
      if (!p?.uri?.startsWith('file:')) return
      const path = fromUri(p.uri)
      s.published.add(path)
      app.diagnostics(path, id, (p.diagnostics ?? []).map(lsp.toDiagnostic))
    })
    conn.onNotification('window/logMessage', () => {})
    for (const [method, h] of Object.entries(options.onNotification ?? {})) conn.onNotification(method, (p) => h(p, s))
    for (const [method, h] of Object.entries(options.onRequest ?? {})) conn.onRequest(method, (p) => h(p, s))
  }

  function clearDiagnostics(s) {
    for (const path of s.published) app.diagnostics(path, id, [])
    s.published.clear()
  }

  /** Diagnostica «a richiesta» (textDocument/diagnostic), poco dopo l'apertura o l'ultima modifica. */
  function schedulePull(s, k) {
    if (!s.pull) return
    clearTimeout(s.pullTimers.get(k))
    s.pullTimers.set(
      k,
      setTimeout(async () => {
        const doc = docs.get(k)
        if (!doc || !s.alive || s.state !== 'ready') return
        try {
          const res = await s.conn.request('textDocument/diagnostic', { textDocument: { uri: doc.uri } })
          if (res?.kind === 'full') {
            s.published.add(doc.path)
            app.diagnostics(doc.path, id, (res.items ?? []).map(lsp.toDiagnostic))
          }
        } catch {
          // documento chiuso o server occupato: si riprova alla prossima modifica
        }
      }, 400)
    )
  }

  async function openIn(s, doc) {
    await s.ready
    if (!s.alive || s.opened.has(normPath(doc.path))) return
    const k = normPath(doc.path)
    s.opened.add(k)
    s.conn.notify('textDocument/didOpen', { textDocument: { uri: doc.uri, languageId: doc.languageId, version: doc.version, text: doc.text } })
    schedulePull(s, k)
  }

  async function withDoc(path, fn, fallback) {
    const doc = docs.get(normPath(path))
    const s = doc?.server
    if (!s?.alive) return fallback
    await s.ready
    if (!s.alive || s.state !== 'ready') return fallback
    try {
      return await fn(s, doc)
    } catch {
      return fallback
    }
  }

  return runAdapter({
    initialize(c, a) {
      ctx = c
      app = a
      name = typeof options.name === 'function' ? options.name(ctx) : (options.name ?? id)
      return { completion: true, hover: true, definition: true, diagnostics: true }
    },

    async open(p) {
      const k = normPath(p.path)
      const root = findRoot(p.path, p.workspace, options.rootMarkers, options.rootStrategy)
      if (options.activationFiles?.length && !options.activationFiles.some((f) => existsSync(join(root, f)))) return
      const languageId = options.languageId ? options.languageId(p.path, p.languageId) : p.languageId
      const prev = docs.get(k)
      const s = prev?.server?.alive ? prev.server : ensure(root)
      const doc = { path: p.path, uri: toUri(p.path), languageId, version: (prev?.version ?? 0) + 1, text: p.text, server: s }
      docs.set(k, doc)
      if (prev && prev.server === s && s.opened.has(k)) {
        s.conn.notify('textDocument/didChange', { textDocument: { uri: doc.uri, version: doc.version }, contentChanges: [{ text: doc.text }] })
        schedulePull(s, k)
        return
      }
      await openIn(s, doc)
    },

    async change(p) {
      const k = normPath(p.path)
      const doc = docs.get(k)
      if (!doc) return
      doc.text = p.text
      doc.version++
      const s = doc.server
      await s.ready
      if (!s.alive || !s.opened.has(k)) return
      // Sincronizzazione completa: si manda tutto il testo (accettato da tutti i server).
      s.conn.notify('textDocument/didChange', { textDocument: { uri: doc.uri, version: doc.version }, contentChanges: [{ text: p.text }] })
      schedulePull(s, k)
    },

    async save(p) {
      const k = normPath(p.path)
      const doc = docs.get(k)
      if (!doc) return
      const s = doc.server
      await s.ready
      if (!s.alive || !s.opened.has(k)) return
      s.conn.notify('textDocument/didSave', { textDocument: { uri: doc.uri }, text: p.text })
      schedulePull(s, k)
    },

    async close(p) {
      const k = normPath(p.path)
      const doc = docs.get(k)
      if (!doc) return
      docs.delete(k)
      const s = doc.server
      await s.ready
      if (!s.alive || !s.opened.delete(k)) return
      s.conn.notify('textDocument/didClose', { textDocument: { uri: doc.uri } })
    },

    completion: (p) =>
      withDoc(p.path, async (s, doc) => lsp.toCompletionList(await s.conn.request('textDocument/completion', { textDocument: { uri: doc.uri }, position: lsp.position(p.position) }, 15000)), { items: [], incomplete: false }),

    hover: (p) => withDoc(p.path, async (s, doc) => lsp.toHover(await s.conn.request('textDocument/hover', { textDocument: { uri: doc.uri }, position: lsp.position(p.position) }, 15000)), null),

    definition: (p) => withDoc(p.path, async (s, doc) => lsp.toLocations(await s.conn.request('textDocument/definition', { textDocument: { uri: doc.uri }, position: lsp.position(p.position) }, 15000)), []),

    /**
     * Richieste dell'app che attraversano l'adapter verso il language server:
     * - `lsp/executeCommand` {workspace, root, command, arguments, timeout}: comando del server (per esempio quelli di java-debug);
     * - `lsp/state` {workspace, root}: stato del server di quel progetto.
     * Si usa il server già avviato che contiene la cartella; se non c'è, si avvia quello della radice del progetto.
     */
    async call(method, p) {
      if (method !== 'lsp/executeCommand' && method !== 'lsp/state') throw new Error(`Metodo non gestito: ${method}`)
      const root = p.root ? resolve(p.root) : null
      if (!root) throw new Error('Manca la cartella del progetto.')
      const under = [...servers.values()].filter((x) => x.alive && (normPath(root) === normPath(x.root) || normPath(root).startsWith(normPath(x.root) + '\\')))
      let s = under.sort((a, b) => a.root.length - b.root.length)[0]
      if (method === 'lsp/state') return s ? { state: s.state, root: s.root } : { state: 'stopped', root }
      if (!s) {
        const start = findRoot(join(root, 'pom.xml'), p.workspace, options.rootMarkers, options.rootStrategy)
        s = ensure(start)
      }
      await s.ready
      if (!s.alive) throw new Error('Il language server non è attivo.')
      return await s.conn.request('workspace/executeCommand', { command: p.command, arguments: p.arguments ?? [] }, p.timeout ?? 60000)
    },

    async shutdown() {
      await Promise.all(
        [...servers.values()].map(async (s) => {
          if (!s.alive) return
          s.stopping = true
          try {
            await s.ready
            await s.conn?.request('shutdown', null, 3000)
            s.conn?.notify('exit')
          } catch {
            // il server non risponde: si chiude comunque
          }
          // L'adapter sta per uscire: il server va chiuso prima, altrimenti resterebbe orfano.
          await new Promise((res) => {
            if (!s.proc?.pid || s.proc.exitCode !== null) return res()
            const t = setTimeout(() => {
              try {
                s.proc.kill()
              } catch {}
              res()
            }, 1500)
            s.proc.once('exit', () => (clearTimeout(t), res()))
          })
        })
      )
    }
  })
}
