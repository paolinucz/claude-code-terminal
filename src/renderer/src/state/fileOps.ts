import { create } from 'zustand'
import type { DockviewPanelApi } from 'dockview-react'
import { normPath } from '@shared/files'
import type { ApiFileEdit } from '@shared/pluginApi'
import { isInside, renamedPath, validateName } from '@shared/textEdits'
import type { MoveItem, MovePrepareResult } from '@shared/types'
import { api } from '@/lib/api'
import type { PanelParams } from '@/panels/kinds'
import { pluginNotify } from '@/state/pluginUi'
import { dockRegistry } from '@/workspace/registry'

/**
 * Spostare, rinominare e copiare file e cartelle (Esplora file e pagine dei plugin, come la vista Package di Java): un'unica
 * sequenza per tutti. Controlla i file aperti con modifiche non salvate, chiede ai plugin il refactoring (package, import…),
 * mostra cosa cambierà, esegue e porta gli editor aperti sul nuovo percorso.
 */

export type FileOpsDialog =
  | { kind: 'rename'; path: string; root: string; dir: boolean }
  | { kind: 'move'; paths: string[]; root: string; copy: boolean }
  | { kind: 'confirm'; root: string; items: MoveItem[]; copy: boolean; prepared: MovePrepareResult; resolve(choice: 'apply' | 'plain' | null): void }

interface Store {
  dialog: FileOpsDialog | null
  close(): void
}

export const useFileOps = create<Store>((set) => ({
  dialog: null,
  close: () => set({ dialog: null })
}))

const SEP = '\\'
export const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
export const parentOf = (p: string): string => p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '')
export const joinPath = (dir: string, name: string): string => dir.replace(/[\\/]+$/, '') + SEP + name

/** Percorso relativo alla cartella del progetto (con `/`), per «Copia percorso relativo». */
export function relativeTo(root: string, path: string): string {
  const r = root.replace(/[\\/]+$/, '')
  return (isInside(path, r) ? path.slice(r.length) : path).replace(/^[\\/]+/, '').replace(/\\/g, '/')
}

export const notify = (message: string, kind: 'info' | 'ok' | 'warn' | 'error' = 'info') => pluginNotify('Magnolia', message, kind)

/** Pannelli editor aperti in tutti i fogli. */
function editorPanels(): { api: DockviewPanelApi; params: PanelParams; filePath: string; dirty: boolean }[] {
  const out: { api: DockviewPanelApi; params: PanelParams; filePath: string; dirty: boolean }[] = []
  for (const dock of dockRegistry.all()) {
    for (const p of dock.panels) {
      const params = p.params as PanelParams | undefined
      if (params?.kind !== 'editor' || !params.filePath) continue
      out.push({ api: p.api, params, filePath: params.filePath, dirty: p.api.title?.startsWith('● ') ?? false })
    }
  }
  return out
}

/** File aperti con modifiche non salvate tra quelli che l'operazione tocca (o ai quali il refactoring cambierebbe il testo). */
function dirtyAmong(paths: string[]): string[] {
  return editorPanels()
    .filter((e) => e.dirty && paths.some((p) => isInside(e.filePath, p)))
    .map((e) => e.filePath)
}

/** Dopo uno spostamento: gli editor aperti sui file spostati seguono il nuovo percorso. */
function retargetEditors(items: MoveItem[]): void {
  for (const e of editorPanels()) {
    const moved = renamedPath(e.filePath, items)
    if (moved === e.filePath) continue
    e.api.updateParameters({ ...e.params, filePath: moved } satisfies PanelParams)
    e.api.setTitle(baseName(moved))
  }
}

function summary(items: MoveItem[], copy: boolean): string {
  const verb = copy ? 'Copiato' : items.length === 1 && parentOf(items[0].from).toLowerCase() === parentOf(items[0].to).toLowerCase() ? 'Rinominato' : 'Spostato'
  return items.length === 1 ? `${verb}: ${baseName(items[0].from)} → ${baseName(items[0].to)}` : `${verb}: ${items.length} elementi`
}

/** La sequenza completa. `root`: la cartella del progetto che contiene gli elementi. Restituisce `true` se l'operazione è stata eseguita. */
export async function performOps(root: string, items: MoveItem[], copy: boolean): Promise<boolean> {
  if (!root || !items.length) return false
  if (!copy) {
    const dirty = dirtyAmong(items.map((i) => i.from))
    if (dirty.length) {
      notify(`Salva o chiudi prima i file con modifiche non salvate: ${dirty.map(baseName).slice(0, 3).join(', ')}${dirty.length > 3 ? '…' : ''}`, 'warn')
      return false
    }
  }
  const prepared = await api.files.prepareMove(root, items, copy)
  if (!prepared.ok) {
    notify(prepared.error ?? 'Operazione non possibile.', 'error')
    return false
  }
  let edits: ApiFileEdit[] = prepared.edits
  if (edits.length) {
    const dirty = dirtyAmong(edits.map((f) => f.path))
    if (dirty.length) {
      notify(`Il codice da aggiornare ha modifiche non salvate: salva o chiudi ${dirty.map(baseName).slice(0, 3).join(', ')} e riprova.`, 'warn')
      return false
    }
  }
  if (prepared.conflicts.length || edits.length) {
    const choice = await new Promise<'apply' | 'plain' | null>((resolve) => useFileOps.setState({ dialog: { kind: 'confirm', root, items, copy, prepared, resolve } }))
    useFileOps.getState().close()
    if (!choice) return false
    if (choice === 'plain') edits = []
  }
  const res = await api.files.move(root, items, copy, prepared.conflicts.length > 0, edits)
  if (!res.ok) {
    notify(res.error ?? 'Operazione non riuscita.', 'error')
    return false
  }
  if (!copy) retargetEditors(items)
  notify(`${summary(items, copy)}${res.edited ? ` · ${res.edited} ${res.edited === 1 ? 'file di codice aggiornato' : 'file di codice aggiornati'}` : ''}`, 'ok')
  return true
}

/** Finestra «Rinomina» (F2). */
export function requestRename(path: string, root: string, dir: boolean): void {
  useFileOps.setState({ dialog: { kind: 'rename', path, root, dir } })
}

/** Finestra «Sposta in…» (F6) o «Copia in…» (F5). */
export function requestMove(paths: string[], root: string, copy = false): void {
  if (paths.length) useFileOps.setState({ dialog: { kind: 'move', paths, root, copy } })
}

/** Rinomina nella stessa cartella. Il nome si controlla qui; gli altri controlli (esiste già…) li fa il passo successivo. */
export async function renameTo(path: string, root: string, newName: string): Promise<boolean> {
  const bad = validateName(newName)
  if (bad) {
    notify(bad, 'error')
    return false
  }
  const name = newName.trim()
  if (name === baseName(path)) return false
  return performOps(root, [{ from: path, to: joinPath(parentOf(path), name) }], false)
}

/** Sposta o copia dentro una cartella (trascinamento o finestra). Scarta ciò che è già in quella cartella. */
export async function moveInto(paths: string[], destDir: string, root: string, copy: boolean): Promise<boolean> {
  const items = paths
    .filter((p) => copy || normPath(parentOf(p)) !== normPath(destDir))
    .filter((p) => !isInside(destDir, p))
    .map((p) => ({ from: p, to: joinPath(destDir, baseName(p)) }))
  if (!items.length) {
    notify(paths.some((p) => isInside(destDir, p)) ? 'Una cartella non si può spostare dentro se stessa.' : 'È già in quella cartella.', 'info')
    return false
  }
  return performOps(root, items, copy)
}

/** Percorsi di più elementi senza quelli che stanno dentro un'altra cartella selezionata (spostare la cartella basta). */
export function topLevel(paths: string[]): string[] {
  return paths.filter((p) => !paths.some((q) => q !== p && isInside(p, q) && normPath(p) !== normPath(q)))
}
