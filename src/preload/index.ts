import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi } from '@shared/types'

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
  }
}

contextBridge.exposeInMainWorld('api', api)
