import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SerializedLayout, Sheet } from '@shared/types'
import { AppDb } from './db'

const isDev = !app.isPackaged
let db: AppDb | null = null

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
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  serveRenderer()
  db = new AppDb(join(app.getPath('userData'), 'claude-code-terminal.db'))
  registerIpc(db)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  db?.close()
  db = null
  if (process.platform !== 'darwin') app.quit()
})
