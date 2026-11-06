import { app, BrowserWindow, dialog, ipcMain, Menu, net, Notification, protocol, shell, type WebContents } from 'electron'
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
import { detectShells, findClaudeCli } from './sessions/environment'
import { listResumable } from './sessions/history'

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

function serveRenderer(): void {
  const root = normalize(join(__dirname, '../renderer'))
  protocol.handle(APP_SCHEME, (request) => {
    const { host, pathname } = new URL(request.url)
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
    (_e, sheets: Pick<Sheet, 'id' | 'name'>[], activeSheetId: string | null) =>
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
  ipcMain.handle('changes:reject', (_e, id: string, force?: boolean) => changes?.reject(id, force) ?? { ok: false })
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

  // ---- Ambiente: Claude Code, shell, cronologia, preferenze di progetto (W1–W4) ----
  ipcMain.handle('env:claudeCli', (_e, refresh?: boolean) => findClaudeCli(refresh))
  ipcMain.handle('env:shells', async () => (await detectShells()).map((s) => s.info))
  ipcMain.handle('env:resumable', (_e, cwd: string) => listResumable(cwd))
  ipcMain.handle('env:projectPrefs', (_e, cwd: string) => store.getProjectPrefs(cwd))
  ipcMain.handle('env:recentProjects', () => store.recentProjects())
  ipcMain.handle('env:saveProjectPrefs', (_e, p: Omit<ProjectPrefs, 'updatedAt'>) => store.saveProjectPrefs(p))
  ipcMain.handle('env:homeDir', () => homedir())
  ipcMain.handle('env:pickFolder', async (e, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = { title: 'Scegli la cartella', defaultPath, properties: ['openDirectory'] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
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
  registerIpc(db)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('before-quit', () => {
  sessions.killAll()
  hookServer.stop()
})

app.on('window-all-closed', () => {
  sessions.killAll()
  db?.close()
  db = null
  if (process.platform !== 'darwin') app.quit()
})
