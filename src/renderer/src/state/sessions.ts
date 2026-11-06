import { create } from 'zustand'
import type { SessionInfo } from '@shared/sessions'
import { api } from '@/lib/api'

interface SessionsStore {
  sessions: Record<string, SessionInfo>
  loaded: boolean
  init(): Promise<void>
}

let initialized = false

/** Elenco delle sessioni vive, aggiornato dal processo principale (S6: stato, W5: branch). */
export const useSessions = create<SessionsStore>((set) => ({
  sessions: {},
  loaded: false,
  async init() {
    if (initialized) return
    initialized = true
    const apply = (list: SessionInfo[]) => set({ sessions: Object.fromEntries(list.map((s) => [s.id, s])), loaded: true })
    api.sessions.onChanged(apply)
    apply(await api.sessions.list())
  }
}))

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
