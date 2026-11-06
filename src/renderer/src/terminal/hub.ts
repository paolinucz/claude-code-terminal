import { api } from '@/lib/api'

type DataListener = (seq: number, data: string) => void
type ResizeListener = (cols: number, rows: number) => void
type ExitListener = (code: number) => void

/**
 * Smista gli eventi delle sessioni alle viste. Le finestre staccate eseguono il codice nella
 * finestra principale, quindi basta un'unica iscrizione per tutte le viste.
 */
const dataListeners = new Map<string, Set<DataListener>>()
const resizeListeners = new Map<string, Set<ResizeListener>>()
const exitListeners = new Map<string, Set<ExitListener>>()

let wired = false
function wire(): void {
  if (wired) return
  wired = true
  api.sessions.onData((id, seq, data) => dataListeners.get(id)?.forEach((l) => l(seq, data)))
  api.sessions.onResize((id, cols, rows) => resizeListeners.get(id)?.forEach((l) => l(cols, rows)))
  api.sessions.onExit((id, code) => exitListeners.get(id)?.forEach((l) => l(code)))
}

function add<T>(map: Map<string, Set<T>>, id: string, listener: T): () => void {
  wire()
  let set = map.get(id)
  if (!set) map.set(id, (set = new Set()))
  set.add(listener)
  return () => {
    set!.delete(listener)
    if (set!.size === 0) map.delete(id)
  }
}

export const sessionHub = {
  onData: (id: string, l: DataListener) => add(dataListeners, id, l),
  onResize: (id: string, l: ResizeListener) => add(resizeListeners, id, l),
  onExit: (id: string, l: ExitListener) => add(exitListeners, id, l)
}
