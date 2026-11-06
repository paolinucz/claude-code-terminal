import { create } from 'zustand'
import type { FileChange } from '@shared/changes'
import { api } from '@/lib/api'

interface ChangesStore {
  changes: FileChange[]
  loaded: boolean
  init(): Promise<void>
}

let initialized = false

/** Modifiche di Claude ai file (F5), aggiornate dal processo principale a ogni Edit/Write e decisione. */
export const useChanges = create<ChangesStore>((set) => ({
  changes: [],
  loaded: false,
  async init() {
    if (initialized) return
    initialized = true
    api.changes.onChanged((changes) => set({ changes, loaded: true }))
    set({ changes: await api.changes.list(), loaded: true })
  }
}))

export const pendingCount = (changes: FileChange[]): number => changes.filter((c) => c.status === 'pending').length

export const CHANGE_STATUS_LABELS: Record<FileChange['status'], string> = {
  pending: 'da rivedere',
  revision: 'modifiche richieste · attende Claude',
  approved: 'approvata',
  rejected: 'rifiutata · ripristinata'
}

export const CHANGE_STATUS_COLORS: Record<FileChange['status'], string> = {
  pending: 'var(--cct-warn)',
  revision: 'var(--cct-info)',
  approved: 'var(--cct-ok)',
  rejected: 'var(--cct-danger)'
}

/** Nome del file e cartella relativa al progetto, per l'elenco. */
export function splitPath(change: FileChange): { name: string; dir: string } {
  const sep = change.filePath.includes('\\') ? '\\' : '/'
  let rel = change.filePath
  if (change.cwd && rel.toLowerCase().startsWith(change.cwd.toLowerCase())) rel = rel.slice(change.cwd.length).replace(/^[\\/]+/, '')
  const parts = rel.split(/[\\/]/)
  const name = parts.pop() ?? rel
  return { name, dir: parts.join(sep) }
}
