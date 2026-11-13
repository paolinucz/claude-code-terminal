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
    saveSpaces: (spaces, activeSpaceId) => ipcRenderer.invoke('workspace:saveSpaces', spaces, activeSpaceId),
    saveSpaceLayout: (spaceId, layout) => ipcRenderer.invoke('workspace:saveSpaceLayout', spaceId, layout)
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
    approveMany: (ids) => ipcRenderer.invoke('changes:approveMany', ids),
    rejectMany: (ids, force) => ipcRenderer.invoke('changes:rejectMany', ids, force),
    reject: (id, force) => ipcRenderer.invoke('changes:reject', id, force),
    requestRevision: (id, notes) => ipcRenderer.invoke('changes:requestRevision', id, notes),
    reviewFile: (sessionId, filePath, notes) => ipcRenderer.invoke('changes:reviewFile', sessionId, filePath, notes),
    onChanged: (cb) => on('changes:changed', cb)
  },
  files: {
    list: (dir) => ipcRenderer.invoke('files:list', dir),
    read: (path) => ipcRenderer.invoke('files:read', path),
    write: (path, text, expectedMtime, force) => ipcRenderer.invoke('files:write', path, text, expectedMtime, force),
    gitStatus: (dir) => ipcRenderer.invoke('files:gitStatus', dir),
    index: (root) => ipcRenderer.invoke('files:index', root),
    search: (root, query, opts) => ipcRenderer.invoke('files:search', root, query, opts),
    watch: (root) => ipcRenderer.send('files:watch', root),
    unwatch: (root) => ipcRenderer.send('files:unwatch', root),
    reveal: (path) => ipcRenderer.invoke('files:reveal', path),
    prepareMove: (root, items, copy) => ipcRenderer.invoke('files:prepareMove', root, items, copy),
    move: (root, items, copy, replace, edits) => ipcRenderer.invoke('files:move', root, items, copy, replace, edits),
    onChanged: (cb) => on('files:changed', cb)
  },
  lsp: {
    open: (path, text, workspace) => ipcRenderer.send('lsp:open', path, text, workspace),
    change: (path, text, workspace) => ipcRenderer.send('lsp:change', path, text, workspace),
    save: (path, text) => ipcRenderer.send('lsp:save', path, text),
    close: (path) => ipcRenderer.send('lsp:close', path),
    completion: (path, position) => ipcRenderer.invoke('lsp:completion', path, position),
    hover: (path, position) => ipcRenderer.invoke('lsp:hover', path, position),
    definition: (path, position) => ipcRenderer.invoke('lsp:definition', path, position),
    statuses: () => ipcRenderer.invoke('lsp:statuses'),
    onDiagnostics: (cb) => on('lsp:diagnostics', cb),
    onStatus: (cb) => on('lsp:status', cb)
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    languages: () => ipcRenderer.invoke('plugins:languages'),
    pick: () => ipcRenderer.invoke('plugins:pick'),
    previewFile: (file) => ipcRenderer.invoke('plugins:previewFile', file),
    cancel: (token) => ipcRenderer.invoke('plugins:cancel', token),
    install: (token) => ipcRenderer.invoke('plugins:install', token),
    setEnabled: (id, enabled) => ipcRenderer.invoke('plugins:setEnabled', id, enabled),
    uninstall: (id) => ipcRenderer.invoke('plugins:uninstall', id),
    warm: () => ipcRenderer.invoke('plugins:warm'),
    onChanged: (cb) => on('plugins:changed', cb),
    onProgress: (cb) => on('plugins:progress', cb),
    call: (pluginId, method, params) => ipcRenderer.invoke('plugin:call', pluginId, method, params),
    onEvent: (cb) => on('plugin:event', cb),
    onMarkers: (cb) => on('plugin:markers', cb)
  },  browser: {
    state: (id) => ipcRenderer.invoke('browser:state', id),
    setBounds: (id, bounds) => ipcRenderer.send('browser:bounds', id, bounds),
    setVisible: (id, visible) => ipcRenderer.send('browser:visible', id, visible),
    go: (id, text) => ipcRenderer.send('browser:go', id, text),
    back: (id) => ipcRenderer.send('browser:back', id),
    forward: (id) => ipcRenderer.send('browser:forward', id),
    reload: (id) => ipcRenderer.send('browser:reload', id),
    close: (id) => ipcRenderer.send('browser:close', id),
    onState: (cb) => on('browser:state', cb)
  },
  permissions: {
    read: (cwd) => ipcRenderer.invoke('permissions:read', cwd),
    save: (cwd, scope, data) => ipcRenderer.invoke('permissions:save', cwd, scope, data),
    onExternalChange: (cb) => on('permissions:external', cb)
  },
  windows: {
    openSpace: (spaceId) => ipcRenderer.invoke('window:openSpace', spaceId),
    closeSpace: (spaceId) => ipcRenderer.invoke('window:closeSpace', spaceId),
    externalSpaces: () => ipcRenderer.invoke('window:externalSpaces'),
    onSpaces: (cb) => on('window:spaces', cb),
    toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen'),
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    onFullScreen: (cb) => on('window:fullscreen', cb)
  },
  power: {
    onBattery: () => ipcRenderer.invoke('power:onBattery'),
    onChanged: (cb) => on('power:changed', cb)
  },
  updates: {
    info: () => ipcRenderer.invoke('updates:info'),
    status: () => ipcRenderer.invoke('updates:status'),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStatus: (cb) => on('updates:status', cb)
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
    key: (sessionId, key) => ipcRenderer.send('sessions:key', sessionId, key),
    resize: (sessionId, viewId, cols, rows, claim) => ipcRenderer.send('sessions:resize', sessionId, viewId, cols, rows, claim),
    setModel: (sessionId, model, effort) => ipcRenderer.invoke('sessions:setModel', sessionId, model, effort),
    kill: (sessionId) => ipcRenderer.invoke('sessions:kill', sessionId),
    markIdle: (sessionId) => ipcRenderer.invoke('sessions:markIdle', sessionId),
    sendPrompt: (sessionId, text) => ipcRenderer.invoke('sessions:sendPrompt', sessionId, text),
    onChanged: (cb) => on('sessions:changed', cb),
    onData: (cb) => on('session:data', cb),
    onResize: (cb) => on('session:resize', cb),
    onExit: (cb) => on('session:exit', cb),
    onAttention: (cb) => on('session:attention', cb),
    onReveal: (cb) => on('session:reveal', cb)
  },
  transcript: {
    open: (sessionId) => ipcRenderer.invoke('transcript:open', sessionId),
    close: (sessionId) => ipcRenderer.send('transcript:close', sessionId),
    onUpdate: (cb) => on('transcript:update', cb)
  },
  explain: {
    peek: (changeId) => ipcRenderer.invoke('explain:peek', changeId),
    run: (requestId, changeId, force) => ipcRenderer.invoke('explain:run', requestId, changeId, force),
    snippet: (requestId, req, force) => ipcRenderer.invoke('explain:snippet', requestId, req, force),
    cancel: (requestId) => ipcRenderer.invoke('explain:cancel', requestId)
  },
  project: {
    open: (path) => ipcRenderer.invoke('project:open', path),
    create: (root, name) => ipcRenderer.invoke('project:create', root, name),
    save: (root, data) => ipcRenderer.invoke('project:save', root, data),
    recents: () => ipcRenderer.invoke('project:recents'),
    forget: (root) => ipcRenderer.invoke('project:forget', root),
    pickFile: (defaultPath) => ipcRenderer.invoke('project:pickFile', defaultPath),
    pickRelative: (root, mode) => ipcRenderer.invoke('project:pickRelative', root, mode)
  },
  env: {
    claudeCli: (refresh) => ipcRenderer.invoke('env:claudeCli', refresh),
    shells: () => ipcRenderer.invoke('env:shells'),
    resumable: (cwd) => ipcRenderer.invoke('env:resumable', cwd),
    projectPrefs: (cwd) => ipcRenderer.invoke('env:projectPrefs', cwd),
    recentProjects: () => ipcRenderer.invoke('env:recentProjects'),
    saveProjectPrefs: (p) => ipcRenderer.invoke('env:saveProjectPrefs', p),
    pickFolder: (defaultPath, title) => ipcRenderer.invoke('env:pickFolder', defaultPath, title),
    pickFile: (opts) => ipcRenderer.invoke('env:pickFile', opts),
    homeDir: () => ipcRenderer.invoke('env:homeDir'),
    pathStatus: (path) => ipcRenderer.invoke('env:pathStatus', path),
    createFolder: (path) => ipcRenderer.invoke('env:createFolder', path)
  }
}

contextBridge.exposeInMainWorld('api', api)
