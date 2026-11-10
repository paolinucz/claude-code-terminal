import { create } from 'zustand'
import { api } from '@/lib/api'

const KEY = 'ui.accent'
/** Ottanio: il blu-verde profondo del colore di base dell'app. */
export const DEFAULT_ACCENT = '#168294'

export const ACCENT_PRESETS = [
  { name: 'Ottanio', value: DEFAULT_ACCENT },
  { name: 'Arancio', value: '#e8875f' },
  { name: 'Rosso', value: '#f26d6d' },
  { name: 'Rosa', value: '#f472b6' },
  { name: 'Viola', value: '#a78bfa' },
  { name: 'Blu', value: '#5b9cf5' },
  { name: 'Azzurro', value: '#38bdf8' },
  { name: 'Verde', value: '#4cc38a' },
  { name: 'Giallo', value: '#e5b94e' }
] as const

const HEX = /^#[0-9a-f]{6}$/i

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

/** Applica il colore alle variabili CSS dell'app: tinta piena, tinta più chiara e testo leggibile sopra il colore. */
export function applyAccent(hex: string): void {
  const color = HEX.test(hex) ? hex : DEFAULT_ACCENT
  const [r, g, b] = rgb(color)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const root = document.documentElement.style
  root.setProperty('--cct-accent', color)
  root.setProperty('--cct-accent-soft', toHex([r + (255 - r) * 0.2, g + (255 - g) * 0.2, b + (255 - b) * 0.2]))
  root.setProperty('--cct-on-accent', luminance > 0.55 ? '#1a0f0a' : '#ffffff')
}

interface AccentStore {
  accent: string
  loaded: boolean
  dialog: boolean
  load(): Promise<void>
  /** Cambia il colore subito (anteprima) e lo salva. */
  set(hex: string): void
  openDialog(): void
  closeDialog(): void
}

export const useAccent = create<AccentStore>((set, get) => ({
  accent: DEFAULT_ACCENT,
  loaded: false,
  dialog: false,
  async load() {
    if (get().loaded) return
    set({ loaded: true })
    const saved = await api.settings.get(KEY)
    if (typeof saved === 'string' && HEX.test(saved)) {
      set({ accent: saved })
      applyAccent(saved)
    }
  },
  set(hex) {
    if (!HEX.test(hex)) return
    set({ accent: hex })
    applyAccent(hex)
    void api.settings.set(KEY, hex)
  },
  openDialog: () => set({ dialog: true }),
  closeDialog: () => set({ dialog: false })
}))
