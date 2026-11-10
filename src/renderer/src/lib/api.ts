import { compileMatcher, searchText } from '@shared/search'
import type { AppApi, NamedLayout, Sheet, WorkspaceState } from '@shared/types'
import type { SessionAttention, SessionInfo } from '@shared/sessions'
import { emptyProjectFile } from '@shared/project'
import { isOpen, type FileChange, type RevisionRequest } from '@shared/changes'
import type { FileDiagnostics, LspStatus } from '@shared/files'
import type { GutterMarker, InstalledPlugin, PluginLanguageInfo, PluginManifest } from '@shared/plugins'
import type {
  Decision,
  ExternalChange,
  PermissionRule,
  PermissionScope,
  PermissionsState,
  RuleOrigin,
  ScopeData
} from '@shared/permissions'

/**
 * In Electron usa `window.api` (SQLite nel processo principale).
 * Nel browser (npm run web) usa localStorage, così l'interfaccia si può provare anche senza Electron.
 */
function createLocalStorageApi(): AppApi {
  const KEY = 'cct.workspace.v1'
  const LAYOUTS = 'cct.layouts.v1'
  const read = <T>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  }
  const write = (key: string, value: unknown): void => localStorage.setItem(key, JSON.stringify(value))

  return {
    backend: 'localStorage',
    workspace: {
      async load() {
        return read<WorkspaceState>(KEY, { sheets: [], activeSheetId: null })
      },
      async saveSheets(sheets, activeSheetId) {
        const current = read<WorkspaceState>(KEY, { sheets: [], activeSheetId: null })
        const byId = new Map(current.sheets.map((s) => [s.id, s]))
        const next: Sheet[] = sheets.map((s) => ({ id: s.id, name: s.name, contextId: s.contextId ?? null, layout: byId.get(s.id)?.layout ?? null }))
        write(KEY, { sheets: next, activeSheetId })
      },
      async saveSheetLayout(sheetId, layout) {
        const current = read<WorkspaceState>(KEY, { sheets: [], activeSheetId: null })
        write(KEY, { ...current, sheets: current.sheets.map((s) => (s.id === sheetId ? { ...s, layout } : s)) })
      }
    },
    transcript: {
      async open() {
        return []
      },
      close() {},
      onUpdate() {
        return () => {}
      }
    },
    explain: {
      async peek() {
        return null
      },
      async run() {
        // Nel browser non c'è Claude Code: si mostra il riepilogo in testo.
        return { ok: true, kind: 'text', text: 'Anteprima nel browser: la spiegazione smart è disponibile solo nell’app.', warning: 'Claude Code non disponibile nel browser' }
      },
      async snippet() {
        return { ok: false, error: 'La spiegazione con Haiku è disponibile solo nell’app (serve Claude Code).' }
      },
      async cancel() {}
    },
    project: {
      async open(path) {
        const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
        return { ok: true, value: { root: path, file: null, data: emptyProjectFile(name) } }
      },
      async create(root, name) {
        const n = name?.trim() || root.split(/[\\/]/).filter(Boolean).pop() || root
        return { ok: true, value: { root, file: `${root}\\${n}.cctproj`, data: emptyProjectFile(n) } }
      },
      async save(root, data) {
        return { ok: true, value: { root, file: `${root}\\${data.name}.cctproj`, data } }
      },
      async recents() {
        return []
      },
      async forget() {},
      async pickFile() {
        return window.prompt('File di progetto (demo nel browser)', 'C:\\progetti\\api-server\\api-server.cctproj')
      },
      async pickRelative(_root, mode) {
        const v = window.prompt(mode === 'docs' ? 'Documento (percorso relativo, demo nel browser)' : 'Cartella (percorso relativo, demo nel browser)', mode === 'docs' ? 'docs/architettura.md' : 'src')
        return { paths: v ? [v] : [], skipped: 0 }
      }
    },
    layouts: {
      async list() {
        return read<NamedLayout[]>(LAYOUTS, []).sort((a, b) => a.name.localeCompare(b.name))
      },
      async save(name, layout) {
        const all = read<NamedLayout[]>(LAYOUTS, [])
        const existing = all.find((l) => l.name.toLowerCase() === name.toLowerCase())
        const item: NamedLayout = { id: existing?.id ?? crypto.randomUUID(), name, layout, createdAt: new Date().toISOString() }
        write(LAYOUTS, [...all.filter((l) => l.id !== item.id), item])
        return item
      },
      async remove(id) {
        write(LAYOUTS, read<NamedLayout[]>(LAYOUTS, []).filter((l) => l.id !== id))
      }
    },
    ...createDemoFiles(),
    changes: createDemoChanges(),
    permissions: createDemoPermissions(),
    updates: {
      info: async () => ({ version: '0.0.0-web', packaged: false }),
      status: async () => ({ state: 'disabled', reason: 'Anteprima nel browser.' }),
      check: async () => ({ state: 'disabled', reason: 'Anteprima nel browser.' }),
      async install() {},
      onStatus: () => () => {}
    },
    settings: {
      async get(key) {
        return read<unknown>(`cct.setting.${key}`, undefined)
      },
      async set(key, value) {
        write(`cct.setting.${key}`, value)
      }
    },
    ...createDemoSessions()
  }
}

/** File e language server finti per il browser: il progetto Java del mockup, con una diagnostica di prova. */
function createDemoFiles(): Pick<AppApi, 'files' | 'lsp' | 'plugins'> {
  const root = 'C:\\Users\\demo'
  const pkg = `${root}\\src\\main\\java\\it\\acme\\orders`
  const contents: Record<string, string> = {
    [`${root}\\pom.xml`]: '<project>\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>it.acme</groupId>\n  <artifactId>api-server</artifactId>\n</project>\n',
    [`${root}\\README.md`]: '# api-server\n',
    [`${pkg}\\OrderService.java`]: 'package it.acme.orders;\n\npublic class OrderService {\n  private final OrderRepository repo;\n\n  public void cancel(Long id) {\n    Order o = repo.findById(id).orElseThrow();\n    o.setStatus(Status.CANCELLED)\n    repo.save(o);\n  }\n}\n',
    [`${pkg}\\Order.java`]: 'package it.acme.orders;\n\npublic class Order {\n}\n',
    [`${pkg}\\OrderMapper.java`]: 'package it.acme.orders;\n\npublic class OrderMapper {\n}\n',
    [`${root}\\src\\main\\resources\\application.yml`]: 'server:\n  port: 8080\n'
  }
  const isDir = (p: string) => Object.keys(contents).some((f) => f.toLowerCase().startsWith(p.toLowerCase() + '\\'))
  const diagListeners = new Set<(d: FileDiagnostics) => void>()
  const statusListeners = new Set<(s: LspStatus) => void>()
  return {
    files: {
      async list(dir) {
        const names = new Set<string>()
        for (const f of Object.keys(contents)) {
          if (!f.toLowerCase().startsWith(dir.toLowerCase() + '\\')) continue
          names.add(f.slice(dir.length + 1).split('\\')[0])
        }
        return [...names]
          .map((name) => ({ name, path: `${dir}\\${name}`, dir: isDir(`${dir}\\${name}`) }))
          .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
      },
      async read(path) {
        return { path, text: contents[path] ?? '', mtime: 1, binary: false, tooLarge: false }
      },
      async write(path, text) {
        contents[path] = text
        return { ok: true, mtime: Date.now() }
      },
      async gitStatus() {
        return { root, branch: 'feature/order-cancel', files: { [`${pkg}\\orderservice.java`.toLowerCase()]: 'M', [`${pkg}\\ordermapper.java`.toLowerCase()]: 'A' } }
      },
      async index(root) {
        const prefix = root.toLowerCase() + '\\'
        const files = Object.keys(contents).filter((f) => f.toLowerCase().startsWith(prefix)).map((f) => f.slice(prefix.length))
        return { root, truncated: false, files }
      },
      async search(root, query, opts) {
        const prefix = root.toLowerCase() + '\\'
        let re: RegExp
        try {
          re = compileMatcher(query, opts)
        } catch (e) {
          return { ok: false, error: (e as Error).message, root, files: [], total: 0, truncated: false, searched: 0 }
        }
        const files = Object.keys(contents)
          .filter((f) => f.toLowerCase().startsWith(prefix))
          .flatMap((f) => {
            const matches = searchText(contents[f], re)
            return matches.length ? [{ file: f.slice(prefix.length), matches }] : []
          })
        return { ok: true, root, files, total: files.reduce((n, f) => n + f.matches.length, 0), truncated: false, searched: Object.keys(contents).length }
      },
      watch() {},
      unwatch() {},
      async reveal() {},
      onChanged: () => () => {}
    },
    lsp: {
      open(path) {
        if (!path.endsWith('OrderService.java')) return
        setTimeout(
          () =>
            diagListeners.forEach((cb) =>
              cb({ path, server: 'cct.java/jdtls|demo', diagnostics: [{ severity: 1, message: 'Syntax error, insert ";" to complete BlockStatements', source: 'Java', range: { startLine: 8, startColumn: 34, endLine: 8, endColumn: 35 } }, { severity: 2, message: 'The value of the field OrderService.repo is not used', source: 'Java', range: { startLine: 4, startColumn: 33, endLine: 4, endColumn: 37 } }] })
            ),
          600
        )
        setTimeout(() => statusListeners.forEach((cb) => cb({ key: 'cct.java/jdtls|demo', pluginId: 'cct.java', name: 'Eclipse JDT Language Server', languages: ['java'], root, state: 'ready' })), 300)
      },
      change() {},
      save() {},
      close() {},
      async completion() {
        return { items: [], incomplete: false }
      },
      async hover() {
        return null
      },
      async definition() {
        return []
      },
      async statuses() {
        return []
      },
      onDiagnostics: (cb) => (diagListeners.add(cb), () => diagListeners.delete(cb)),
      onStatus: (cb) => (statusListeners.add(cb), () => statusListeners.delete(cb))
    },
    plugins: createDemoPlugins()
  }
}

/** Plugin finti per il browser: Java installato, e un pacchetto Maven da «importare». */
function createDemoPlugins(): AppApi['plugins'] {
  const java: PluginManifest = {
    id: 'cct.java', name: 'Java', version: '1.0.0', publisher: 'Magnolia', license: 'EPL-2.0',
    description: 'Eclipse JDT Language Server con un JRE 25 Temurin.',
    languages: [{ id: 'java', extensions: ['.java'], monaco: 'java' }],
    contributes: { editorGutter: { languages: ['java'], click: 'gutter.click' } },
    provides: { runtimes: { java: { command: '${downloads}/jre/bin/java.exe' } } },
    downloads: [
      { id: 'jre', url: 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8/OpenJDK25U-jre_x64_windows_hotspot_25.0.5_8.zip', sha256: 'a'.repeat(64), size: 58720256, type: 'zip', to: 'jre', strip: true },
      { id: 'jdtls', url: 'https://download.eclipse.org/jdtls/snapshots/jdt-language-server-1.64.0-202611042043.tar.gz', sha256: 'b'.repeat(64), size: 50331648, type: 'tar.gz', to: 'jdtls' }
    ],
    apiVersion: 1,
    main: 'adapter.mjs',
    activities: ['Avvia Eclipse JDT Language Server con il JRE del plugin, uno per progetto Maven o Gradle', 'Importa i progetti Maven e Gradle (scarica le dipendenze)']
  }
  const maven: PluginManifest = {
    id: 'cct.maven', name: 'Maven (e XML)', version: '1.0.0', publisher: 'Magnolia', license: 'EPL-2.0',
    description: 'LemMinX con l\'estensione Maven: completamento e controlli in pom.xml e negli altri file XML.',
    requires: ['cct.java'],
    languages: [{ id: 'xml', extensions: ['.xml', '.xsd'], monaco: 'xml' }],
    apiVersion: 1,
    main: 'adapter.mjs',
    activities: ['Avvia LemMinX con il runtime Java del plugin Java', 'Legge i pom.xml e il repository Maven locale per completare dipendenze e versioni']
  }
  let installed: InstalledPlugin[] = [{ manifest: java, enabled: true, installedAt: new Date().toISOString(), packageHash: 'c'.repeat(64), state: 'ok', sizeBytes: 251658240 }]
  const listeners = new Set<(l: InstalledPlugin[], langs: PluginLanguageInfo[]) => void>()
  const langs = (): PluginLanguageInfo[] =>
    installed.filter((p) => p.enabled).flatMap((p) => (p.manifest.languages ?? []).map((l) => ({ id: l.id, monaco: l.monaco, extensions: l.extensions ?? [], filenames: l.filenames ?? [], pluginId: p.manifest.id, hasServer: true })))
  const emit = () => listeners.forEach((cb) => cb(installed, langs()))
  return {
    async list() {
      return installed
    },
    async languages() {
      return langs()
    },
    async pick() {
      return { ok: true, preview: { token: 'demo', file: 'cct.maven-1.0.0.ccplugin', manifest: maven, packageHash: 'd'.repeat(64), packageSize: 14680064, entry: { main: 'adapter.mjs', apiVersion: 1 }, missingRequirements: [], warnings: [] } }
    },
    async previewFile() {
      return { ok: false, error: 'demo' }
    },
    async cancel() {},
    async install() {
      installed = [...installed, { manifest: maven, enabled: true, installedAt: new Date().toISOString(), packageHash: 'd'.repeat(64), state: 'ok', sizeBytes: 15728640 }]
      emit()
      return { ok: true }
    },
    async setEnabled(id, enabled) {
      installed = installed.map((p) => (p.manifest.id === id ? { ...p, enabled } : p))
      emit()
    },
    async uninstall(id) {
      if (id === 'cct.java' && installed.some((p) => p.manifest.requires?.includes('cct.java'))) return { ok: false, error: 'Prima disinstalla: Maven (e XML) (lo richiede).' }
      installed = installed.filter((p) => p.manifest.id !== id)
      emit()
      return { ok: true }
    },
    onChanged: (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    onProgress: () => () => {},
    async call() {
      throw new Error('Gli adapter dei plugin girano solo nell’app')
    },
    onEvent: () => () => {},
    // Nel browser i segni si provano da console: window.__demoMarkers('<percorso>', [{ line: 3, kind: 'breakpoint' }])
    onMarkers: (cb) => {
      ;(window as unknown as Record<string, unknown>).__demoMarkers = (path: string, markers: GutterMarker[]) => cb({ pluginId: 'cct.java', path, markers })
      return () => {}
    }
  }
}
/**
 * Permessi finti per il browser (regole del mockup). `window.__demoRemember()` simula un
 * «Sì, e ricorda» dal terminale, per provare l'aggiornamento automatico (P3, P6).
 */
function createDemoPermissions(): AppApi['permissions'] {
  const day = (d: number) => new Date(Date.now() - d * 86400000).toISOString()
  const files: Record<PermissionScope, { data: ScopeData; meta: Record<string, { origin: RuleOrigin; addedAt?: string }>; other: Record<string, unknown> }> = {
    local: {
      data: { allow: ['Read(..\\shared-lib\\**)', 'Bash(npm run test:*)', 'WebFetch(domain:docs.github.com)'], ask: ['Edit(D:\\docs\\specifiche\\**)'], deny: [], additionalDirectories: ['..\\shared-lib', 'D:\\docs\\specifiche'] },
      meta: {
        'allow:Read(..\\shared-lib\\**)': { origin: 'terminal', addedAt: new Date().toISOString() },
        'allow:Bash(npm run test:*)': { origin: 'terminal', addedAt: day(4) },
        'allow:WebFetch(domain:docs.github.com)': { origin: 'terminal', addedAt: day(5) },
        'ask:Edit(D:\\docs\\specifiche\\**)': { origin: 'manual', addedAt: day(6) }
      },
      other: {}
    },
    project: { data: { allow: ['Bash(npm run lint)'], ask: [], deny: ['Bash(git push:*)', 'Read(.env*)'], additionalDirectories: [] }, meta: {}, other: { env: { NODE_ENV: 'development' } } },
    user: { data: { allow: ['Bash(git status)'], ask: [], deny: ['Bash(rm -rf:*)'], additionalDirectories: [] }, meta: {}, other: { theme: 'dark' } }
  }
  const paths: Record<PermissionScope, string> = {
    local: 'C:\\progetti\\api-server\\.claude\\settings.local.json',
    project: 'C:\\progetti\\api-server\\.claude\\settings.json',
    user: 'C:\\Users\\demo\\.claude\\settings.json'
  }
  const listeners = new Set<(c: ExternalChange) => void>()
  let lastCwd = 'C:\\progetti\\api-server'
  const raw = (scope: PermissionScope) => {
    const f = files[scope]
    const permissions: Record<string, string[]> = {}
    for (const k of ['allow', 'ask', 'deny', 'additionalDirectories'] as const) if (f.data[k].length) permissions[k] = f.data[k]
    return JSON.stringify({ ...f.other, ...(Object.keys(permissions).length ? { permissions } : {}) }, null, 2) + '\n'
  }
  const state = (cwd: string): PermissionsState => ({
    cwd,
    scopes: (['local', 'project', 'user'] as PermissionScope[]).map((scope) => {
      const f = files[scope]
      const rules: PermissionRule[] = (['allow', 'ask', 'deny'] as Decision[]).flatMap((decision) =>
        f.data[decision].map((rule) => ({ rule, decision, origin: f.meta[`${decision}:${rule}`]?.origin ?? 'existing', addedAt: f.meta[`${decision}:${rule}`]?.addedAt }))
      )
      return { scope, path: paths[scope], exists: true, rules, additionalDirectories: f.data.additionalDirectories, raw: raw(scope) }
    })
  })
  ;(window as unknown as { __demoRemember: () => void }).__demoRemember = () => {
    const rule = 'Bash(mvn test:*)'
    files.local.data.allow = [...files.local.data.allow, rule]
    files.local.meta[`allow:${rule}`] = { origin: 'terminal', addedAt: new Date().toISOString() }
    const change: ExternalChange = { cwd: lastCwd, scope: 'local', path: paths.local, added: [{ rule, decision: 'allow' }], removed: [], directoriesAdded: [], directoriesRemoved: [], fromTerminal: true }
    listeners.forEach((cb) => cb(change))
  }
  return {
    async read(cwd) {
      lastCwd = cwd
      return state(cwd)
    },
    async save(_cwd, scope, data) {
      const f = files[scope]
      const now = new Date().toISOString()
      for (const d of ['allow', 'ask', 'deny'] as Decision[]) for (const r of data[d]) if (!f.data[d].includes(r)) f.meta[`${d}:${r}`] = { origin: 'manual', addedAt: now }
      f.data = data
      return { ok: true }
    },
    onExternalChange: (cb) => (listeners.add(cb), () => listeners.delete(cb))
  }
}

/** Modifiche finte per il browser (dal mockup): servono a provare il pannello Modifiche senza Electron. */
function createDemoChanges(): AppApi['changes'] {
  const before = `package it.acme.orders;

public class OrderService {
  private final OrderRepository repo;

  public void cancel(Long id) {
    Order o = repo.findById(id)
        .orElseThrow();
    o.setStatus("CANCELLED");
    repo.save(o);
  }
}
`
  const after = `package it.acme.orders;

public class OrderService {
  private final OrderRepository repo;
  private final EventPublisher events;

  public void cancel(Long id) {
    Order o = repo.findById(id)
        .orElseThrow();
    if (o.isShipped()) throw new
      IllegalStateException("spedito");
    o.setStatus(Status.CANCELLED);
    repo.save(o); events.publish(o);
  }
}
`
  const now = new Date().toISOString()
  const mk = (id: string, file: string, created: boolean, added: number, removed: number): FileChange => ({
    id, sessionId: 'demo', sessionTitle: 'api-server', cwd: 'C:\\progetti\\api-server',
    filePath: `C:\\progetti\\api-server\\src\\main\\java\\it\\acme\\orders\\${file}`, tools: ['Edit'], created,
    status: 'pending', added, removed, requests: 0, createdAt: now, updatedAt: now
  })
  let list: FileChange[] = [mk('c1', 'OrderService.java', false, 5, 2), mk('c2', 'OrderRepository.java', false, 4, 1), mk('c3', 'OrderMapper.java', true, 38, 0)]
  const afters = new Map<string, string>()
  const requests = new Map<string, RevisionRequest[]>()
  const bases = new Map<string, string>()
  const listeners = new Set<(c: FileChange[]) => void>()
  const emit = () => listeners.forEach((cb) => cb(list))
  const decide = (id: string, status: FileChange['status']) => {
    list = list.map((c) => (c.id === id && isOpen(c) ? { ...c, status, decidedAt: new Date().toISOString() } : c))
    emit()
  }
  return {
    async list() {
      return list
    },
    async contents(id) {
      const change = list.find((c) => c.id === id)
      if (!change) return null
      return {
        change,
        before: change.created ? '' : before,
        after: afters.get(id) ?? after,
        lastRequestBase: bases.get(id) ?? null,
        requests: requests.get(id) ?? [],
        modifiedSince: false,
        binary: false
      }
    },
    async reviewFile() {
      return { ok: true }
    },
    async requestRevision(id, notes) {
      const current = afters.get(id) ?? after
      bases.set(id, current)
      requests.set(id, [...(requests.get(id) ?? []), { id: crypto.randomUUID(), changeId: id, notes, createdAt: new Date().toISOString() }])
      list = list.map((c) => (c.id === id ? { ...c, status: 'revision', requests: c.requests + 1 } : c))
      emit()
      // Simula Claude che corregge il file seguendo le indicazioni.
      setTimeout(() => {
        afters.set(id, current.replace('    repo.save(o); events.publish(o);', '    repo.save(o);\n    events.publish(new OrderCancelled(o.getId()));'))
        list = list.map((c) => (c.id === id ? { ...c, status: 'pending', added: c.added + 1, updatedAt: new Date().toISOString() } : c))
        emit()
      }, 2000)
      return { ok: true }
    },
    async approve(id) {
      decide(id, 'approved')
    },
    async approveAll() {
      const n = list.filter((c) => c.status === 'pending').length
      list = list.map((c) => (c.status === 'pending' ? { ...c, status: 'approved' } : c))
      emit()
      return n
    },
    async approveMany(ids) {
      const wanted = new Set(ids)
      const n = list.filter((c) => c.status === 'pending' && wanted.has(c.id)).length
      list = list.map((c) => (c.status === 'pending' && wanted.has(c.id) ? { ...c, status: 'approved' } : c))
      emit()
      return n
    },
    async rejectMany(ids) {
      const wanted = new Set(ids)
      const n = list.filter((c) => c.status === 'pending' && wanted.has(c.id)).length
      list = list.map((c) => (c.status === 'pending' && wanted.has(c.id) ? { ...c, status: 'rejected' } : c))
      emit()
      return { rejected: n, needsForce: [], failed: [] }
    },
    async reject(id) {
      decide(id, 'rejected')
      return { ok: true }
    },
    onChanged: (cb) => (listeners.add(cb), () => listeners.delete(cb))
  }
}

/**
 * Sessioni finte per il browser: ogni sessione rimanda indietro ciò che si scrive.
 * Servono solo a provare l'interfaccia dei terminali senza Electron.
 */
function createDemoSessions(): Pick<AppApi, 'sessions' | 'env'> {
  const sessions = new Map<string, { info: SessionInfo; screen: string; seq: number; views: Set<string> }>()
  const changed = new Set<(s: SessionInfo[]) => void>()
  const data = new Set<(id: string, seq: number, d: string) => void>()
  const resized = new Set<(id: string, c: number, r: number) => void>()
  const exited = new Set<(id: string, code: number) => void>()
  const attention = new Set<(a: SessionAttention) => void>()
  const list = () => [...sessions.values()].map((s) => ({ ...s.info, views: s.views.size }))
  const notify = () => setTimeout(() => changed.forEach((cb) => cb(list())), 0)
  const prompt = (s: SessionInfo) => (s.kind === 'claude' ? '\r\n\x1b[38;2;232;135;95m>\x1b[0m ' : `\r\n\x1b[32m${s.cwd}\x1b[0m $ `)
  const emit = (id: string, chunk: string) => {
    const s = sessions.get(id)
    if (!s) return
    s.seq++
    s.screen += chunk
    data.forEach((cb) => cb(id, s.seq, chunk))
  }
  let idleTimer: number | undefined

  return {
    sessions: {
      async list() {
        return list()
      },
      async create(req) {
        const id = crypto.randomUUID()
        const cwd = req.kind === 'claude' ? req.claude.cwd : req.cwd
        const info: SessionInfo = {
          id,
          kind: req.kind,
          title: req.kind === 'claude' ? req.claude.title || req.claude.name || cwd.split(/[\\/]/).pop() || cwd : req.kind === 'task' ? req.title : req.shell === 'git-bash' ? 'Git Bash' : 'PowerShell',
          cwd,
          status: 'idle',
          startedAt: new Date().toISOString(),
          command: req.kind === 'claude' ? `claude --model ${req.claude.model}` : req.kind === 'task' ? req.file : req.shell,
          shell: req.kind === 'shell' ? req.shell : undefined,
          claudeSessionId: req.kind === 'claude' ? (req.claude.resumeId ?? crypto.randomUUID()) : undefined,
          model: req.kind === 'claude' ? req.claude.model : undefined,
          effort: req.kind === 'claude' ? req.claude.effort : undefined,
          addDirs: req.kind === 'claude' ? req.claude.addDirs : undefined,
          gitBranch: 'main',
          views: 0,
          cols: 100,
          rows: 30
        }
        const banner =
          req.kind === 'claude'
            ? `\x1b[1mClaude Code\x1b[0m \x1b[2m(demo nel browser: rimanda indietro ciò che scrivi)\x1b[0m\r\n${info.command}`
            : `\x1b[2mShell di prova nel browser\x1b[0m`
        sessions.set(id, { info, screen: banner + prompt(info), seq: 0, views: new Set() })
        notify()
        return { ...info }
      },
      async attach(id, viewId) {
        const s = sessions.get(id)
        if (!s) return null
        s.views.add(viewId)
        notify()
        return { info: { ...s.info, views: s.views.size }, data: s.screen, seq: s.seq }
      },
      detach(id, viewId) {
        sessions.get(id)?.views.delete(viewId)
        notify()
      },
      input(id, _viewId, d) {
        const s = sessions.get(id)
        if (!s || s.info.status === 'exited') return
        if (d === '\r') {
          s.info.status = 'working'
          notify()
          emit(id, '\r\n\x1b[2m(eco)\x1b[0m' + prompt(s.info))
          window.clearTimeout(idleTimer)
          idleTimer = window.setTimeout(() => {
            s.info.status = 'idle'
            if (s.info.kind === 'claude') {
              // Simula la status line e l'hook Stop di Claude Code (fase 3).
              s.info.hooks = true
              s.info.contextPercent = Math.min(99, (s.info.contextPercent ?? 3) + 9)
              s.info.modelLabel ??= 'Sonnet'
              attention.forEach((cb) => cb({ sessionId: id, kind: 'finished', title: s.info.title, message: 'Ho risposto al tuo messaggio (demo).' }))
            }
            notify()
          }, 1200)
        } else if (d === '\x7f') emit(id, '\b \b')
        else emit(id, d)
      },
      resize(id, _viewId, cols, rows, claim) {
        const s = sessions.get(id)
        if (!s || !claim) return
        s.info.cols = cols
        s.info.rows = rows
        resized.forEach((cb) => cb(id, cols, rows))
      },
      async setModel(id, model, effort) {
        const s = sessions.get(id)
        if (!s) return
        s.info.model = model
        s.info.effort = effort
        emit(id, `/model ${model}\r\n/effort ${effort}` + prompt(s.info))
        notify()
      },
      key() {},
      async sendPrompt() {
        return { ok: true }
      },
      async markIdle(id) {
        const s = sessions.get(id)
        if (s && (s.info.status === 'working' || s.info.status === 'waiting')) s.info.status = 'idle'
      },
      async kill(id) {
        const s = sessions.get(id)
        if (!s) return
        s.info.status = 'exited'
        s.info.exitCode = 0
        exited.forEach((cb) => cb(id, 0))
        if (s.views.size === 0) sessions.delete(id)
        notify()
      },
      onChanged: (cb) => (changed.add(cb), () => changed.delete(cb)),
      onData: (cb) => (data.add(cb), () => data.delete(cb)),
      onResize: (cb) => (resized.add(cb), () => resized.delete(cb)),
      onExit: (cb) => (exited.add(cb), () => exited.delete(cb)),
      onAttention: (cb) => (attention.add(cb), () => attention.delete(cb)),
      onReveal: () => () => {}
    },
    env: {
      async claudeCli() {
        return { path: '(demo)', version: 'demo', source: 'path' }
      },
      async shells() {
        return [
          { id: 'git-bash', label: 'Git Bash' },
          { id: 'powershell', label: 'Windows PowerShell' }
        ]
      },
      async resumable(cwd) {
        const now = Date.now()
        return [
          { id: 'demo-1', title: 'Refactor middleware auth', cwd, updatedAt: new Date(now - 86400000).toISOString(), gitBranch: 'main' },
          { id: 'demo-2', title: 'Migrazione schema utenti', cwd, updatedAt: new Date(now - 3 * 86400000).toISOString() }
        ]
      },
      async projectPrefs() {
        return null
      },
      async recentProjects() {
        return []
      },
      async saveProjectPrefs() {},
      async pickFolder() {
        return window.prompt('Cartella (demo nel browser)', 'C:\\progetti\\api-server')
      },
      async pickFile() {
        return window.prompt('File (demo nel browser)', 'C:\\progetti\\api-server\\pom.xml')
      },
      async homeDir() {
        return 'C:\\Users\\demo'
      },
      async pathStatus(path) {
        if (!/^[a-zA-Z]:\\|^\\\\/.test(path)) return 'invalid'
        return /nuovo|new/i.test(path) ? 'missing' : 'dir'
      },
      async createFolder() {
        return { ok: true }
      }
    }
  }
}

export const api: AppApi = window.api ?? createLocalStorageApi()
