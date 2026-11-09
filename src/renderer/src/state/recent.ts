import { create } from 'zustand'
import { normPath } from '@shared/files'
import { api } from '@/lib/api'

const KEY = 'ui.recentFiles'
export const RECENT_MAX = 40

interface RecentStore {
  /** Percorsi assoluti, dal più recente. */
  files: string[]
  loaded: boolean
  load(): Promise<void>
  push(path: string): void
}

/** File aperti di recente nell'editor (Ctrl+E): si ricordano tra un avvio e l'altro. */
export const useRecent = create<RecentStore>((set, get) => ({
  files: [],
  loaded: false,
  async load() {
    if (get().loaded) return
    const saved = await api.settings.get(KEY)
    const files = Array.isArray(saved) ? saved.filter((p): p is string => typeof p === 'string') : []
    // Quel che è stato aperto prima del caricamento resta in cima.
    const merged = [...get().files, ...files.filter((f) => !get().files.some((g) => normPath(g) === normPath(f)))]
    set({ loaded: true, files: merged.slice(0, RECENT_MAX) })
  },
  push(path) {
    const key = normPath(path)
    const files = [path, ...get().files.filter((f) => normPath(f) !== key)].slice(0, RECENT_MAX)
    set({ files })
    if (get().loaded) void api.settings.set(KEY, files)
  }
}))
