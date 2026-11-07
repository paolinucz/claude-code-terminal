import { create } from 'zustand'
import type { AppInfo, UpdateStatus } from '@shared/updates'
import { api } from '@/lib/api'
import { useWorkspace } from './workspace'

interface UpdatesStore {
  info: AppInfo | null
  status: UpdateStatus
  init(): void
  /** Controllo manuale: il risultato va nella barra di stato. */
  check(): Promise<void>
}

let started = false

/** Versione dell'app e stato degli aggiornamenti automatici (fase 8). */
export const useUpdates = create<UpdatesStore>((set) => ({
  info: null,
  status: { state: 'idle' },
  init() {
    if (started) return
    started = true
    void api.updates.info().then((info) => set({ info }))
    void api.updates.status().then((status) => set({ status }))
    api.updates.onStatus((status) => set({ status }))
  },
  async check() {
    const setStatus = useWorkspace.getState().setStatus
    setStatus('Controllo degli aggiornamenti…')
    const s = await api.updates.check()
    set({ status: s })
    setStatus(describeUpdate(s))
  }
}))

/** Frase per la barra di stato. */
export function describeUpdate(s: UpdateStatus): string {
  switch (s.state) {
    case 'disabled':
      return s.reason
    case 'idle':
    case 'checking':
      return 'Controllo degli aggiornamenti…'
    case 'none':
      return 'Hai già l\'ultima versione'
    case 'downloading':
      return `Scarico la versione ${s.version}… ${s.percent}%`
    case 'ready':
      return `Versione ${s.version} pronta: si installa alla chiusura, o subito con «Riavvia e aggiorna»`
    case 'error':
      return `Aggiornamenti: ${s.message}`
  }
}
