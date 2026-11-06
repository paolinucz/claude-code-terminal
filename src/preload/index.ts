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
  changes: {
    list: () => ipcRenderer.invoke('changes:list'),
    contents: (id) => ipcRenderer.invoke('changes:contents', id),
    approve: (id) => ipcRenderer.invoke('changes:approve', id),
    approveAll: (sessionId) => ipcRenderer.invoke('changes:approveAll', sessionId),
    reject: (id, force) => ipcRenderer.invoke('changes:reject', id, force),
    requestRevision: (id, notes) => ipcRenderer.invoke('changes:requestRevision', id, notes),
    onChanged: (cb) => on('changes:changed', cb)
  },
  files: {
    list: (dir) => ipcRenderer.invoke('files:list', dir),
    read: (path) => ipcRenderer.invoke('files:read', path),
    write: (path, text, expectedMtime, force) => ipcRenderer.invoke('files:write', path, text, expectedMtime, force),
    gitStatus: (dir) => ipcRenderer.invoke('files:gitStatus', dir),
    watch: (root) => ipcRenderer.send('files:watch', root),
    unwatch: (root) => ipcRenderer.send('files:unwatch', root),
    reveal: (path) => ipcRenderer.invoke('files:reveal', path),
    onChanged: (cb) => on('files:changed', cb)
  },
  lsp: {
    open: (language, path, text, workspace) => ipcRenderer.send('lsp:open', language, path, text, workspace),
    change: (language, path, text, workspace) => ipcRenderer.send('lsp:change', language, path, text, workspace),
    save: (language, path, text, workspace) => ipcRenderer.send('lsp:save', language, path, text, workspace),
    close: (language, path, workspace) => ipcRenderer.send('lsp:close', language, path, workspace),
    request: (language, path, method, params, workspace) => ipcRenderer.invoke('lsp:request', language, path, method, params, workspace),
    statuses: () => ipcRenderer.invoke('lsp:statuses'),
    onDiagnostics: (cb) => on('lsp:diagnostics', cb),
    onStatus: (cb) => on('lsp:status', cb),
    javaInstalled: () => ipcRenderer.invoke('java:installed'),
    installJava: () => ipcRenderer.invoke('java:install'),
    onJavaProgress: (cb) => on('java:progress', cb)
  },
  permissions: {
    read: (cwd) => ipcRenderer.invoke('permissions:read', cwd),
    save: (cwd, scope, data) => ipcRenderer.invoke('permissions:save', cwd, scope, data),
    onExternalChange: (cb) => on('permissions:external', cb)
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
    onExit: (cb) => on('session:exit', cb),
    onAttention: (cb) => on('session:attention', cb),
    onReveal: (cb) => on('session:reveal', cb)
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
