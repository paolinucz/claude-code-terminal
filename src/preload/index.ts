import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppApi } from '@shared/types'

/** Iscrizione a un evento dal processo principale; restituisce la funzione per annullarla. */
function on<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: AppApi = {
  backend: 'sqlite',
  workspace: {
    load: () => ipcRenderer.invoke('workspace:load'),
    saveSheets: (sheets, activeSheetId) => ipcRenderer.invoke('workspace:saveSheets', sheets, activeSheetId),
    saveSheetLayout: (sheetId, layout) => ipcRenderer.invoke('workspace:saveSheetLayout', sheetId, layout)
  },
  layouts: {
    list: () => ipcRenderer.invoke('layouts:list'),
    save: (name, layout) => ipcRenderer.invoke('layouts:save', name, layout),
    remove: (id) => ipcRenderer.invoke('layouts:remove', id)
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value)
  },
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    create: (req) => ipcRenderer.invoke('sessions:create', req),
    attach: (sessionId, viewId) => ipcRenderer.invoke('sessions:attach', sessionId, viewId),
    detach: (sessionId, viewId) => ipcRenderer.send('sessions:detach', sessionId, viewId),
    input: (sessionId, viewId, data) => ipcRenderer.send('sessions:input', sessionId, viewId, data),
    resize: (sessionId, viewId, cols, rows, claim) => ipcRenderer.send('sessions:resize', sessionId, viewId, cols, rows, claim),
    setModel: (sessionId, model, effort) => ipcRenderer.invoke('sessions:setModel', sessionId, model, effort),
    kill: (sessionId) => ipcRenderer.invoke('sessions:kill', sessionId),
    onChanged: (cb) => on('sessions:changed', cb),
    onData: (cb) => on('session:data', cb),
    onResize: (cb) => on('session:resize', cb),
    onExit: (cb) => on('session:exit', cb)
  },
  env: {
    claudeCli: (refresh) => ipcRenderer.invoke('env:claudeCli', refresh),
    shells: () => ipcRenderer.invoke('env:shells'),
    resumable: (cwd) => ipcRenderer.invoke('env:resumable', cwd),
    projectPrefs: (cwd) => ipcRenderer.invoke('env:projectPrefs', cwd),
    recentProjects: () => ipcRenderer.invoke('env:recentProjects'),
    saveProjectPrefs: (p) => ipcRenderer.invoke('env:saveProjectPrefs', p),
    pickFolder: (defaultPath) => ipcRenderer.invoke('env:pickFolder', defaultPath),
    homeDir: () => ipcRenderer.invoke('env:homeDir')
  }
}

contextBridge.exposeInMainWorld('api', api)
