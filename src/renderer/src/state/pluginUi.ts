import { create } from 'zustand'

/**
 * Avvisi e dialoghi che i plugin chiedono all'app (docs/PLUGIN_API_DOCS.md §4). Li disegna l'app (`PluginUi`), con il suo
 * stile e sempre con il nome del plugin: una pagina non può far passare un suo messaggio per un messaggio dell'app.
 */
export type PluginNoticeKind = 'info' | 'ok' | 'warn' | 'error'

export interface PluginNotice {
  id: number
  pluginName: string
  message: string
  kind: PluginNoticeKind
}

export interface PluginDialogRequest {
  id: number
  type: 'confirm' | 'prompt'
  pluginName: string
  title: string
  message: string
  okLabel: string
  danger: boolean
  /** Solo `prompt`. */
  value: string
  placeholder: string
  resolve(result: boolean | string | null): void
}

interface Store {
  notices: PluginNotice[]
  dialogs: PluginDialogRequest[]
  dismissNotice(id: number): void
  settle(id: number, result: boolean | string | null): void
}

let seq = 1
const MAX_NOTICES = 5
const MAX_DIALOGS = 3

export const usePluginUi = create<Store>((set, get) => ({
  notices: [],
  dialogs: [],
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  settle(id, result) {
    const d = get().dialogs.find((x) => x.id === id)
    set((s) => ({ dialogs: s.dialogs.filter((x) => x.id !== id) }))
    d?.resolve(result)
  }
}))

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

export function pluginNotify(pluginName: string, message: unknown, kind: unknown): void {
  const text = clip(message, 500)
  if (!text) return
  const k: PluginNoticeKind = kind === 'ok' || kind === 'warn' || kind === 'error' ? kind : 'info'
  usePluginUi.setState((s) => ({ notices: [...s.notices, { id: seq++, pluginName, message: text, kind: k }].slice(-MAX_NOTICES) }))
}

function ask(pluginName: string, type: 'confirm' | 'prompt', p: Record<string, unknown>): Promise<boolean | string | null> {
  // Un plugin non può riempire lo schermo di finestre: oltre il limite la richiesta è rifiutata.
  if (usePluginUi.getState().dialogs.length >= MAX_DIALOGS) return Promise.resolve(type === 'confirm' ? false : null)
  return new Promise((resolve) => {
    const req: PluginDialogRequest = {
      id: seq++,
      type,
      pluginName,
      title: clip(p.title, 120) || (type === 'confirm' ? 'Conferma' : 'Inserisci un valore'),
      message: clip(p.message, 1000),
      okLabel: clip(p.okLabel, 40) || 'OK',
      danger: p.danger === true,
      value: clip(p.value, 500),
      placeholder: clip(p.placeholder, 120),
      resolve
    }
    usePluginUi.setState((s) => ({ dialogs: [...s.dialogs, req] }))
  })
}

/** `true` se l'utente conferma. */
export const pluginConfirm = (pluginName: string, p: Record<string, unknown>) => ask(pluginName, 'confirm', p) as Promise<boolean>
/** Il testo inserito, o `null` se annulla. */
export const pluginPrompt = (pluginName: string, p: Record<string, unknown>) => ask(pluginName, 'prompt', p) as Promise<string | null>
