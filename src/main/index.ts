import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, protocol, shell, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SerializedLayout, Sheet } from '@shared/types'
import type { ClaudeEffort, ClaudeModel, CreateSessionRequest, ProjectPrefs } from '@shared/sessions'
import type { ReviewNote, RevisionResult } from '@shared/changes'
import { AppDb } from './db'
import { SessionManager } from './sessions/SessionManager'
import { HookServer } from './sessions/HookServer'
import { ChangeTracker } from './changes/ChangeTracker'
import { PermissionsService } from './permissions/PermissionsService'
import { FileService } from './files/FileService'
import { PluginHost } from './plugins/PluginHost'
import { PluginManager } from './plugins/PluginManager'
import type { ApiPosition } from '@shared/pluginApi'
import type { PermissionScope, ScopeData } from '@shared/permissions'
import { detectShells, findClaudeCli } from './sessions/environment'
import { listResumable } from './sessions/history'
import { Updater } from './updater'
import { ProjectService } from './projects/ProjectService'
import { EXPLAIN_CSP, ExplainService } from './changes/ExplainService'
import { EXPLAIN_HOST, type ExplainResult } from '@shared/explain'
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
/** Fase 4: modifiche di Claude ai file (creato quando il database è pronto). */
let changes: ChangeTracker | null = null
/** Fase 5: file dei permessi di Claude Code. */
let permissions: PermissionsService | null = null

// ---- Fase 6: file, editor, language server ----
const sendToMain = (channel: string, ...args: unknown[]) => {
  const win = mainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}
const files = new FileService((root, paths) => sendToMain('files:changed', root, paths))
/** Fase 6a: plugin di linguaggio e i loro language server (creati quando il database è pronto). */
let plugins: PluginManager | null = null
let lsp: PluginHost | null = null

/** Ferma un plugin e quelli che lo richiedono (es. Java → Maven, Gradle: usano il suo runtime). */
async function stopWithDependents(id: string): Promise<void> {
  const ids = [id, ...(plugins?.list() ?? []).filter((p) => p.manifest.requires?.includes(id)).map((p) => p.manifest.id)]
  await Promise.all(ids.map((x) => lsp?.stopPlugin(x)))
}
/** Fase 8: aggiornamenti automatici da GitHub Releases. */
const updater = new Updater((s) => sendToMain('updates:status', s))

const sessions = new SessionManager(
  (id) => hookServer.claudeSettings(id),
  join(tmpdir(), 'claude-code-terminal', `settings-${process.pid}`)
)

/** S7: notifica quando una sessione finisce o chiede un permesso, anche se il suo foglio non è aperto. */
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

function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('popout.html'))
}
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
    const file = normalize(join(root, decodeURIComponent(pathname)))
    if (host !== 'renderer' || !(file === root || file.startsWith(root + sep))) {
      return new Response('Non trovato', { status: 404 })
    }
    return net.fetch(pathToFileURL(file).toString())
  })
}

/** Opzioni comuni a finestra principale e finestre staccate, per lo stesso aspetto scuro. */
const darkWindow = {
  backgroundColor: '#09090B',
  autoHideMenuBar: true,
  titleBarStyle: 'hidden' as const,
  titleBarOverlay: { color: '#18181B', symbolColor: '#D4D4D8', height: 44 }
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...darkWindow,
    width: 1600,
    height: 1000,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Claude Code Terminal',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => {
    win.maximize()
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
          titleBarOverlay: { ...darkWindow.titleBarOverlay, height: 36 },
          title: 'Claude Code Terminal – pannello staccato',
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
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadURL(`${APP_ORIGIN}/index.html`)
  }
  return win
}

/** Percorso assoluto di Windows (C:\… o \\server\…) senza caratteri non ammessi nei nomi. */
function isValidFolderPath(path: string): boolean {
  if (typeof path !== 'string' || path.length > 240) return false
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
    'workspace:saveSheets',
    (_e, sheets: Pick<Sheet, 'id' | 'name' | 'contextId'>[], activeSheetId: string | null) =>
      store.saveSheets(sheets, activeSheetId)
  )
  ipcMain.handle('workspace:saveSheetLayout', (_e, sheetId: string, layout: SerializedLayout | null) =>
    store.saveSheetLayout(sheetId, layout)
  )
  ipcMain.handle('layouts:list', () => store.listLayouts())
  ipcMain.handle('layouts:save', (_e, name: string, layout: SerializedLayout) => store.saveLayout(name, layout))
  ipcMain.handle('layouts:remove', (_e, id: string) => store.removeLayout(id))

  // ---- Modifiche di Claude (F4–F7) ----
  ipcMain.handle('changes:list', () => changes?.list() ?? [])
  ipcMain.handle('changes:contents', (_e, id: string) => changes?.contents(id) ?? null)
  ipcMain.handle('changes:approve', (_e, id: string) => changes?.approve(id))
  ipcMain.handle('changes:approveAll', (_e, sessionId?: string) => changes?.approveAll(sessionId) ?? 0)
  ipcMain.handle('changes:approveMany', (_e, ids: string[]) => changes?.approveMany(ids) ?? 0)
  ipcMain.handle(
    'changes:rejectMany',
    (_e, ids: string[], force?: boolean) => changes?.rejectMany(ids, Boolean(force)) ?? { rejected: 0, needsForce: [], failed: [] }
  )
  ipcMain.handle('changes:reject',(_e, id: string, force?: boolean) => changes?.reject(id, force) ?? { ok: false })
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

  // ---- Output smart (O1–O8): solo a richiesta dell'utente ----
  ipcMain.handle('explain:peek', (_e, changeId: string): ExplainResult | null => explain?.peek(changes?.contents(changeId) ?? null) ?? null)
  ipcMain.handle(
    'explain:run',
    (_e, requestId: string, changeId: string, force?: boolean): Promise<ExplainResult> | ExplainResult =>
      explain ? explain.run(requestId, changes?.contents(changeId) ?? null, Boolean(force)) : { ok: false, error: 'Servizio non pronto' }
  )
  ipcMain.handle('explain:cancel', (_e, requestId: string) => explain?.cancel(requestId))

  // ---- File (F1, F2) ----
  ipcMain.handle('files:list', (_e, dir: string) => files.list(dir))
  ipcMain.handle('files:read', (_e, path: string) => files.read(path))
  ipcMain.handle('files:write', (_e, path: string, text: string, expectedMtime?: number, force?: boolean) =>
    files.write(path, text, expectedMtime, force)
  )
  ipcMain.handle('files:gitStatus', (_e, dir: string) => files.gitStatus(dir))
  ipcMain.handle('files:index', (_e, root: string) => files.index(root))
  ipcMain.handle('updates:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }))
  ipcMain.handle('updates:status', () => updater.current)
  ipcMain.handle('updates:check', () => updater.check())
  ipcMain.handle('updates:install', () => updater.install())
  ipcMain.on('files:watch', (_e, root: string) => files.watch(root))
  ipcMain.on('files:unwatch', (_e, root: string) => files.unwatch(root))
  ipcMain.handle('files:reveal', (_e, path: string) => shell.showItemInFolder(path))

  // ---- Language server (F2, F3), forniti dai plugin ----
  ipcMain.on('lsp:open', (_e, path: string, text: string, workspace?: string) => void lsp?.open(path, text, workspace).catch(() => {}))
  ipcMain.on('lsp:change', (_e, path: string, text: string, workspace?: string) => void lsp?.change(path, text, workspace).catch(() => {}))
  ipcMain.on('lsp:save', (_e, path: string, text: string) => void lsp?.save(path, text).catch(() => {}))
  ipcMain.on('lsp:close', (_e, path: string) => void lsp?.close(path).catch(() => {}))
  ipcMain.handle('lsp:completion', (_e, path: string, pos: ApiPosition) => lsp?.completion(path, pos).catch(() => null) ?? { items: [], incomplete: false })
  ipcMain.handle('lsp:hover', (_e, path: string, pos: ApiPosition) => lsp?.hover(path, pos).catch(() => null) ?? null)
  ipcMain.handle('lsp:definition', (_e, path: string, pos: ApiPosition) => lsp?.definition(path, pos).catch(() => []) ?? [])
  ipcMain.handle('lsp:statuses', () => lsp?.statuses() ?? [])

  // ---- Plugin di linguaggio (X1–X9) ----
  ipcMain.handle('plugins:list', () => plugins?.list() ?? [])
  ipcMain.handle('plugins:languages', () => plugins?.languages() ?? [])
  ipcMain.handle('plugins:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Importa un plugin',
      filters: [{ name: 'Plugin di Claude Code Terminal', extensions: ['ccplugin'] }],
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
      filters: [{ name: 'Progetto Claude Code Terminal', extensions: ['cctproj'] }],
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
  ipcMain.on('sessions:resize', (_e, id: string, viewId: string, cols: number, rows: number, claim: boolean) =>
    sessions.resize(id, viewId, cols, rows, claim)
  )
  ipcMain.handle('sessions:setModel', (_e, id: string, model: ClaudeModel, effort: ClaudeEffort) =>
    sessions.setModel(id, model, effort)
  )
  ipcMain.handle('sessions:kill', (_e, id: string) => sessions.kill(id))
  // Casella di input dell'app (B1–B3): il messaggio va a Claude come se lo digitasse l'utente.
  ipcMain.handle('sessions:sendPrompt', (_e, id: string, text: string): RevisionResult => {
    const clean = typeof text === 'string' ? text.trim() : ''
    if (!clean) return { ok: false, error: 'Il messaggio è vuoto.' }
    if (clean.length > 100_000) return { ok: false, error: 'Il messaggio è troppo lungo.' }
    const can = sessions.canReceivePrompt(id)
    if (!can.ok) return can
    sessions.sendPrompt(id, clean)
    return { ok: true }
  })

  // ---- Ambiente: Claude Code, shell, cronologia, preferenze di progetto (W1–W4) ----
  ipcMain.handle('env:claudeCli', (_e, refresh?: boolean) => findClaudeCli(refresh))
  ipcMain.handle('env:shells', async () => (await detectShells()).map((s) => s.info))
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
  ipcMain.handle('env:pathStatus', async (_e, path: string) => {
    if (!isValidFolderPath(path)) return 'invalid'
    try {
      return (await stat(path)).isDirectory() ? 'dir' : 'file'
    } catch {
      return 'missing'
    }
  })
  ipcMain.handle('env:createFolder', async (_e, path: string) => {
    if (!isValidFolderPath(path)) return { ok: false, error: 'Scrivi un percorso completo, per esempio D:\\PROGETTI\\nuovo-progetto.' }
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
  explain = new ExplainService(db, join(app.getPath('userData'), 'explain-work'))
  plugins = new PluginManager(db, join(app.getPath('userData'), 'plugins'), join(app.getPath('userData'), 'plugin-data'), () => {
    sendToMain('plugins:changed', plugins?.list() ?? [], plugins?.languages() ?? [])
  })
  void plugins.verifyAll()
  lsp = new PluginHost(
    plugins,
    (d) => sendToMain('lsp:diagnostics', d),
    (s) => sendToMain('lsp:status', s)
  )
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
  lsp?.stopAll()
  files.dispose()
  updater.dispose()
})

app.on('window-all-closed', () => {
  sessions.killAll()
  db?.close()
  db = null
  if (process.platform !== 'darwin') app.quit()
})
