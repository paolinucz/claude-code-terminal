import { create } from 'zustand'
import { api } from '@/lib/api'
import { workdirForSheet } from '@/state/project'
import { useSessions } from '@/state/sessions'

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 640
const DEFAULT_WIDTH = 280
const KEY = 'ui.sidebar'

interface Saved {
  active: string | null
  width: number
  /** Cartella scelta a mano nell'Esplora file, per foglio. */
  cwdBySheet: Record<string, string>
}

interface SidebarStore extends Saved {
  loaded: boolean
  /** Cartella mostrata dall'Esplora file (serve a chi apre i file per sapere il progetto). */
  explorerCwd: string
  load(): Promise<void>
  /** Mostra una vista; se è già quella visibile, la barra si richiude (come in VS Code). */
  toggle(id: string): void
  show(id: string): void
  setWidth(width: number): void
  setSheetCwd(sheetId: string, cwd: string): void
  setExplorerCwd(cwd: string): void
  /** Ogni valore nuovo chiede alla vista «Cerca» di prendere il focus (e di usare il testo proposto). */
  searchFocus: { n: number; text: string }
  focusSearch(text?: string): void
}

const clampWidth = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)))

/** Barra laterale fissa (stile VS Code): barra delle icone a sinistra e pannello della vista scelta. */
export const useSidebar = create<SidebarStore>((set, get) => {
  const save = () => {
    const { active, width, cwdBySheet } = get()
    void api.settings.set(KEY, { active, width, cwdBySheet } satisfies Saved)
  }
  return {
    active: 'explorer',
    width: DEFAULT_WIDTH,
    cwdBySheet: {},
    loaded: false,
    explorerCwd: '',
    searchFocus: { n: 0, text: '' },
    focusSearch(text = '') {
      set({ active: 'search', searchFocus: { n: get().searchFocus.n + 1, text } })
      save()
    },
    async load() {
      if (get().loaded) return
      const s = (await api.settings.get(KEY)) as Partial<Saved> | null
      set({
        loaded: true,
        active: s && 'active' in s ? (s.active ?? null) : 'explorer',
        width: typeof s?.width === 'number' ? clampWidth(s.width) : DEFAULT_WIDTH,
        cwdBySheet: s?.cwdBySheet && typeof s.cwdBySheet === 'object' ? s.cwdBySheet : {}
      })
    },
    toggle(id) {
      set({ active: get().active === id ? null : id })
      save()
    },
    show(id) {
      if (get().active === id) return
      set({ active: id })
      save()
    },
    setWidth(width) {
      set({ width: clampWidth(width) })
      save()
    },
    setSheetCwd(sheetId, cwd) {
      set({ cwdBySheet: { ...get().cwdBySheet, [sheetId]: cwd } })
      save()
    },
    setExplorerCwd(cwd) {
      if (cwd !== get().explorerCwd) set({ explorerCwd: cwd })
    }
  }
})

/**
 * Cartella di progetto di un foglio, la stessa per Esplora file e Cerca: quella scelta a mano, poi quella del
 * contesto del progetto, poi l'ultima mostrata dall'Esplora file, poi la cartella di una sessione viva.
 */
export function rootForSheet(sheetId: string): string {
  const s = useSidebar.getState()
  const live = Object.values(useSessions.getState().sessions).find((x) => x.status !== 'exited')
  return s.cwdBySheet[sheetId] || workdirForSheet(sheetId) || s.explorerCwd || live?.cwd || ''
}
