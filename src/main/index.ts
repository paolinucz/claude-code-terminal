import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, powerMonitor, protocol, shell, type WebContents } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { extname, join, normalize, sep } from 'node:path'
import { PLUGIN_UI_HOST } from '@shared/plugins'
import { pathToFileURL } from 'node:url'
import type { SerializedLayout, Space } from '@shared/types'
import type { ClaudeEffort, ClaudeModel, CreateSessionRequest, ProjectPrefs } from '@shared/sessions'
import { isOpen, isReviewLocked, REVIEW_LOCK_MESSAGE, REVIEW_RUNNING_MESSAGE, type ReviewNote, type RevisionResult } from '@shared/changes'
import { AppDb } from './db'
import { SessionManager } from './sessions/SessionManager'
import { HookServer } from './sessions/HookServer'
import type { SearchOptions } from '@shared/search'
import { contextMenuTemplate } from './contextMenuTemplate'
import { ChangeTracker, fileReviewMessage } from './changes/ChangeTracker'
import { PermissionsService } from './permissions/PermissionsService'
import { FileService } from './files/FileService'
import { PluginHost } from './plugins/PluginHost'
import { BrowserService } from './browser/BrowserService'
import { PluginManager } from './plugins/PluginManager'
import type { ApiFileEdit, ApiPosition } from '@shared/pluginApi'
import { applyTextEdits } from '@shared/textEdits'
import { isInsidePath, perform as performMove, validate as validateMove } from './files/FileOps'
import type { MoveItem, MovePrepareResult, MoveResult } from '@shared/types'
import type { PermissionScope, ScopeData } from '@shared/permissions'
import { detectShells, findClaudeCli } from './sessions/environment'
import { listResumable } from './sessions/history'
import { Updater } from './updater'
import { ProjectService } from './projects/ProjectService'
import { EXPLAIN_CSP, ExplainService } from './changes/ExplainService'
import { TranscriptService } from './sessions/TranscriptService'
import type { ChatItem, TranscriptUpdate } from '@shared/transcript'
import { EXPLAIN_HOST, type ExplainResult, type SnippetRequest } from '@shared/explain'
import type { ProjectFile } from '@shared/project'

const isDev = !app.isPackaged
let db: AppDb | null = null

// Fase 3: gli hook HTTP e la status line di Claude Code arrivano a questo server locale.
const hookServer = new HookServer({
  onHook: (id, event) => {
    // Fase 4: prima registra la modifica (PreToolUse deve leggere il file prima che Claude scriva).
    const context = changes?.onHook(id, sessions.ref(id), event) ?? null
    sessions.handleHook(id, event)
    if (context && event.hook_event_name === 'UserPromptSubmit') {
      return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }
    }
  },
  onStatusLine: (id, payload) => sessions.handleStatusLine(id, payload)
})
/** Vista grafica della conversazione. */
const transcripts = new TranscriptService((u) => sendToMain('transcript:update', u))
/** Fase 4: modifiche di Claude ai file (creato quando il database è pronto). */
let changes: ChangeTracker | null = null
/** Fase 5: file dei permessi di Claude Code. */
let permissions: PermissionsService | null = null

// ---- Fase 6: file, editor, language server ----
// Gli eventi vanno alla finestra principale e alle finestre degli spazi (stesse sessioni, stessi dati): non ai pannelli staccati.
const sendToMain = (channel: string, ...args: unknown[]) => {
  for (const win of appWindows()) if (!win.isDestroyed()) win.webContents.send(channel, ...args)
}
const files = new FileService((root, paths) => sendToMain('files:changed', root, paths))
/** Fase 6a: plugin di linguaggio e i loro language server (creati quando il database è pronto). */
let plugins: PluginManager | null = null
let lsp: PluginHost | null = null
/** Browser integrato per i plugin (permesso `browser`): viste web nei pannelli, pilotate dall'adapter via CDP. */
const browser = new BrowserService(
  () => mainWindow(),
  (state) => sendToMain('browser:state', state),
  (pluginId, e) => lsp?.sendBrowserEvent(pluginId, e)
)

/** Ferma un plugin e quelli che lo richiedono (es. Java → Maven, Gradle: usano il suo runtime). */
async function stopWithDependents(id: string): Promise<void> {
  const ids = [id, ...(plugins?.list() ?? []).filter((p) => p.manifest.requires?.includes(id)).map((p) => p.manifest.id)]
  await Promise.all(ids.map((x) => lsp?.stopPlugin(x)))
}
/** Fase 8: aggiornamenti automatici da GitHub Releases. */
const updater = new Updater((s) => sendToMain('updates:status', s))

const sessions = new SessionManager(
  (id) => hookServer.claudeSettings(id),
  join(tmpdir(), 'claude-code-terminal', `settings-${process.pid}`),
  // Claude Code «puro»: gli Artifact di claude.ai (pagine pubblicate online) sono tolti, così i file si scrivono
  // nella cartella della sessione. Chi li vuole li riattiva dalla palette (impostazione `claude.allowArtifacts`).
  () => (db?.getSetting('claude.allowArtifacts') === true ? [] : ['Artifact', 'ArtifactComments', 'ArtifactData'])
)

/** S7: notifica quando una sessione finisce o chiede un permesso, anche se il suo spazio non è aperto. */
sessions.onAttention((a) => {
  const win = mainWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send('session:attention', a)
  // Notifica di Windows solo se l'app non è in primo piano; dentro l'app ci pensa l'interfaccia.
  if (!BrowserWindow.getFocusedWindow() && Notification.isSupported()) {
    const titles = { finished: 'ha finito', permission: 'chiede un permesso', input: 'aspetta una risposta', error: 'si è fermata' }
    const n = new Notification({ title: `«${a.title}» ${titles[a.kind]}`, body: a.message, silent: a.kind === 'finished' })
    n.on('click', () => {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send('session:reveal', a.sessionId)
    })
    n.show()
  }
})

/** Finestra che mostra un solo spazio (`?space=<id>`): vedi `window:openSpace`. */
const isSpaceWindowUrl = (url: string) => /[?&]space=/.test(url)
function appWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => !w.webContents.getURL().includes('popout.html'))
}
function mainWindow(): BrowserWindow | undefined {
  return appWindows().find((w) => !isSpaceWindowUrl(w.webContents.getURL()))
}
/** Spazi aperti in una finestra propria: un solo proprietario per spazio, così due Dockview non scrivono lo stesso layout. */
const spaceWindows = new Map<string, BrowserWindow>()
/** Finestre che ricevono gli aggiornamenti sull'elenco delle sessioni. */
const sessionWatchers = new Set<WebContents>()

/**
 * Fuori dallo sviluppo l'interfaccia è servita da `app://renderer/…` e non da `file://`:
 * Dockview rifiuta le finestre staccate (L4) su `file://`, e un'origine propria è comunque più sicura.
 */
const APP_SCHEME = 'app'
const APP_ORIGIN = `${APP_SCHEME}://renderer`
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

/** Tipi di file che la pagina di un plugin può caricare. */
const PLUGIN_UI_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8'
}
/** Come per le spiegazioni: niente rete né frame; script e stili del pacchetto stesso o incorporati. */
const PLUGIN_UI_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; base-uri 'none'; form-action 'none'"

/** Fase 14: spiegazioni smart delle modifiche (creato quando il database è pronto). */
let explain: ExplainService | null = null

function serveRenderer(): void {
  const root = normalize(join(__dirname, '../renderer'))
  protocol.handle(APP_SCHEME, (request) => {
    const { host, pathname } = new URL(request.url)
    // Pagine HTML generate dal modello (O4): senza rete, né frame, né accesso all'app. Le legge solo l'iframe isolato.
    if (host === EXPLAIN_HOST) {
      const html = explain?.page(decodeURIComponent(pathname.replace(/^\//, '')))
      if (html === undefined) return new Response('Non trovato', { status: 404 })
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': EXPLAIN_CSP,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store'
        }
      })
    }
    // Pagine dei plugin (contributi all'interfaccia): solo file statici dentro la cartella di un plugin attivo, in un
    // iframe isolato (senza allow-same-origin) e con una politica che vieta rete e frame.
    if (host === PLUGIN_UI_HOST) {
      const [, pluginId = '', ...rest] = decodeURIComponent(pathname).split('/')
      const dir = normalize(plugins?.pluginDir(pluginId) ?? '')
      const file = normalize(join(dir, ...rest))
      const type = PLUGIN_UI_TYPES[extname(file).toLowerCase()]
      if (!plugins?.isActive(pluginId) || !type || !file.startsWith(dir + sep) || !existsSync(file)) return new Response('Non trovato', { status: 404 })
      return new Response(readFileSync(file), {
        headers: { 'Content-Type': type, 'Content-Security-Policy': PLUGIN_UI_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }
      })
    }
    const file = normalize(join(root, decodeURIComponent(pathname)))
    if (host !== 'renderer' || !(file === root || file.startsWith(root + sep))) {
      return new Response('Non trovato', { status: 404 })
    }
    return net.fetch(pathToFileURL(file).toString())
  })
}

/** Menu contestuale di base (campi di testo e testo selezionato) in ogni finestra, comprese quelle staccate. */
app.on('web-contents-created', (_e, contents) => {
  contents.on('context-menu', (_event, params) => {
    const template = contextMenuTemplate(params)
    if (template.length) Menu.buildFromTemplate(template).popup()
  })
})

/** Opzioni comuni a finestra principale e finestre staccate, per lo stesso aspetto scuro. */
/** Icona dell'app per le finestre (nell'app installata la dà già l'exe): `build/icon.png`, se c'è. */
const WINDOW_ICON = (() => {
  const file = join(__dirname, '../../build/icon.png')
  return existsSync(file) ? file : undefined
})()

const darkWindow = {
  backgroundColor: '#000000',
  ...(WINDOW_ICON ? { icon: WINDOW_ICON } : {}),
  autoHideMenuBar: true,
  titleBarStyle: 'hidden' as const,
  // Come la barra in alto è una scheda staccata dal bordo, i controlli della finestra stanno sullo sfondo scuro, centrati sulla scheda.
  titleBarOverlay: { color: '#0A0A0C', symbolColor: '#D4D4D8', height: 48 }
}

function createMainWindow(spaceId?: string): BrowserWindow {
  const win = new BrowserWindow({
    ...darkWindow,
    width: spaceId ? 1280 : 1600,
    height: spaceId ? 820 : 1000,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Magnolia',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => {
    if (!spaceId) win.maximize()
    win.show()
  })

  // Finestre staccate dei pannelli (L4): Dockview apre una finestra vuota dello stesso
  // origin e ci sposta dentro il gruppo. Tutto il resto (link esterni) va al browser di sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isPopoutUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...darkWindow,
          // Le finestre staccate hanno la loro barra piena, sullo sfondo del pannello.
          titleBarOverlay: { ...darkWindow.titleBarOverlay, color: '#18181B', height: 36 },
          title: 'Magnolia – pannello staccato',
          minWidth: 320,
          minHeight: 200
        }
      }
    }
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Nessuna navigazione dentro la finestra principale.
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  // F12 apre gli strumenti di sviluppo, anche senza menu.
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    // F11: schermo intero, anche con il focus dentro un terminale (la shell non usa questo tasto).
    if (input.type === 'keyDown' && input.key === 'F11' && !input.control && !input.alt && !input.shift) {
      _event.preventDefault()
      win.setFullScreen(!win.isFullScreen())
    }
  })
  // L'interfaccia lo sa: in schermo intero i controlli nativi della finestra spariscono e la barra non deve lasciare loro spazio.
  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen', true))
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen', false))

  const query = spaceId ? `?space=${encodeURIComponent(spaceId)}` : ''
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + query)
  } else {
    void win.loadURL(`${APP_ORIGIN}/index.html${query}`)
  }
  return win
}

/**
 * Percorso assoluto di una cartella da creare. Windows: C:\… o \\server\… senza caratteri non ammessi nei nomi.
 * Linux e macOS: /… senza NUL né «..».
 */
function isValidFolderPath(path: string): boolean {
  if (typeof path !== 'string') return false
  if (path.startsWith('/')) return path.length <= 4096 && !path.includes('\0') && path.split('/').every((part) => part !== '..')
  if (path.length > 240) return false
  const m = /^([a-zA-Z]:\\|\\\\[^\\]+\\[^\\]+\\?)(.*)$/.exec(path.replace(/\//g, '\\'))
  if (!m) return false
  return m[2].split('\\').every((part) => !/[<>:"|?*\x00-\x1f]/.test(part) && !/[ .]$/.test(part) && part !== '..')
}

function isPopoutUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.pathname.endsWith('/popout.html')
  } catch {
    return false
  }
}

function registerIpc(store: AppDb): void {
  ipcMain.handle('workspace:load', () => store.loadWorkspace())
  ipcMain.handle(
    'workspace:saveSpaces',
    (_e, spaces: Pick<Space, 'id' | 'name' | 'contextId' | 'icon' | 'color'>[], activeSpaceId: string | null) =>
      store.saveSpaces(spaces, activeSpaceId)
  )
  ipcMain.handle('workspace:saveSpaceLayout', (_e, spaceId: string, layout: SerializedLayout | null) =>
    store.saveSpaceLayout(spaceId, layout)
  )
  ipcMain.handle('layouts:list', () => store.listLayouts())
  ipcMain.handle('layouts:save', (_e, name: string, layout: SerializedLayout) => store.saveLayout(name, layout))
  ipcMain.handle('layouts:remove', (_e, id: string) => store.removeLayout(id))

  // ---- Modifiche di Claude (F4–F7) ----
  ipcMain.handle('changes:list', () => changes?.list() ?? [])
  ipcMain.handle('changes:contents', (_e, id: string) => changes?.contents(id) ?? null)
  // Revisione solo a Claude fermo: finché una sessione esegue, le sue modifiche non si approvano, rifiutano o rimandano.
  const runningFor = (opts: { ids?: string[]; sessionId?: string }): boolean =>
    (changes?.list() ?? []).some(
      (c) => isOpen(c) && (opts.ids ? opts.ids.includes(c.id) : opts.sessionId ? c.sessionId === opts.sessionId : true) && sessions.isRunning(c.sessionId)
    )
  ipcMain.handle('changes:approve', (_e, id: string) => (runningFor({ ids: [id] }) ? undefined : changes?.approve(id)))
  ipcMain.handle('changes:approveAll', (_e, sessionId?: string) => (runningFor({ sessionId }) ? 0 : (changes?.approveAll(sessionId) ?? 0)))
  ipcMain.handle('changes:approveMany', (_e, ids: string[]) => (runningFor({ ids }) ? 0 : (changes?.approveMany(ids) ?? 0)))
  ipcMain.handle('changes:rejectMany', (_e, ids: string[], force?: boolean) =>
    runningFor({ ids })
      ? { rejected: 0, needsForce: [], failed: ids.map((id) => ({ id, error: REVIEW_RUNNING_MESSAGE })) }
      : (changes?.rejectMany(ids, Boolean(force)) ?? { rejected: 0, needsForce: [], failed: [] })
  )
  ipcMain.handle('changes:reject', (_e, id: string, force?: boolean) =>
    runningFor({ ids: [id] }) ? { ok: false, error: REVIEW_RUNNING_MESSAGE } : (changes?.reject(id, force) ?? { ok: false })
  )
  // F8: richiedi modifiche: le indicazioni vanno a Claude come messaggio nella sua sessione.
  ipcMain.handle('changes:requestRevision', (_e, id: string, notes: ReviewNote[]): RevisionResult => {
    const contents = changes?.contents(id)
    if (!changes || !contents) return { ok: false, error: 'Modifica non trovata.' }
    const can = sessions.canReceivePrompt(contents.change.sessionId)
    if (!can.ok) return can
    const res = changes.requestRevision(id, notes)
    if (!res.ok) return res
    sessions.sendPrompt(res.sessionId, res.message)
    return { ok: true }
  })

  // Modalità revisione dell'editor: indicazioni su un file qualsiasi, mandate alla sessione scelta come messaggio.
  ipcMain.handle('changes:reviewFile', (_e, sessionId: string, filePath: string, notes: ReviewNote[]): RevisionResult => {
    const clean = Array.isArray(notes) ? notes.filter((n) => n && typeof n.text === 'string' && n.text.trim()) : []
    if (typeof filePath !== 'string' || !filePath || !clean.length) return { ok: false, error: 'Scrivi almeno una indicazione.' }
    const can = sessions.canReceivePrompt(sessionId)
    if (!can.ok) return can
    if (sessions.isLocked(sessionId)) return { ok: false, error: REVIEW_LOCK_MESSAGE }
    sessions.sendPrompt(sessionId, fileReviewMessage(filePath, clean.map((n) => ({ ...n, text: n.text.trim() }))))
    return { ok: true }
  })

  // ---- Output smart (O1–O8): solo a richiesta dell'utente ----
  ipcMain.handle('explain:peek', (_e, changeId: string): ExplainResult | null => explain?.peek(changes?.contents(changeId) ?? null) ?? null)
  ipcMain.handle(
    'explain:run',
    (_e, requestId: string, changeId: string, force?: boolean): Promise<ExplainResult> | ExplainResult =>
      explain ? explain.run(requestId, changes?.contents(changeId) ?? null, Boolean(force)) : { ok: false, error: 'Servizio non pronto' }
  )
  ipcMain.handle(
    'explain:snippet',
    (_e, requestId: string, req: SnippetRequest, force?: boolean): Promise<ExplainResult> | ExplainResult =>
      explain && req && typeof req.text === 'string' && typeof req.filePath === 'string'
        ? explain.runSnippet(requestId, req, Boolean(force))
        : { ok: false, error: 'Servizio non pronto' }
  )
  // ---- Vista grafica della conversazione («bridge») ----
  ipcMain.handle('transcript:open', (_e, sessionId: string): ChatItem[] => {
    return transcripts.open(sessionId, () => {
      const info = sessions.list().find((x) => x.id === sessionId)
      return info && info.kind === 'claude' ? TranscriptService.pathOf(info.cwd, info.claudeSessionId) : null
    })
  })
  ipcMain.on('transcript:close', (_e, sessionId: string) => transcripts.close(sessionId))
  ipcMain.handle('explain:cancel', (_e, requestId: string) => explain?.cancel(requestId))

  // ---- File (F1, F2) ----
  ipcMain.handle('files:list', (_e, dir: string) => files.list(dir))
  ipcMain.handle('files:read', (_e, path: string) => files.read(path))
  ipcMain.handle('files:write', (_e, path: string, text: string, expectedMtime?: number, force?: boolean) =>
    files.write(path, text, expectedMtime, force)
  )
  ipcMain.handle('files:gitStatus', (_e, dir: string) => files.gitStatus(dir))
  ipcMain.handle('files:index', (_e, root: string) => files.index(root))
  ipcMain.handle('files:search', (_e, root: string, query: string, opts: SearchOptions) =>
    typeof root === 'string' && typeof query === 'string' && opts
      ? files.search(root, query, opts)
      : { ok: false, error: 'Richiesta non valida', root: '', files: [], total: 0, truncated: false, searched: 0 }
  )
  ipcMain.handle('power:onBattery', () => powerMonitor.isOnBatteryPower())
  // Apri uno spazio in una finestra propria. Le sessioni sono del processo principale: cambia solo la vista, nessun processo si ferma.
  const SPACE_ID_RE = /^[\w:.-]{1,80}$/
  const notifySpaceWindows = () => sendToMain('window:spaces', [...spaceWindows.keys()])
  ipcMain.handle('window:openSpace', (_e, spaceId: string) => {
    if (typeof spaceId !== 'string' || !SPACE_ID_RE.test(spaceId)) return false
    const open = spaceWindows.get(spaceId)
    if (open && !open.isDestroyed()) {
      if (open.isMinimized()) open.restore()
      open.focus()
      return true
    }
    const win = createMainWindow(spaceId)
    spaceWindows.set(spaceId, win)
    win.on('closed', () => {
      spaceWindows.delete(spaceId)
      notifySpaceWindows()
    })
    notifySpaceWindows()
    return true
  })
  ipcMain.handle('window:toggleFullScreen', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return false
    win.setFullScreen(!win.isFullScreen())
    return win.isFullScreen()
  })
  ipcMain.handle('window:isFullScreen', (e) => BrowserWindow.fromWebContents(e.sender)?.isFullScreen() ?? false)
  ipcMain.handle('window:closeSpace', (_e, spaceId: string) => {
    spaceWindows.get(spaceId)?.close()
    return true
  })
  ipcMain.handle('window:externalSpaces', () => [...spaceWindows.keys()])
  ipcMain.handle('updates:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }))
  ipcMain.handle('updates:status', () => updater.current)
  ipcMain.handle('updates:check', () => updater.check())
  ipcMain.handle('updates:install', () => updater.install())
  ipcMain.on('files:watch', (_e, root: string) => files.watch(root))
  ipcMain.on('files:unwatch', (_e, root: string) => files.unwatch(root))
  ipcMain.handle('files:reveal', (_e, path: string) => shell.showItemInFolder(path))
  // Sposta, rinomina, copia: passo 1 (controlli + proposte di refactoring dei plugin), passo 2 (esecuzione).
  const validItems = (x: unknown): x is MoveItem[] =>
    Array.isArray(x) && x.length > 0 && x.length <= 500 && x.every((i) => i && typeof i.from === 'string' && typeof i.to === 'string')
  ipcMain.handle('files:prepareMove', async (_e, root: string, items: unknown, copy: boolean): Promise<MovePrepareResult> => {
    if (typeof root !== 'string' || !root || !validItems(items)) return { ok: false, error: 'Richiesta non valida.', conflicts: [], edits: [] }
    const v = await validateMove(root, items, Boolean(copy))
    if (!v.ok) return { ok: false, error: v.error, conflicts: [], edits: [] }
    const edits = copy ? [] : ((await lsp?.willRename(items).catch(() => [])) ?? []).filter((f) => isInsidePath(f.path, root))
    return { ok: true, conflicts: v.conflicts, edits }
  })
  ipcMain.handle('files:move', async (_e, root: string, items: unknown, copy: boolean, replace: boolean, edits: unknown): Promise<MoveResult> => {
    if (typeof root !== 'string' || !root || !validItems(items)) return { ok: false, error: 'Richiesta non valida.', edited: 0 }
    const fileEdits = Array.isArray(edits) ? (edits as ApiFileEdit[]).filter((f) => f && typeof f.path === 'string' && Array.isArray(f.edits)) : []
    const r = await performMove(root, items, Boolean(copy), Boolean(replace), fileEdits, applyTextEdits)
    if (r.ok && !copy) lsp?.didRename(items)
    return r
  })

  // ---- Language server (F2, F3), forniti dai plugin ----
  ipcMain.on('lsp:open', (_e, path: string, text: string, workspace?: string) => void lsp?.open(path, text, workspace).catch(() => {}))
  ipcMain.on('lsp:change', (_e, path: string, text: string, workspace?: string) => void lsp?.change(path, text, workspace).catch(() => {}))
  ipcMain.on('lsp:save', (_e, path: string, text: string) => void lsp?.save(path, text).catch(() => {}))
  ipcMain.on('lsp:close', (_e, path: string) => void lsp?.close(path).catch(() => {}))
  ipcMain.handle('lsp:completion', (_e, path: string, pos: ApiPosition) => lsp?.completion(path, pos).catch(() => null) ?? { items: [], incomplete: false })
  ipcMain.handle('lsp:hover', (_e, path: string, pos: ApiPosition) => lsp?.hover(path, pos).catch(() => null) ?? null)
  ipcMain.handle('lsp:definition', (_e, path: string, pos: ApiPosition) => lsp?.definition(path, pos).catch(() => []) ?? [])
  // Pagine dei plugin → adapter: la pagina chiama solo l'adapter del proprio plugin, se è attivo.
  ipcMain.handle('plugin:call', async (_e, pluginId: string, method: string, params?: Record<string, unknown>) => {
    if (typeof pluginId !== 'string' || typeof method !== 'string' || !plugins?.isActive(pluginId)) throw new Error('Plugin non attivo')
    return lsp?.call(pluginId, method, params && typeof params === 'object' ? params : {})
  })
  ipcMain.handle('lsp:statuses', () => lsp?.statuses() ?? [])

  // ---- Browser integrato: barra e posizione del pannello (solo viste che esistono) ----
  const bid = (v: unknown): string => (typeof v === 'string' && v.length <= 120 ? v : '')
  ipcMain.handle('browser:state', (_e, id: string) => browser.state(bid(id)))
  ipcMain.on('browser:bounds', (_e, id: string, b: { x: number; y: number; width: number; height: number }) => {
    if (b && [b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n))) browser.setBounds(bid(id), b)
  })
  ipcMain.on('browser:visible', (_e, id: string, visible: boolean) => browser.setVisible(bid(id), Boolean(visible)))
  ipcMain.on('browser:go', (_e, id: string, text: string) => browser.go(bid(id), String(text ?? '')))
  ipcMain.on('browser:back', (_e, id: string) => browser.back(bid(id)))
  ipcMain.on('browser:forward', (_e, id: string) => browser.forward(bid(id)))
  ipcMain.on('browser:close', (_e, id: string) => browser.closeByUser(bid(id)))
  ipcMain.on('browser:reload', (_e, id: string) => browser.reload(bid(id)))

  // ---- Plugin di linguaggio (X1–X9) ----
  // L'elenco aspetta la verifica dei plugin: così all'avvio gli stati sono quelli veri e la schermata iniziale la copre.
  ipcMain.handle('plugins:list', async () => {
    await plugins?.whenVerified()
    return plugins?.list() ?? []
  })
  ipcMain.handle('plugins:languages', async () => {
    await plugins?.whenVerified()
    return plugins?.languages() ?? []
  })
  // Avvio anticipato degli adapter dei plugin con interfaccia (viste, comandi, margine dell'editor): partono mentre si vede la
  // schermata iniziale invece che alla prima richiesta. Quelli dei soli language server partono quando si apre un file.
  ipcMain.handle('plugins:warm', async () => {
    await plugins?.whenVerified()
    const ids = (plugins?.list() ?? [])
      .filter((p) => p.enabled && p.state === 'ok' && p.manifest.main && (p.manifest.contributes?.sidebarViews?.length || p.manifest.contributes?.commands?.length || p.manifest.contributes?.editorGutter))
      .map((p) => p.manifest.id)
    const limit = new Promise<boolean>((r) => setTimeout(() => r(false), 15000))
    const results = await Promise.all(ids.map((id) => Promise.race([lsp?.warm(id).catch(() => false) ?? Promise.resolve(false), limit])))
    return results.filter(Boolean).length
  })
  ipcMain.handle('plugins:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Importa un plugin',
      filters: [{ name: 'Plugin di Magnolia', extensions: ['ccplugin'] }],
      properties: ['openFile']
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0] || !plugins) return null
    try {
      return { ok: true, preview: await plugins.preview(res.filePaths[0]) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('plugins:previewFile', async (_e, file: string) => {
    if (!plugins) return { ok: false, error: 'Non pronto' }
    try {
      return { ok: true, preview: await plugins.preview(file) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('plugins:cancel', (_e, token: string) => plugins?.cancelPreview(token))
  ipcMain.handle('plugins:install', async (_e, token: string) => {
    if (!plugins || !lsp) return { ok: false, error: 'Non pronto' }
    try {
      await plugins.install(token, (p) => sendToMain('plugins:progress', p), stopWithDependents)
      void lsp.refresh()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('plugins:setEnabled', async (_e, id: string, enabled: boolean) => {
    if (!enabled) await stopWithDependents(id)
    plugins?.setEnabled(id, enabled)
    void lsp?.refresh()
  })
  ipcMain.handle('plugins:uninstall', async (_e, id: string) => (plugins ? plugins.uninstall(id, stopWithDependents) : { ok: false }))
  // ---- Permessi di Claude Code (P1–P6) ----
  ipcMain.handle('permissions:read', (_e, cwd: string) => {
    if (!permissions) return null
    permissions.watch(cwd)
    return permissions.read(cwd)
  })
  ipcMain.handle('permissions:save', (_e, cwd: string, scope: PermissionScope, data: ScopeData) =>
    permissions?.save(cwd, scope, data) ?? { ok: false, error: 'Servizio non pronto' }
  )

  // ---- Progetti .cctproj (J1, J2, J9, J10) ----
  const projects = new ProjectService(store)
  ipcMain.handle('project:open', (_e, path: string) => projects.open(path))
  ipcMain.handle('project:create', (_e, root: string, name?: string) => projects.create(root, name))
  ipcMain.handle('project:save', (_e, root: string, data: ProjectFile) => projects.save(root, data))
  ipcMain.handle('project:recents', () => projects.recents())
  ipcMain.handle('project:forget', (_e, root: string) => projects.forget(root))
  ipcMain.handle('project:pickFile', async (e, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Apri progetto',
      defaultPath: defaultPath && existsSync(defaultPath) ? defaultPath : undefined,
      filters: [{ name: 'Progetto Magnolia', extensions: ['cctproj'] }],
      properties: ['openFile']
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })

  /** Sceglie documenti Markdown o una cartella e li restituisce come percorsi relativi alla radice (J4, J6, J10). */
  ipcMain.handle('project:pickRelative', async (e, root: string, mode: 'docs' | 'dir') => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions =
      mode === 'docs'
        ? {
            title: 'Scegli documenti Markdown',
            defaultPath: existsSync(root) ? root : undefined,
            filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
            properties: ['openFile', 'multiSelections']
          }
        : { title: 'Scegli la cartella d’ambito', defaultPath: existsSync(root) ? root : undefined, properties: ['openDirectory'] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled) return { paths: [], skipped: 0 }
    const rel = res.filePaths.map((p) => projects.toRelative(root, p))
    // Su un altro disco non esiste un percorso relativo: si scarta (il file di progetto non ha percorsi assoluti).
    const paths = rel.filter((p) => !/^[a-zA-Z]:/.test(p))
    return { paths, skipped: rel.length - paths.length }
  })

  ipcMain.handle('settings:get', (_e, key: string) => store.getSetting(key))
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => store.setSetting(key, value))

  // ---- Sessioni (requisiti §3) ----
  ipcMain.handle('sessions:list', (e) => {
    watch(e.sender)
    return sessions.list()
  })
  ipcMain.handle('sessions:create', (e, req: CreateSessionRequest) => {
    watch(e.sender)
    return sessions.create(req)
  })
  ipcMain.handle('sessions:attach', (e, id: string, viewId: string) => sessions.attach(id, viewId, e.sender))
  ipcMain.on('sessions:detach', (_e, id: string, viewId: string) => sessions.detach(id, viewId))
  ipcMain.on('sessions:input', (_e, id: string, viewId: string, data: string) => sessions.input(id, viewId, data))
  // Tasti dalla vista grafica: solo Esc, Invio, frecce e cifre (risposte ai permessi, interruzione), mai testo libero.
  ipcMain.on('sessions:key', (_e, id: string, key: string) => {
    const keys: Record<string, string> = { esc: '\x1b', enter: '\r', up: '\x1b[A', down: '\x1b[B', space: ' ' }
    const data = keys[key] ?? (/^[1-9]$/.test(key) ? key : null)
    if (data) sessions.sendKeys(id, data)
  })
  ipcMain.on('sessions:resize', (_e, id: string, viewId: string, cols: number, rows: number, claim: boolean) =>
    sessions.resize(id, viewId, cols, rows, claim)
  )
  ipcMain.handle('sessions:setModel', (_e, id: string, model: ClaudeModel, effort: ClaudeEffort) =>
    sessions.setModel(id, model, effort)
  )
  ipcMain.handle('sessions:markIdle', (_e, id: string) => sessions.markIdle(id))
  ipcMain.handle('sessions:kill', (_e, id: string) => sessions.kill(id))
  // Casella di input dell'app (B1–B3): il messaggio va a Claude come se lo digitasse l'utente.
  ipcMain.handle('sessions:sendPrompt', (_e, id: string, text: string): RevisionResult => {
    const clean = typeof text === 'string' ? text.trim() : ''
    if (!clean) return { ok: false, error: 'Il messaggio è vuoto.' }
    if (clean.length > 100_000) return { ok: false, error: 'Il messaggio è troppo lungo.' }
    const can = sessions.canReceivePrompt(id)
    if (!can.ok) return can
    if (sessions.isLocked(id)) return { ok: false, error: REVIEW_LOCK_MESSAGE }
    sessions.sendPrompt(id, clean)
    return { ok: true }
  })

  // ---- Ambiente: Claude Code, shell, cronologia, preferenze di progetto (W1–W4) ----
  ipcMain.handle('env:claudeCli', (_e, refresh?: boolean) => findClaudeCli(refresh))
  // Il rilevamento delle shell (WSL compreso) è lento: si ricorda per un minuto, così aprire «Nuovo terminale» è immediato.
  let shellsCache: { at: number; list: Awaited<ReturnType<typeof detectShells>> } | null = null
  ipcMain.handle('env:shells', async () => {
    if (!shellsCache || Date.now() - shellsCache.at > 60_000) shellsCache = { at: Date.now(), list: await detectShells() }
    return shellsCache.list.map((s) => s.info)
  })
  ipcMain.handle('env:resumable', (_e, cwd: string) => listResumable(cwd))
  ipcMain.handle('env:projectPrefs', (_e, cwd: string) => store.getProjectPrefs(cwd))
  ipcMain.handle('env:recentProjects', () => store.recentProjects())
  ipcMain.handle('env:saveProjectPrefs', (_e, p: Omit<ProjectPrefs, 'updatedAt'>) => store.saveProjectPrefs(p))
  ipcMain.handle('env:homeDir', () => homedir())
  ipcMain.handle('env:pickFolder', async (e, defaultPath?: string, title?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: title ?? 'Scegli la cartella',
      defaultPath: defaultPath && existsSync(defaultPath) ? defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle('env:pickFile', async (e, opts?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const filters = (Array.isArray(opts?.filters) ? opts.filters : []).filter((f) => f && typeof f.name === 'string' && Array.isArray(f.extensions)).slice(0, 10)
    const o: Electron.OpenDialogOptions = {
      title: typeof opts?.title === 'string' ? opts.title.slice(0, 200) : 'Scegli il file',
      defaultPath: typeof opts?.defaultPath === 'string' && existsSync(opts.defaultPath) ? opts.defaultPath : undefined,
      filters: filters.map((f) => ({ name: f.name.slice(0, 80), extensions: f.extensions.map(String).slice(0, 20) })),
      properties: ['openFile']
    }
    const res = win ? await dialog.showOpenDialog(win, o) : await dialog.showOpenDialog(o)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle('env:pathStatus', async (_e, path: string) => {
    if (!isValidFolderPath(path)) return 'invalid'
    try {
      return (await stat(path)).isDirectory() ? 'dir' : 'file'
    } catch {
      return 'missing'
    }
  })
  ipcMain.handle('env:createFolder', async (_e, path: string) => {
    if (!isValidFolderPath(path)) return { ok: false, error: 'Scrivi un percorso completo, per esempio D:\\PROGETTI\\nuovo-progetto oppure /home/utente/nuovo-progetto.' }
    try {
      await mkdir(path, { recursive: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `Impossibile creare la cartella: ${(err as Error).message}` }
    }
  })
}

function watch(wc: WebContents): void {
  if (sessionWatchers.has(wc)) return
  sessionWatchers.add(wc)
  const forget = () => {
    sessionWatchers.delete(wc)
    sessions.dropViewsOf(wc)
  }
  wc.once('destroyed', forget)
  // Un ricaricamento della pagina cancella tutte le viste di quella finestra.
  wc.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) sessions.dropViewsOf(wc)
  })
}

sessions.onChange((list) => {
  for (const wc of sessionWatchers) if (!wc.isDestroyed()) wc.send('sessions:changed', list)
})

// Una sola istanza: due copie dell'app scriverebbero sullo stesso database e avrebbero sessioni separate.
// Per le prove: una cartella dati separata (database e blocco d'istanza propri), senza toccare l'app in uso.
if (process.env.CCT_USER_DATA) app.setPath('userData', process.env.CCT_USER_DATA)
// L'app si chiamava «Claude Code Terminal»: la cartella dati (database, impostazioni, plugin) resta quella, così nessuno perde niente.
else app.setPath('userData', join(app.getPath('appData'), 'Claude Code Terminal'))

const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = mainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

app.whenReady().then(async () => {
  if (!primaryInstance) return
  // Su Windows le notifiche richiedono un AppUserModelID (lo stesso dell'installer).
  app.setAppUserModelId('it.coletta.claude-code-terminal')
  Menu.setApplicationMenu(null)
  // A batteria lo sfondo animato si ferma (vedi AppBackground): l'interfaccia viene avvisata dei cambi.
  powerMonitor.on('on-battery', () => sendToMain('power:changed', true))
  powerMonitor.on('on-ac', () => sendToMain('power:changed', false))
  serveRenderer()
  sessions.cleanStaleSettings()
  try {
    await hookServer.start()
  } catch (err) {
    console.error('Server degli hook non avviato: stato e notifiche useranno solo l\'attività del terminale', err)
  }
  db = new AppDb(join(app.getPath('userData'), 'claude-code-terminal.db'))
  changes = new ChangeTracker(db, join(app.getPath('userData'), 'snapshots'), () => {
    const win = mainWindow()
    if (win && !win.isDestroyed() && changes) win.webContents.send('changes:changed', changes.list())
  })
  changes.cleanup()
  sessions.setLockCheck((info) => info.status === 'idle' && isReviewLocked(info, changes?.list() ?? []))
  explain = new ExplainService(db, join(app.getPath('userData'), 'explain-work'))
  plugins = new PluginManager(db, join(app.getPath('userData'), 'plugins'), join(app.getPath('userData'), 'plugin-data'), () => {
    sendToMain('plugins:changed', plugins?.list() ?? [], plugins?.languages() ?? [])
  })
  plugins.startVerification()
  lsp = new PluginHost(
    plugins,
    (d) => sendToMain('lsp:diagnostics', d),
    (s) => sendToMain('lsp:status', s)
  )
  lsp.setServices({
    getSetting: (k) => db?.getSetting(k),
    setSetting: (k, v) => db?.setSetting(k, v),
    createTask: (req) => sessions.create(req as CreateSessionRequest),
    killSession: (id) => sessions.kill(id),
    sessionStatus: (id) => sessions.list().find((x) => x.id === id)?.status,
    emit: (pluginId, event, data) => sendToMain('plugin:event', { pluginId, event, data }),
    markers: (update) => sendToMain('plugin:markers', update),
    browser
  })
  // Eventi dell'app per gli adapter che li chiedono (contributes.events): solo metadati delle sessioni, mai il loro output.
  const seenSessions = new Map<string, string>()
  sessions.onChange((list) => {
    const brief = (s: (typeof list)[number]) => ({ id: s.id, kind: s.kind, title: s.title, cwd: s.cwd, status: s.status, exitCode: s.exitCode })
    for (const s of list) {
      const before = seenSessions.get(s.id)
      if (before === s.status) continue
      seenSessions.set(s.id, s.status)
      if (before === undefined) lsp?.broadcast('session.created', brief(s))
      else if (s.status === 'exited') lsp?.broadcast('session.exited', brief(s))
      else lsp?.broadcast('session.status', brief(s))
    }
    for (const id of seenSessions.keys()) if (!list.some((s) => s.id === id)) seenSessions.delete(id)
  })
  permissions = new PermissionsService(
    db,
    (cwd) => sessions.list().some((s) => s.kind === 'claude' && s.status !== 'exited' && s.cwd.toLowerCase() === cwd.toLowerCase()),
    (change) => {
      const win = mainWindow()
      if (win && !win.isDestroyed()) win.webContents.send('permissions:external', change)
    }
  )
  registerIpc(db)
  createMainWindow()
  updater.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('before-quit', () => {
  sessions.killAll()
  hookServer.stop()
  browser.dispose()
  lsp?.stopAll()
  files.dispose()
  transcripts.dispose()
  updater.dispose()
})

app.on('window-all-closed', () => {
  sessions.killAll()
  db?.close()
  db = null
  if (process.platform !== 'darwin') app.quit()
})
