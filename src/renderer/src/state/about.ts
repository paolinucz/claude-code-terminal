import { create } from 'zustand'

/** Pagina «Informazioni su Magnolia»: si apre dalla palette (Ctrl+K) e dal menu Progetto. */
interface AboutStore {
  open: boolean
  show(): void
  hide(): void
}

export const useAbout = create<AboutStore>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false })
}))
