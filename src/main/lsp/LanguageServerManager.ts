import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from 'vscode-jsonrpc/node'
import type { Diagnostic, FileDiagnostics, LspLanguage, LspStatus } from '@shared/files'
import { normPath } from '@shared/files'

interface ServerCommand {
  file: string
  args: string[]
  env?: Record<string, string>
  initializationOptions?: unknown
}

interface Server {
  language: LspLanguage
  root: string
  proc: ChildProcess
  conn: MessageConnection
  ready: Promise<void>
  docs: Map<string, { uri: string; version: number }>
  status: LspStatus
  /** Il server usa la diagnostica «a richiesta» (textDocument/diagnostic), come TypeScript 7. */
  pull: boolean
  pullTimers: Map<string, NodeJS.Timeout>
}

/** File che indicano la radice di un progetto, per linguaggio. */
const ROOT_MARKERS: Record<LspLanguage, string[]> = {
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', '.project', '.git'],
  typescript: ['tsconfig.json', 'jsconfig.json', 'package.json', '.git'],
  python: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'pyrightconfig.json', '.git'],
  yaml: ['.git']
}

const LANGUAGE_IDS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascriptreact', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyi: 'python', java: 'java', yml: 'yaml', yaml: 'yaml'
}

export const toUri = (path: string): string => pathToFileURL(path).href
export const fromUri = (uri: string): string => fileURLToPath(uri)

/**
 * Language server per l'editor (F2, F3): uno per linguaggio e progetto, avviato alla prima apertura
 * di un file. Parla JSON-RPC su stdio; l'editor gli manda i documenti e riceve completamento,
 * descrizioni, definizioni e diagnostica.
 */
export class LanguageServerManager {
  private servers = new Map<string, Server>()

  constructor(
    private readonly command: (language: LspLanguage, root: string) => ServerCommand | 'needs-install' | null,
    private readonly onDiagnostics: (d: FileDiagnostics) => void,
    private readonly onStatus: (s: LspStatus) => void
  ) {}

  /** Radice del progetto per un file: la cartella più vicina con un file «marcatore», entro il workspace. */
  rootFor(language: LspLanguage, filePath: string, workspace?: string): string {
    const limit = workspace ? normPath(workspace) : null
    let dir = dirname(resolve(filePath))
    let found: string | null = null
    for (;;) {
      if (ROOT_MARKERS[language].some((m) => existsSync(join(dir, m)))) {
        found = dir
        // Per Java conviene il progetto Maven/Gradle più esterno (moduli multipli).
        if (language !== 'java') break
      }
      const parent = dirname(dir)
      if (parent === dir || (limit && normPath(dir) === limit)) break
      dir = parent
    }
    return found ?? workspace ?? dirname(resolve(filePath))
  }

  private key(language: LspLanguage, root: string): string {
    return `${language}|${normPath(root)}`
  }

  private setStatus(s: Server | null, status: LspStatus): void {
    if (s) s.status = status
    this.onStatus(status)
  }

  private ensure(language: LspLanguage, root: string): Server | null {
    const key = this.key(language, root)
    const existing = this.servers.get(key)
    if (existing && existing.status.state !== 'error' && existing.status.state !== 'stopped') return existing
    const cmd = this.command(language, root)
    if (cmd === 'needs-install') {
      this.onStatus({ language, root, state: 'needs-install', message: 'Il supporto per questo linguaggio non è ancora installato.' })
      return null
    }
    if (!cmd) return null

    const proc = spawn(cmd.file, cmd.args, { cwd: root, env: { ...process.env, ...cmd.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    proc.stderr?.on('data', () => {}) // i server scrivono molto su stderr: si ignora
    const conn = createMessageConnection(new StreamMessageReader(proc.stdout!), new StreamMessageWriter(proc.stdin!))
    const server: Server = {
      language,
      root,
      proc,
      conn,
      docs: new Map(),
      ready: Promise.resolve(),
      status: { language, root, state: 'starting' },
      pull: false,
      pullTimers: new Map()
    }
    this.servers.set(key, server)
    this.setStatus(server, { language, root, state: 'starting', message: 'Avvio del language server…' })

    // Richieste dal server: risposte semplici e sicure.
    conn.onRequest('workspace/configuration', (params: { items: unknown[] }) => params.items.map(() => null))
    conn.onRequest('client/registerCapability', () => null)
    conn.onRequest('client/unregisterCapability', () => null)
    conn.onRequest('window/workDoneProgress/create', () => null)
    conn.onRequest('window/showMessageRequest', () => null)
    conn.onRequest('workspace/workspaceFolders', () => [{ uri: toUri(root), name: root }])
    conn.onRequest('workspace/diagnostic/refresh', () => {
      for (const [key] of server.docs) this.schedulePull(server, key)
      return null
    })
    conn.onNotification('textDocument/publishDiagnostics', (p: { uri: string; diagnostics: LspDiagnostic[] }) => {
      try {
        this.onDiagnostics({ path: fromUri(p.uri), language, diagnostics: p.diagnostics.map(toDiagnostic) })
      } catch {
        // URI non di file: si ignora
      }
    })
    // jdtls: messaggi di stato durante l'importazione del progetto.
    conn.onNotification('language/status', (p: { type: string; message: string }) => {
      if (server.status.state === 'starting') this.setStatus(server, { language, root, state: 'starting', message: p.message })
    })
    conn.onError(() => {})
    conn.listen()

    proc.on('exit', (code) => {
      this.setStatus(server, { language, root, state: code === 0 ? 'stopped' : 'error', message: code === 0 ? undefined : `Il language server si è fermato (codice ${code}).` })
      conn.dispose()
    })
    proc.on('error', (err) => this.setStatus(server, { language, root, state: 'error', message: err.message }))

    server.ready = (async () => {
      const init = await conn.sendRequest<{ capabilities?: { diagnosticProvider?: unknown } }>('initialize', {
        processId: process.pid,
        clientInfo: { name: 'Claude Code Terminal' },
        locale: 'it',
        rootUri: toUri(root),
        rootPath: root,
        workspaceFolders: [{ uri: toUri(root), name: root }],
        initializationOptions: cmd.initializationOptions,
        capabilities: {
          textDocument: {
            synchronization: { didSave: true, dynamicRegistration: false },
            completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], insertReplaceSupport: false } },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: { linkSupport: true },
            publishDiagnostics: { relatedInformation: false, versionSupport: false },
            diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false }
          },
          workspace: { configuration: true, workspaceFolders: true, diagnostics: { refreshSupport: true } },
          window: { workDoneProgress: false }
        }
      })
      server.pull = Boolean(init?.capabilities?.diagnosticProvider)
      await conn.sendNotification('initialized', {})
      this.setStatus(server, { language, root, state: 'ready' })
    })().catch((err) => {
      this.setStatus(server, { language, root, state: 'error', message: `Avvio non riuscito: ${(err as Error).message}` })
    })
    return server
  }

  /** Diagnostica «a richiesta»: si chiede al server poco dopo l'apertura o l'ultima modifica. */
  private schedulePull(s: Server, key: string): void {
    if (!s.pull) return
    clearTimeout(s.pullTimers.get(key))
    s.pullTimers.set(
      key,
      setTimeout(async () => {
        const doc = s.docs.get(key)
        if (!doc || s.status.state !== 'ready') return
        try {
          const res = await s.conn.sendRequest<{ kind: string; items?: LspDiagnostic[] }>('textDocument/diagnostic', { textDocument: { uri: doc.uri } })
          if (res?.kind === 'full') this.onDiagnostics({ path: fromUri(doc.uri), language: s.language, diagnostics: (res.items ?? []).map(toDiagnostic) })
        } catch {
          // documento chiuso o server occupato: si riproverà alla prossima modifica
        }
      }, 400)
    )
  }

  private serverFor(language: LspLanguage, path: string, workspace?: string): Server | null {
    return this.ensure(language, this.rootFor(language, path, workspace))
  }

  async open(language: LspLanguage, path: string, text: string, workspace?: string): Promise<void> {
    const s = this.serverFor(language, path, workspace)
    if (!s) return
    await s.ready
    const k = normPath(path)
    if (s.docs.has(k)) return
    const uri = toUri(path)
    s.docs.set(k, { uri, version: 1 })
    const ext = path.toLowerCase().split('.').pop() ?? ''
    await s.conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: LANGUAGE_IDS[ext] ?? language, version: 1, text } })
    this.schedulePull(s, k)
  }

  async change(language: LspLanguage, path: string, text: string, workspace?: string): Promise<void> {
    const s = this.serverFor(language, path, workspace)
    if (!s) return
    await s.ready
    const doc = s.docs.get(normPath(path))
    if (!doc) return this.open(language, path, text, workspace)
    doc.version++
    // Sincronizzazione completa: si manda tutto il testo (semplice e accettato da tutti i server).
    await s.conn.sendNotification('textDocument/didChange', { textDocument: { uri: doc.uri, version: doc.version }, contentChanges: [{ text }] })
    this.schedulePull(s, normPath(path))
  }

  async save(language: LspLanguage, path: string, text: string, workspace?: string): Promise<void> {
    const s = this.serverFor(language, path, workspace)
    const doc = s?.docs.get(normPath(path))
    if (!s || !doc) return
    await s.ready
    await s.conn.sendNotification('textDocument/didSave', { textDocument: { uri: doc.uri }, text })
    this.schedulePull(s, normPath(path))
  }

  async close(language: LspLanguage, path: string, workspace?: string): Promise<void> {
    const s = this.servers.get(this.key(language, this.rootFor(language, path, workspace)))
    const doc = s?.docs.get(normPath(path))
    if (!s || !doc) return
    s.docs.delete(normPath(path))
    await s.ready
    await s.conn.sendNotification('textDocument/didClose', { textDocument: { uri: doc.uri } })
  }

  /** Richiesta di posizione (completamento, descrizione, definizione) sul file indicato. */
  async request(language: LspLanguage, path: string, method: string, params: Record<string, unknown>, workspace?: string): Promise<unknown> {
    const s = this.serverFor(language, path, workspace)
    if (!s) return null
    await s.ready
    if (s.status.state !== 'ready') return null
    return s.conn.sendRequest(method, { textDocument: { uri: toUri(path) }, ...params })
  }

  /** Stato di tutti i server (per l'interfaccia, all'apertura). */
  statuses(): LspStatus[] {
    return [...this.servers.values()].map((s) => s.status)
  }

  stopAll(): void {
    for (const s of this.servers.values()) {
      try {
        void s.conn.sendRequest('shutdown').then(() => s.conn.sendNotification('exit'))
      } catch {
        // già fermo
      }
      setTimeout(() => s.proc.kill(), 1500)
    }
    this.servers.clear()
  }
}

interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity?: number
  code?: string | number
  source?: string
  message: string
}

function toDiagnostic(d: LspDiagnostic): Diagnostic {
  return {
    severity: (d.severity ?? 1) as Diagnostic['severity'],
    message: d.message,
    source: d.source,
    code: d.code,
    // Monaco conta righe e colonne da 1, LSP da 0.
    range: { startLine: d.range.start.line + 1, startColumn: d.range.start.character + 1, endLine: d.range.end.line + 1, endColumn: d.range.end.character + 1 }
  }
}

/** Cartella dati di jdtls per un progetto (una per radice). */
export function jdtlsDataDir(base: string, root: string): string {
  const dir = join(base, 'jdtls-workspaces', createHash('sha1').update(normPath(root)).digest('hex').slice(0, 16))
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Il jar di avvio di jdtls (il nome contiene la versione). */
export function findLauncherJar(jdtlsDir: string): string | null {
  try {
    const name = readdirSync(join(jdtlsDir, 'plugins')).find((f) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(f))
    return name ? join(jdtlsDir, 'plugins', name) : null
  } catch {
    return null
  }
}
