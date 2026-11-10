import { create } from 'zustand'

/**
 * Avanzamento dell'avvio dell'app, per la schermata iniziale (`components/Splash.tsx`). Ogni caricamento che serve per partire
 * (spazio di lavoro, sessioni, plugin…) si registra con `trackBoot`: la barra di avanzamento è la quota di quelli finiti.
 */
export interface BootStep {
  id: string
  label: string
  done: boolean
}

interface BootStore {
  steps: BootStep[]
  /** Tutti i caricamenti registrati sono finiti (e ce n'è almeno uno). */
  finished: boolean
  start(id: string, label: string): void
  finish(id: string): void
}

export const useBoot = create<BootStore>((set, get) => ({
  steps: [],
  finished: false,
  start: (id, label) => set((s) => ({ steps: [...s.steps.filter((x) => x.id !== id), { id, label, done: false }], finished: false })),
  finish: (id) => {
    const steps = get().steps.map((x) => (x.id === id ? { ...x, done: true } : x))
    set({ steps, finished: steps.length > 0 && steps.every((x) => x.done) })
  }
}))

/**
 * Registra un caricamento dell'avvio: la schermata iniziale resta finché tutti quelli registrati non sono finiti. Un
 * caricamento che fallisce conta come finito (l'app parte comunque e mostra l'errore a modo suo).
 */
export function trackBoot<T>(id: string, label: string, work: Promise<T> | T): Promise<T> {
  useBoot.getState().start(id, label)
  return Promise.resolve(work).finally(() => useBoot.getState().finish(id))
}
