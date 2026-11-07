import { create } from 'zustand'
import { DEFAULT_PRESETS, PRESET_LIMITS, sanitizePresets, type PromptPreset } from '@shared/prompts'
import { api } from '@/lib/api'

const KEY = 'prompts.presets'

interface PresetsStore {
  presets: PromptPreset[]
  loaded: boolean
  /** Finestra di gestione: aperta o no, con un testo di partenza (per «Salva come predefinito»). */
  dialog: { open: boolean; draft?: string }
  load(): Promise<void>
  /** Aggiunge o aggiorna (se `id` esiste già). Restituisce l'errore, se c'è. */
  save(preset: Omit<PromptPreset, 'id'> & { id?: string }): Promise<string | null>
  remove(id: string): Promise<void>
  restoreDefaults(): Promise<void>
  openDialog(draft?: string): void
  closeDialog(): void
}

export const usePresets = create<PresetsStore>((set, get) => {
  const persist = async (presets: PromptPreset[]) => {
    set({ presets })
    await api.settings.set(KEY, presets)
  }
  return {
    presets: [],
    loaded: false,
    dialog: { open: false },
    async load() {
      if (get().loaded) return
      set({ loaded: true })
      // Mai impostati: si propongono gli esempi. Se l'utente li svuota, restano vuoti (lista vuota ≠ mai impostata).
      const saved = sanitizePresets(await api.settings.get(KEY))
      set({ presets: saved ?? DEFAULT_PRESETS })
    },
    async save(p) {
      const name = p.name.trim()
      const text = p.text.trim()
      if (!name) return 'Dai un nome al prompt'
      if (!text) return 'Scrivi il testo del prompt'
      if (text.length > PRESET_LIMITS.text) return `Il testo è troppo lungo (massimo ${PRESET_LIMITS.text} caratteri)`
      const list = get().presets
      if (list.some((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) return 'Esiste già un prompt con questo nome'
      if (!p.id && list.length >= PRESET_LIMITS.count) return `Hai già ${PRESET_LIMITS.count} prompt: toglierne qualcuno`
      const next = p.id
        ? list.map((x) => (x.id === p.id ? { id: x.id, name, text } : x))
        : [...list, { id: crypto.randomUUID(), name, text }]
      await persist(next)
      return null
    },
    async remove(id) {
      await persist(get().presets.filter((x) => x.id !== id))
    },
    async restoreDefaults() {
      const have = new Set(get().presets.map((x) => x.name.toLowerCase()))
      await persist([...get().presets, ...DEFAULT_PRESETS.filter((d) => !have.has(d.name.toLowerCase()))])
    },
    openDialog(draft) {
      set({ dialog: { open: true, draft } })
    },
    closeDialog() {
      set({ dialog: { open: false } })
    }
  }
})
