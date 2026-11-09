import { create } from 'zustand'
import type { DockviewApi } from 'dockview-react'
import { normPath, type Diagnostic, type LspStatus } from '@shared/files'
import type { InstalledPlugin, PluginInstallProgress, PluginLanguageInfo } from '@shared/plugins'
import { api } from '@/lib/api'
import type { PanelParams } from '@/panels/kinds'
import { useSessions } from '@/state/sessions'
import { useRecent } from '@/state/recent'
import { useSidebar } from '@/state/sidebar'
import { useWorkspace } from '@/state/workspace'
import { addPanel } from '@/workspace/panels'
import { dockRegistry } from '@/workspace/registry'

/** Diagnostica di un file, unita da tutti i server che lo gestiscono. */
export interface MergedDiagnostics {
  path: string
  diagnostics: Diagnostic[]
}

interface EditorStore {
  /** Diagnostica per file (percorso normalizzato), da tutti i language server (F3). */
  diagnostics: Record<string, MergedDiagnostics>
  /** Stato dei language server (per chiave del server). */
  servers: Record<string, LspStatus>
  /** Plugin installati e linguaggi che rendono disponibili (X8). */
  plugins: InstalledPlugin[]
  languages: PluginLanguageInfo[]
  installProgress: PluginInstallProgress | null
  init(): void
}

let initialized = false
/** Diagnostica separata per server: file → server → elenco. */
const perServer = new Map<string, { path: string; byServer: Map<string, Diagnostic[]> }>()

export const useEditor = create<EditorStore>((set, get) => ({
  diagnostics: {},
  servers: {},
  plugins: [],
  languages: [],
  installProgress: null,
  init() {
    if (initialized) return
    initialized = true
    api.lsp.onDiagnostics((d) => {
      const key = normPath(d.path)
      const entry = perServer.get(key) ?? { path: d.path, byServer: new Map() }
      if (d.diagnostics.length) entry.byServer.set(d.server, d.diagnostics)
      else entry.byServer.delete(d.server)
      const next = { ...get().diagnostics }
      if (entry.byServer.size) {
        perServer.set(key, entry)
        next[key] = { path: entry.path, diagnostics: [...entry.byServer.values()].flat() }
      } else {
        perServer.delete(key)
        delete next[key]
      }
      set({ diagnostics: next })
    })
    api.lsp.onStatus((s) => set({ servers: { ...get().servers, [s.key]: s } }))
    api.plugins.onChanged((plugins, languages) => set({ plugins, languages }))
    api.plugins.onProgress((p) => set({ installProgress: p }))
    void api.lsp.statuses().then((list) => set({ servers: Object.fromEntries(list.map((s) => [s.key, s])) }))
    void Promise.all([api.plugins.list(), api.plugins.languages()]).then(([plugins, languages]) => set({ plugins, languages }))
  }
}))

/** Linguaggio di un file secondo i plugin attivi: prima i nomi esatti (pom.xml), poi le estensioni. */
export function pluginLanguageOf(path: string, languages: PluginLanguageInfo[]): PluginLanguageInfo | null {
  const name = (path.split(/[\\/]/).pop() ?? path).toLowerCase()
  return languages.find((l) => l.filenames.includes(name)) ?? languages.find((l) => l.extensions.some((e) => name.endsWith(e))) ?? null
}

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
 * pannello nuovo accanto agli altri editor (o al posto di un pannello Editor vuoto); il primo file
 * del foglio apre un gruppo Editor a destra dell'Esplora file.
 */
export function openFile(path: string, position?: RevealPosition, workspace?: string): void {
  const sheetId = useWorkspace.getState().activeSheetId
  const dock = dockRegistry.get(sheetId)
  if (!dock) return
  useRecent.getState().push(path)
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
  if (anotherEditor) {
    addPanel(dock, 'editor', { title: name, params: { filePath: path, cwd: ws }, position: { referencePanel: anotherEditor.id, direction: 'within' } })
    return
  }
  // Primo file del foglio: l'editor ha un gruppo tutto suo, a destra del pannello attivo (l'Esplora file
  // sta nella barra laterale fissa). Senza posizione Dockview lo metterebbe come scheda nel gruppo attivo.
  const reference = dock.activePanel
  // Dockview ridistribuisce la larghezza fra tutte le colonne: si ricordano quelle di prima, così le
  // colonne laterali (Esplora, Widget…) restano com'erano e l'editor divide lo spazio della più larga.
  const before = dock.groups.map((g) => ({ group: g, width: g.api.width }))
  const widest = before.reduce<(typeof before)[number] | undefined>((a, b) => (!a || b.width > a.width ? b : a), undefined)
  const id = addPanel(dock, 'editor', {
    title: name,
    params: { filePath: path, cwd: ws },
    position: reference ? { referencePanel: reference.id, direction: 'right' } : undefined
  })
  if (!reference || !widest || widest.width <= 0) return
  dock.getPanel(id)?.group.api.setSize({ width: Math.round(widest.width / 2) })
  for (const b of before) if (b.width > 0 && b.width < widest.width) b.group.api.setSize({ width: b.width })
}

/** X8/X9: apre (o attiva) il pannello dei plugin nel foglio attivo. */
export function openPluginsPanel(): void {
  const dock = dockRegistry.get(useWorkspace.getState().activeSheetId)
  if (!dock) return
  const existing = dock.panels.find((p) => (p.params as PanelParams | undefined)?.kind === 'plugins')
  if (existing) existing.api.setActive()
  else addPanel(dock, 'plugins')
}

/** Cartella di progetto di un foglio: quella dell'Esplora file (barra laterale) o del terminale attivo. */
export function guessWorkspace(dock: DockviewApi): string | undefined {
  const sessions = useSessions.getState().sessions
  const terminals = dock.panels.filter((p) => (p.params as PanelParams | undefined)?.kind === 'terminal')
  const active = terminals.find((p) => p.api.isActive) ?? terminals[0]
  const params = active?.params as PanelParams | undefined
  return (params?.sessionId && sessions[params.sessionId]?.cwd) || params?.hint?.cwd || useSidebar.getState().explorerCwd || undefined
}

export const SEVERITY_LABELS: Record<1 | 2 | 3 | 4, string> = { 1: 'errore', 2: 'avviso', 3: 'informazione', 4: 'suggerimento' }
