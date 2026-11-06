import { create } from 'zustand'
import type { IDockviewPanel } from 'dockview-react'
import type { SessionAttention, SessionInfo } from '@shared/sessions'
import { api } from '@/lib/api'
import type { PanelParams } from '@/panels/kinds'
import { useWorkspace } from '@/state/workspace'
import { dockRegistry } from '@/workspace/registry'

export interface Toast extends SessionAttention {
  id: number
}

interface SessionsStore {
  sessions: Record<string, SessionInfo>
  loaded: boolean
  /** S7: sessioni che chiedono attenzione e che l'utente non ha ancora guardato. */
  attention: Record<string, SessionAttention>
  toasts: Toast[]
  init(): Promise<void>
  /** L'utente ha guardato la sessione: si toglie il segnale di attenzione. */
  seen(sessionId: string): void
  dismissToast(id: number): void
}

let initialized = false
let toastId = 0

/** Elenco delle sessioni vive, aggiornato dal processo principale (S6: stato, W5: branch e contesto). */
export const useSessions = create<SessionsStore>((set, get) => ({
  sessions: {},
  loaded: false,
  attention: {},
  toasts: [],
  async init() {
    if (initialized) return
    initialized = true
    const apply = (list: SessionInfo[]) => {
      const sessions = Object.fromEntries(list.map((s) => [s.id, s]))
      // Le sessioni chiuse non chiedono più attenzione.
      const attention = Object.fromEntries(Object.entries(get().attention).filter(([id]) => sessions[id]))
      set({ sessions, attention, loaded: true })
    }
    api.sessions.onChanged(apply)
    api.sessions.onAttention((a) => {
      if (isVisible(a.sessionId)) return
      set({
        attention: { ...get().attention, [a.sessionId]: a },
        toasts: [...get().toasts.filter((t) => t.sessionId !== a.sessionId), { ...a, id: ++toastId }].slice(-4)
      })
    })
    api.sessions.onReveal((id) => revealSession(id))
    apply(await api.sessions.list())
  },
  seen(sessionId) {
    if (!get().attention[sessionId] && !get().toasts.some((t) => t.sessionId === sessionId)) return
    const { [sessionId]: _, ...rest } = get().attention
    set({ attention: rest, toasts: get().toasts.filter((t) => t.sessionId !== sessionId) })
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  }
}))

/** Pannelli (con il loro foglio) che mostrano una sessione. */
function viewsOf(sessionId: string): { sheetId: string; panel: IDockviewPanel }[] {
  const out: { sheetId: string; panel: IDockviewPanel }[] = []
  for (const sheet of useWorkspace.getState().sheets) {
    const dock = dockRegistry.get(sheet.id)
    for (const panel of dock?.panels ?? []) {
      if ((panel.params as PanelParams | undefined)?.sessionId === sessionId) out.push({ sheetId: sheet.id, panel })
    }
  }
  return out
}

/** La sessione è già sotto gli occhi dell'utente: finestra in primo piano, foglio attivo, scheda visibile. */
function isVisible(sessionId: string): boolean {
  if (!document.hasFocus()) return false
  const active = useWorkspace.getState().activeSheetId
  return viewsOf(sessionId).some((v) => v.sheetId === active && v.panel.api.isVisible)
}

/** Porta in vista una sessione: passa al suo foglio e attiva la scheda (clic su notifica o toast). */
export function revealSession(sessionId: string): void {
  const views = viewsOf(sessionId)
  const active = useWorkspace.getState().activeSheetId
  const target = views.find((v) => v.sheetId === active) ?? views[0]
  if (target) {
    if (target.sheetId !== active) useWorkspace.getState().setActive(target.sheetId)
    target.panel.api.setActive()
  } else {
    useWorkspace.getState().setStatus('La sessione non ha viste aperte: collegala da «Nuovo terminale › Collega a sessione attiva»')
  }
  useSessions.getState().seen(sessionId)
}

export function sessionList(map: Record<string, SessionInfo>): SessionInfo[] {
  return Object.values(map).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

/** Colore del pallino di stato (S6), come nel mockup. */
export const STATUS_COLORS: Record<SessionInfo['status'], string> = {
  working: 'var(--cct-warn)',
  waiting: 'var(--cct-info)',
  idle: 'var(--cct-text-faint)',
  exited: 'var(--cct-danger)'
}

export const STATUS_LABELS: Record<SessionInfo['status'], string> = {
  working: 'al lavoro',
  waiting: 'in attesa di input',
  idle: 'inattiva',
  exited: 'terminata'
}

export const ATTENTION_LABELS: Record<SessionAttention['kind'], string> = {
  finished: 'ha finito',
  permission: 'chiede un permesso',
  input: 'aspetta una risposta',
  error: 'si è fermata'
}
