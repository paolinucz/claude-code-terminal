import { create } from 'zustand'

/** Panoramica degli spazi (Ctrl+Tab): overlay a tutto schermo con una card per spazio. */
interface OverviewStore {
  open: boolean
  show(): void
  hide(): void
  toggle(): void
}

export const useOverview = create<OverviewStore>((set, get) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set({ open: !get().open })
}))
