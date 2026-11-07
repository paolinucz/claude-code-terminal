import { create } from 'zustand'
import { api } from '@/lib/api'

const ENTER_KEY = 'bridge.enterSends'
const HISTORY_MAX = 50
const historyKey = (cwd: string) => `bridge.history.${cwd.toLowerCase()}`

interface PromptStore {
  /** Bozze non ancora inviate, per vista del terminale (B4, B7): si conservano anche se il pannello si sposta. */
  drafts: Record<string, string>
  /** Invio manda il messaggio (e Maiusc+Invio va a capo); se falso, invia Ctrl+Invio. */
  enterSends: boolean
  loaded: boolean
  load(): Promise<void>
  setDraft(viewKey: string, text: string): void
  setEnterSends(value: boolean): void
}

export const usePrompt = create<PromptStore>((set, get) => ({
  drafts: {},
  enterSends: true,
  loaded: false,
  async load() {
    if (get().loaded) return
    set({ loaded: true })
    const v = await api.settings.get(ENTER_KEY)
    if (typeof v === 'boolean') set({ enterSends: v })
  },
  setDraft(viewKey, text) {
    set((s) => ({ drafts: { ...s.drafts, [viewKey]: text } }))
  },
  setEnterSends(value) {
    set({ enterSends: value })
    void api.settings.set(ENTER_KEY, value)
  }
}))

/** Messaggi inviati in un progetto, dal più recente (B4). */
export async function loadHistory(cwd: string): Promise<string[]> {
  const v = await api.settings.get(historyKey(cwd))
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** Aggiunge un messaggio alla cronologia del progetto, senza doppioni consecutivi. */
export async function pushHistory(cwd: string, text: string): Promise<string[]> {
  const list = await loadHistory(cwd)
  const next = [text, ...list.filter((x) => x !== text)].slice(0, HISTORY_MAX)
  await api.settings.set(historyKey(cwd), next)
  return next
}

/** Comandi di Claude Code più usati, per l'elenco che si apre scrivendo «/» (B5). Claude accetta anche gli altri. */
export const SLASH_COMMANDS: { name: string; hint: string }[] = [
  { name: 'clear', hint: 'Nuova conversazione' },
  { name: 'compact', hint: 'Riassume la conversazione per liberare contesto' },
  { name: 'context', hint: 'Mostra l’uso del contesto' },
  { name: 'cost', hint: 'Costo della sessione' },
  { name: 'doctor', hint: 'Diagnosi dell’installazione' },
  { name: 'help', hint: 'Aiuto' },
  { name: 'init', hint: 'Crea il CLAUDE.md del progetto' },
  { name: 'memory', hint: 'Modifica i file di memoria' },
  { name: 'model', hint: 'Cambia modello' },
  { name: 'permissions', hint: 'Regole dei permessi' },
  { name: 'resume', hint: 'Riprende una conversazione' },
  { name: 'review', hint: 'Revisione del codice' },
  { name: 'rewind', hint: 'Torna a un punto precedente' },
  { name: 'status', hint: 'Stato della sessione' }
]
