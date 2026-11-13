import { create } from 'zustand'

/**
 * Messaggi brevi dell'app (layout salvato, file salvato, progetto aperto…). Prima comparivano in basso a destra nella barra
 * dei fogli; ora sono toast (`components/Toasts.tsx`) che spariscono da soli.
 */
export interface AppMessage {
  id: number
  text: string
}

interface MessagesStore {
  messages: AppMessage[]
  dismiss(id: number): void
}

const MAX_MESSAGES = 4
const DURATION_MS = 5000
let seq = 0

export const useMessages = create<MessagesStore>((set) => ({
  messages: [],
  dismiss: (id) => set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }))
}))

/** Mostra un messaggio; lo stesso testo di un messaggio ancora visibile non si ripete. */
export function pushMessage(text: string): void {
  const clean = text.trim()
  if (!clean) return
  const { messages } = useMessages.getState()
  if (messages.some((m) => m.text === clean)) return
  const id = ++seq
  useMessages.setState({ messages: [...messages, { id, text: clean.slice(0, 300) }].slice(-MAX_MESSAGES) })
  window.setTimeout(() => useMessages.getState().dismiss(id), DURATION_MS)
}
