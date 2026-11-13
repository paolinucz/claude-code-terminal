import { create } from 'zustand'
import { api } from '@/lib/api'

/** Schermo intero della finestra (F11): in quel caso i controlli nativi non ci sono e la barra in alto non riserva loro spazio. */
interface FullScreenStore {
  on: boolean
  init(): void
  toggle(): void
}

let started = false

export const useFullScreen = create<FullScreenStore>((set) => ({
  on: false,
  init() {
    if (started) return
    started = true
    void api.windows.isFullScreen().then((on) => set({ on }))
    api.windows.onFullScreen((on) => set({ on }))
  },
  toggle() {
    void api.windows.toggleFullScreen().then((on) => set({ on }))
  }
}))

/** Larghezza che la barra in alto lascia a destra per i controlli nativi (minimizza, ingrandisci, chiudi). */
export const windowControlsWidth = (fullScreen: boolean): number => (window.api && !fullScreen ? 140 : 0)
