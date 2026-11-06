import type { AppApi, NamedLayout, Sheet, WorkspaceState } from '@shared/types'

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
        const next: Sheet[] = sheets.map((s) => ({ id: s.id, name: s.name, layout: byId.get(s.id)?.layout ?? null }))
        write(KEY, { sheets: next, activeSheetId })
      },
      async saveSheetLayout(sheetId, layout) {
        const current = read<WorkspaceState>(KEY, { sheets: [], activeSheetId: null })
        write(KEY, { ...current, sheets: current.sheets.map((s) => (s.id === sheetId ? { ...s, layout } : s)) })
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
    }
  }
}

export const api: AppApi = window.api ?? createLocalStorageApi()
