import { create } from 'zustand'
import { api } from '@/lib/api'

/**
 * Ogni foglio ha il suo colore, mostrato nella barra dei fogli in basso. I fogli predefiniti hanno tinte fisse (Sviluppo
 * ottanio, Revisione viola, Debug ambra); gli altri prendono il primo colore ancora libero e lo tengono. Si può cambiare dal
 * menu del tasto destro sulla scheda del foglio. La scelta sta nelle impostazioni dell'app (`ui.sheetColors`), non nel `.cctproj`.
 */
export const SHEET_COLORS = ['#168294', '#6d5bd0', '#d9822b', '#3c9d5b', '#c44f7a', '#4a78d6', '#b85c38', '#8a6f2d'] as const

const KEY = 'ui.sheetColors'
const KNOWN: Record<string, number> = { sviluppo: 0, revisione: 1, debug: 2 }

/** Parte dell'id che decide il foglio predefinito: i fogli dei contesti si chiamano «sviluppo:1a2b3c4d». */
const baseOf = (sheetId: string) => sheetId.split(':')[0]

function hashIndex(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % SHEET_COLORS.length
}

interface SheetColorStore {
  /** Indice del colore per foglio (solo quelli già assegnati o scelti). */
  colors: Record<string, number>
  loaded: boolean
  load(): Promise<void>
  /** Dà un colore ai fogli che non ne hanno ancora uno e lo salva. */
  ensure(sheetIds: string[]): void
  set(sheetId: string, index: number): void
}

export const useSheetColors = create<SheetColorStore>((set, get) => {
  const save = () => void api.settings.set(KEY, get().colors)
  return {
    colors: {},
    loaded: false,
    async load() {
      if (get().loaded) return
      const saved = (await api.settings.get(KEY)) as Record<string, number> | null
      set({ loaded: true, colors: saved && typeof saved === 'object' ? saved : {} })
    },
    ensure(sheetIds) {
      const colors = { ...get().colors }
      const used = new Set<number>(sheetIds.map((id) => colors[id] ?? KNOWN[baseOf(id)]).filter((x): x is number => x !== undefined))
      let changed = false
      for (const id of sheetIds) {
        if (colors[id] !== undefined) continue
        const known = KNOWN[baseOf(id)]
        let index = known
        if (index === undefined) {
          // Primo colore libero; se sono finiti tutti, uno qualsiasi in modo stabile.
          index = SHEET_COLORS.findIndex((_, i) => !used.has(i))
          if (index < 0) index = hashIndex(id)
        }
        colors[id] = index
        used.add(index)
        changed = true
      }
      if (changed) {
        set({ colors })
        save()
      }
    },
    set(sheetId, index) {
      if (!Number.isInteger(index) || index < 0 || index >= SHEET_COLORS.length) return
      set({ colors: { ...get().colors, [sheetId]: index } })
      save()
    }
  }
})

/** Colore di un foglio (anche prima che sia stato assegnato). */
export function sheetColor(sheetId: string, colors: Record<string, number>): string {
  const i = colors[sheetId] ?? KNOWN[baseOf(sheetId)] ?? hashIndex(sheetId)
  return SHEET_COLORS[i] ?? SHEET_COLORS[0]
}
