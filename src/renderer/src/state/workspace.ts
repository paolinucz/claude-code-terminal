import { create } from 'zustand'
import type { Sheet } from '@shared/types'
import { api } from '@/lib/api'

/** Fogli predefiniti (L1). L'id decide anche il layout iniziale (vedi workspace/defaultLayouts.ts). */
export const DEFAULT_SHEETS: Sheet[] = [
  { id: 'sviluppo', name: 'Sviluppo', layout: null },
  { id: 'revisione', name: 'Revisione', layout: null },
  { id: 'debug', name: 'Debug', layout: null }
]

interface WorkspaceStore {
  loaded: boolean
  sheets: Sheet[]
  activeSheetId: string
  /** Messaggio nella barra dei fogli (es. «Layout salvato»). */
  status: string
  /** Numero di pannelli per foglio, aggiornato da SheetView a ogni cambio di layout. */
  panelCounts: Record<string, number>
  load(): Promise<void>
  setActive(id: string): void
  addSheet(): string
  renameSheet(id: string, name: string): void
  closeSheet(id: string): void
  moveSheet(id: string, toIndex: number): void
  setStatus(message: string): void
  setPanelCount(sheetId: string, count: number): void
}

function persist(sheets: Sheet[], activeSheetId: string): void {
  void api.workspace.saveSheets(
    sheets.map(({ id, name }) => ({ id, name })),
    activeSheetId
  )
}

function nextSheetName(sheets: Sheet[]): string {
  const names = new Set(sheets.map((s) => s.name.toLowerCase()))
  let n = sheets.length + 1
  while (names.has(`foglio ${n}`)) n++
  return `Foglio ${n}`
}

export const useWorkspace = create<WorkspaceStore>((set, get) => ({
  loaded: false,
  sheets: [],
  activeSheetId: '',
  status: '',
  panelCounts: {},

  async load() {
    const state = await api.workspace.load()
    let sheets = state.sheets
    if (sheets.length === 0) {
      sheets = DEFAULT_SHEETS
      persist(sheets, sheets[0].id)
    }
    const activeSheetId =
      state.activeSheetId && sheets.some((s) => s.id === state.activeSheetId) ? state.activeSheetId : sheets[0].id
    set({ loaded: true, sheets, activeSheetId })
  },

  setActive(id) {
    set({ activeSheetId: id })
    persist(get().sheets, id)
  },

  addSheet() {
    const sheet: Sheet = { id: crypto.randomUUID(), name: nextSheetName(get().sheets), layout: null }
    const sheets = [...get().sheets, sheet]
    set({ sheets, activeSheetId: sheet.id })
    persist(sheets, sheet.id)
    return sheet.id
  },

  renameSheet(id, name) {
    const clean = name.trim()
    if (!clean) return
    const sheets = get().sheets.map((s) => (s.id === id ? { ...s, name: clean } : s))
    set({ sheets })
    persist(sheets, get().activeSheetId)
  },

  closeSheet(id) {
    const { sheets, activeSheetId } = get()
    if (sheets.length <= 1) return
    const index = sheets.findIndex((s) => s.id === id)
    const rest = sheets.filter((s) => s.id !== id)
    const nextActive = activeSheetId === id ? rest[Math.max(0, index - 1)].id : activeSheetId
    set({ sheets: rest, activeSheetId: nextActive })
    persist(rest, nextActive)
  },

  moveSheet(id, toIndex) {
    const sheets = [...get().sheets]
    const from = sheets.findIndex((s) => s.id === id)
    if (from < 0) return
    const [item] = sheets.splice(from, 1)
    sheets.splice(Math.max(0, Math.min(toIndex, sheets.length)), 0, item)
    set({ sheets })
    persist(sheets, get().activeSheetId)
  },

  setStatus(message) {
    set({ status: message })
  },

  setPanelCount(sheetId, count) {
    if (get().panelCounts[sheetId] === count) return
    set({ panelCounts: { ...get().panelCounts, [sheetId]: count } })
  }
}))
