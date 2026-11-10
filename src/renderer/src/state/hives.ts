import { create } from 'zustand'

/**
 * Gruppi di terminali mostrati insieme nella vista «alveare» (`HivePanel`). Li apre un plugin con `terminal.hive` (pagine) o
 * `app.terminal.hive` (adapter): la chiave è stabile, così richiamarlo di nuovo aggiorna lo stesso pannello con l'elenco nuovo.
 */
export interface Hive {
  key: string
  title: string
  sessionIds: string[]
  pluginId?: string
}

interface HiveStore {
  hives: Record<string, Hive>
  set(hive: Hive): void
  remove(key: string): void
}

export const useHives = create<HiveStore>((set) => ({
  hives: {},
  set: (hive) => set((s) => ({ hives: { ...s.hives, [hive.key]: hive } })),
  remove: (key) =>
    set((s) => {
      const { [key]: _gone, ...rest } = s.hives
      return { hives: rest }
    })
}))

/**
 * Quante colonne e righe servono per `n` celle in un riquadro `w` × `h` px: si sceglie la griglia le cui celle hanno più o
 * meno la forma di un terminale (circa 1,8 di larghezza per 1 di altezza), senza lasciare troppe celle vuote.
 */
export function gridFor(n: number, w: number, h: number): { cols: number; rows: number } {
  if (n <= 1 || w <= 0 || h <= 0) return { cols: 1, rows: Math.max(1, n) }
  let best = { cols: 1, rows: n }
  let bestScore = Infinity
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const aspect = w / cols / (h / rows)
    const score = Math.abs(Math.log(aspect / 1.8)) + (cols * rows - n) * 0.25
    if (score < bestScore) {
      bestScore = score
      best = { cols, rows }
    }
  }
  return best
}
