import { create } from 'zustand'
import type { DockviewApi } from 'dockview-react'
import { normPath, type FileDiagnostics, type JavaInstallProgress, type LspStatus } from '@shared/files'
import { api } from '@/lib/api'
import type { PanelParams } from '@/panels/kinds'
import { useSessions } from '@/state/sessions'
import { useWorkspace } from '@/state/workspace'
import { addPanel } from '@/workspace/panels'
import { dockRegistry } from '@/workspace/registry'

interface EditorStore {
  /** Diagnostica per file (percorso normalizzato), da tutti i language server (F3). */
  diagnostics: Record<string, FileDiagnostics>
  /** Stato dei language server (chiave linguaggio|radice). */
  servers: Record<string, LspStatus>
  javaProgress: JavaInstallProgress | null
  init(): void
}

let initialized = false

export const useEditor = create<EditorStore>((set, get) => ({
  diagnostics: {},
  servers: {},
  javaProgress: null,
  init() {
    if (initialized) return
    initialized = true
    api.lsp.onDiagnostics((d) => {
      const key = normPath(d.path)
      const next = { ...get().diagnostics }
      if (d.diagnostics.length) next[key] = d
      else delete next[key]
      set({ diagnostics: next })
    })
    api.lsp.onStatus((s) => set({ servers: { ...get().servers, [`${s.language}|${normPath(s.root)}`]: s } }))
    api.lsp.onJavaProgress((p) => set({ javaProgress: p }))
    void api.lsp.statuses().then((list) => set({ servers: Object.fromEntries(list.map((s) => [`${s.language}|${normPath(s.root)}`, s])) }))
  }
}))

/** Posizione a cui portare il cursore aprendo un file (righe e colonne da 1). */
export interface RevealPosition {
  line: number
  column: number
}

type Opener = (position?: RevealPosition) => void
/** Editor aperti: percorso normalizzato → funzione che porta il cursore in una posizione. */
const openEditors = new Map<string, Set<Opener>>()

export function registerEditor(path: string, reveal: Opener): () => void {
  const key = normPath(path)
  const set = openEditors.get(key) ?? new Set()
  set.add(reveal)
  openEditors.set(key, set)
  return () => {
    set.delete(reveal)
    if (!set.size) openEditors.delete(key)
  }
}

/** Posizioni in attesa per gli editor appena creati. */
const pendingReveal = new Map<string, RevealPosition>()
export function takePendingReveal(path: string): RevealPosition | undefined {
  const key = normPath(path)
  const p = pendingReveal.get(key)
  pendingReveal.delete(key)
  return p
}

/**
 * Apre un file nell'editor del foglio attivo (F2). Se è già aperto lo attiva; altrimenti apre un
 * pannello nuovo accanto agli altri editor (o al posto di un pannello Editor vuoto).
 */
export function openFile(path: string, position?: RevealPosition, workspace?: string): void {
  const sheetId = useWorkspace.getState().activeSheetId
  const dock = dockRegistry.get(sheetId)
  if (!dock) return
  const key = normPath(path)
  const existing = dock.panels.find((p) => {
    const params = p.params as PanelParams | undefined
    return params?.kind === 'editor' && params.filePath && normPath(params.filePath) === key
  })
  if (existing) {
    existing.api.setActive()
    if (position) openEditors.get(key)?.forEach((reveal) => reveal(position))
    return
  }
  if (position) pendingReveal.set(key, position)
  const name = path.split(/[\\/]/).pop() ?? path
  const ws = workspace ?? guessWorkspace(dock)
  const empty = dock.panels.find((p) => {
    const params = p.params as PanelParams | undefined
    return params?.kind === 'editor' && !params.filePath
  })
  if (empty) {
    empty.api.updateParameters({ kind: 'editor', filePath: path, cwd: ws } satisfies PanelParams)
    empty.api.setTitle(name)
    empty.api.setActive()
    return
  }
  const anotherEditor = dock.panels.find((p) => (p.params as PanelParams | undefined)?.kind === 'editor')
  addPanel(dock, 'editor', {
    title: name,
    params: { filePath: path, cwd: ws },
    position: anotherEditor ? { referencePanel: anotherEditor.id, direction: 'within' } : undefined
  })
}

/** Cartella di progetto di un foglio: quella dell'esplora file o del terminale attivo. */
export function guessWorkspace(dock: DockviewApi): string | undefined {
  for (const p of dock.panels) {
    const params = p.params as PanelParams | undefined
    if (params?.kind === 'explorer' && params.cwd) return params.cwd
  }
  const sessions = useSessions.getState().sessions
  const terminals = dock.panels.filter((p) => (p.params as PanelParams | undefined)?.kind === 'terminal')
  const active = terminals.find((p) => p.api.isActive) ?? terminals[0]
  const params = active?.params as PanelParams | undefined
  return (params?.sessionId && sessions[params.sessionId]?.cwd) || params?.hint?.cwd || undefined
}

export const SEVERITY_LABELS: Record<1 | 2 | 3 | 4, string> = { 1: 'errore', 2: 'avviso', 3: 'informazione', 4: 'suggerimento' }
