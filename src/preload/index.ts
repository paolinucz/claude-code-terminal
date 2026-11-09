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
    onChanged: (cb) => on('plugins:changed', cb),
    onProgress: (cb) => on('plugins:progress', cb)
  },  permissions: {
    read: (cwd) => ipcRenderer.invoke('permissions:read', cwd),
    save: (cwd, scope, data) => ipcRenderer.invoke('permissions:save', cwd, scope, data),
    onExternalChange: (cb) => on('permissions:external', cb)
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
  java: {
    state: (root, fresh) => ipcRenderer.invoke('java:state', root, fresh),
    setDefaultJdk: (id) => ipcRenderer.invoke('java:setDefaultJdk', id),
    setServiceJdk: (serviceRoot, id) => ipcRenderer.invoke('java:setServiceJdk', serviceRoot, id),
    downloadJdk: (major) => ipcRenderer.invoke('java:downloadJdk', major),
    removeJdk: (id) => ipcRenderer.invoke('java:removeJdk', id),
    saveConfig: (cfg) => ipcRenderer.invoke('java:saveConfig', cfg),
    deleteConfig: (id) => ipcRenderer.invoke('java:deleteConfig', id),
    importIdea: (root) => ipcRenderer.invoke('java:importIdea', root),
    run: (configId, workspace) => ipcRenderer.invoke('java:run', configId, workspace),
    debug: (configId, workspace) => ipcRenderer.invoke('java:debug', configId, workspace),
    debugState: () => ipcRenderer.invoke('java:debugState'),
    control: (action) => ipcRenderer.invoke('java:control', action),
    stop: () => ipcRenderer.invoke('java:stop'),
    restart: () => ipcRenderer.invoke('java:restart'),
    scopes: (frameId) => ipcRenderer.invoke('java:scopes', frameId),
    variables: (ref) => ipcRenderer.invoke('java:variables', ref),
    evaluate: (expression, frameId) => ipcRenderer.invoke('java:evaluate', expression, frameId),
    breakpoints: () => ipcRenderer.invoke('java:breakpoints'),
    setBreakpoints: (file, list) => ipcRenderer.invoke('java:setBreakpoints', file, list),
    onChanged: (cb) => on('java:changed', cb),
    onDebug: (cb) => on('java:debug', cb),
    onOutput: (cb) => on('java:output', cb),
    onProgress: (cb) => on('java:progress', cb)
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
    homeDir: () => ipcRenderer.invoke('env:homeDir'),
    pathStatus: (path) => ipcRenderer.invoke('env:pathStatus', path),
    createFolder: (path) => ipcRenderer.invoke('env:createFolder', path)
  }
}

contextBridge.exposeInMainWorld('api', api)
