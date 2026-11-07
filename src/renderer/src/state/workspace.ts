import { create } from 'zustand'
import type { Sheet } from '@shared/types'
import { api } from '@/lib/api'

/** Fogli predefiniti (L1). L'id (fino ai due punti) decide anche il layout iniziale (vedi workspace/panels.ts). */
export const DEFAULT_SHEETS: Sheet[] = [
  { id: 'sviluppo', name: 'Sviluppo', contextId: null, layout: null },
  { id: 'revisione', name: 'Revisione', contextId: null, layout: null },
  { id: 'debug', name: 'Debug', contextId: null, layout: null }
]

const PRESETS = [
  { preset: 'sviluppo', name: 'Sviluppo' },
  { preset: 'revisione', name: 'Revisione' },
  { preset: 'debug', name: 'Debug' }
]

/** Fogli di un contesto (`null` = fogli senza progetto, come nella 1.0). */
export function sheetsOf(sheets: Sheet[], contextId: string | null): Sheet[] {
  return sheets.filter((s) => (s.contextId ?? null) === contextId)
}

interface WorkspaceStore {
  loaded: boolean
  /** Tutti i fogli di tutti i contesti: restano montati anche se non visibili, così le sessioni non si interrompono. */
  sheets: Sheet[]
  activeSheetId: string
  /** Contesto attivo (J5): le schede in basso mostrano solo i suoi fogli. */
  contextId: string | null
  /** Messaggio nella barra dei fogli (es. «Layout salvato»). */
  status: string
  /** Numero di pannelli per foglio, aggiornato da SheetView a ogni cambio di layout. */
  panelCounts: Record<string, number>
  load(): Promise<void>
  setActive(id: string): void
  /** Passa a un contesto: riapre il suo ultimo foglio e, se non ne ha, crea Sviluppo, Revisione e Debug. */
  setContext(contextId: string | null): void
  /** Il primo contesto di un progetto prende i fogli aperti finora (senza contesto) per non perdere il lavoro. */
  adoptLooseSheets(contextId: string): void
  /** Chiude i fogli di un contesto eliminato. */
  removeContextSheets(contextId: string): void
  addSheet(): string
  renameSheet(id: string, name: string): void
  closeSheet(id: string): void
  moveSheet(id: string, toIndex: number): void
  setStatus(message: string): void
  setPanelCount(sheetId: string, count: number): void
}

function persist(sheets: Sheet[], activeSheetId: string): void {
  void api.workspace.saveSheets(
    sheets.map(({ id, name, contextId }) => ({ id, name, contextId })),
    activeSheetId
  )
}

function nextSheetName(sheets: Sheet[]): string {
  const names = new Set(sheets.map((s) => s.name.toLowerCase()))
  let n = sheets.length + 1
  while (names.has(`foglio ${n}`)) n++
  return `Foglio ${n}`
}

/** Fogli iniziali di un contesto: stessi nomi e layout di quelli predefiniti, con id propri. */
function defaultSheetsFor(contextId: string | null, taken: Set<string>): Sheet[] {
  return PRESETS.map(({ preset, name }) => {
    const id = contextId === null && !taken.has(preset) ? preset : `${preset}:${crypto.randomUUID().slice(0, 8)}`
    return { id, name, contextId, layout: null }
  })
}

export const useWorkspace = create<WorkspaceStore>((set, get) => {
  /** Ultimo foglio attivo di ogni contesto (chiave `''` per nessun contesto). Solo in memoria. */
  const lastSheet = new Map<string, string>()

  return {
    loaded: false,
    sheets: [],
    activeSheetId: '',
    contextId: null,
    status: '',
    panelCounts: {},

    async load() {
      const state = await api.workspace.load()
      let sheets = state.sheets.map((s) => ({ ...s, contextId: s.contextId ?? null }))
      if (sheets.length === 0) sheets = DEFAULT_SHEETS
      // Il contesto attivo si decide dopo, quando il progetto è aperto: all'inizio vale «nessun contesto».
      const persisted = sheets.find((s) => s.id === state.activeSheetId)
      if (persisted?.contextId) lastSheet.set(persisted.contextId, persisted.id)
      if (sheetsOf(sheets, null).length === 0) {
        sheets = [...sheets, ...defaultSheetsFor(null, new Set(sheets.map((s) => s.id)))]
      }
      const loose = sheetsOf(sheets, null)
      const activeSheetId = persisted && !persisted.contextId ? persisted.id : loose[0].id
      persist(sheets, activeSheetId)
      set({ loaded: true, sheets, activeSheetId, contextId: null })
    },

    setActive(id) {
      const sheet = get().sheets.find((s) => s.id === id)
      if (sheet) lastSheet.set(sheet.contextId ?? '', id)
      set({ activeSheetId: id })
      persist(get().sheets, id)
    },

    setContext(contextId) {
      let sheets = get().sheets
      if (sheetsOf(sheets, contextId).length === 0) {
        sheets = [...sheets, ...defaultSheetsFor(contextId, new Set(sheets.map((s) => s.id)))]
      }
      const mine = sheetsOf(sheets, contextId)
      const remembered = lastSheet.get(contextId ?? '')
      const active = mine.find((s) => s.id === remembered) ?? mine[0]
      set({ sheets, contextId, activeSheetId: active.id })
      persist(sheets, active.id)
    },

    adoptLooseSheets(contextId) {
      const sheets = get().sheets.map((s) => (s.contextId ? s : { ...s, contextId }))
      const active = get().activeSheetId
      set({ sheets })
      persist(sheets, active)
    },

    removeContextSheets(contextId) {
      const sheets = get().sheets.filter((s) => s.contextId !== contextId)
      lastSheet.delete(contextId)
      set({ sheets })
      persist(sheets, get().activeSheetId)
    },

    addSheet() {
      const { contextId } = get()
      const sheet: Sheet = {
        id: crypto.randomUUID(),
        name: nextSheetName(sheetsOf(get().sheets, contextId)),
        contextId,
        layout: null
      }
      const sheets = [...get().sheets, sheet]
      lastSheet.set(contextId ?? '', sheet.id)
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
      const { sheets, activeSheetId, contextId } = get()
      const mine = sheetsOf(sheets, contextId)
      if (mine.length <= 1) return
      const index = mine.findIndex((s) => s.id === id)
      const rest = sheets.filter((s) => s.id !== id)
      const mineRest = mine.filter((s) => s.id !== id)
      const nextActive = activeSheetId === id ? mineRest[Math.max(0, index - 1)].id : activeSheetId
      lastSheet.set(contextId ?? '', nextActive)
      set({ sheets: rest, activeSheetId: nextActive })
      persist(rest, nextActive)
    },

    moveSheet(id, toIndex) {
      const { sheets, contextId } = get()
      const mine = [...sheetsOf(sheets, contextId)]
      const from = mine.findIndex((s) => s.id === id)
      if (from < 0) return
      const [item] = mine.splice(from, 1)
      mine.splice(Math.max(0, Math.min(toIndex, mine.length)), 0, item)
      const next = [...sheets.filter((s) => (s.contextId ?? null) !== contextId), ...mine]
      set({ sheets: next })
      persist(next, get().activeSheetId)
    },

    setStatus(message) {
      set({ status: message })
    },

    setPanelCount(sheetId, count) {
      if (get().panelCounts[sheetId] === count) return
      set({ panelCounts: { ...get().panelCounts, [sheetId]: count } })
    }
  }
})
