import { create } from 'zustand'
import { api } from '@/lib/api'

const KEY = 'explain.enabled'

interface ExplainSettings {
  /** Interruttore dell'output smart (O8): spento, nel pannello Modifiche non compare «Spiegazione». */
  enabled: boolean
  loaded: boolean
  load(): Promise<void>
  setEnabled(value: boolean): void
}

export const useExplainSettings = create<ExplainSettings>((set, get) => ({
  enabled: true,
  loaded: false,
  async load() {
    if (get().loaded) return
    set({ loaded: true })
    const v = await api.settings.get(KEY)
    if (typeof v === 'boolean') set({ enabled: v })
  },
  setEnabled(value) {
    set({ enabled: value })
    void api.settings.set(KEY, value)
  }
}))
