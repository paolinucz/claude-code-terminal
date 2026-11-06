import { create } from 'zustand'
import { api } from '@/lib/api'

export const TERMINAL_FONT_FAMILY = '"JetBrains Mono Variable", "JetBrains Mono", "Cascadia Mono", Consolas, monospace'
export const DEFAULT_FONT_SIZE = 14
export const MIN_FONT_SIZE = 9
export const MAX_FONT_SIZE = 32

interface TerminalSettings {
  fontSize: number
  loaded: boolean
  load(): Promise<void>
  setFontSize(size: number): void
  bigger(): void
  smaller(): void
  reset(): void
}

const KEY = 'terminal.fontSize'
let saveTimer: number | undefined

/** Dimensione del carattere dei terminali: vale per tutti i terminali e resta tra un avvio e l'altro. */
export const useTerminalSettings = create<TerminalSettings>((set, get) => ({
  fontSize: DEFAULT_FONT_SIZE,
  loaded: false,
  async load() {
    if (get().loaded) return
    const saved = await api.settings.get(KEY)
    set({ loaded: true, fontSize: typeof saved === 'number' ? clamp(saved) : DEFAULT_FONT_SIZE })
  },
  setFontSize(size) {
    const fontSize = clamp(size)
    if (fontSize === get().fontSize) return
    set({ fontSize })
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => void api.settings.set(KEY, fontSize), 300)
  },
  bigger() {
    get().setFontSize(get().fontSize + 1)
  },
  smaller() {
    get().setFontSize(get().fontSize - 1)
  },
  reset() {
    get().setFontSize(DEFAULT_FONT_SIZE)
  }
}))

function clamp(n: number): number {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(n)))
}
