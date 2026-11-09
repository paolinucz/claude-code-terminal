import { create } from 'zustand'
import { emptyDebugState, type DebugState, type JavaBreakpoint, type JavaProgress, type JavaState } from '@shared/java'
import { normPath } from '@shared/files'
import { api } from '@/lib/api'

interface JavaStore {
  /** Cartella per cui si è letto lo stato. */
  root: string
  state: JavaState | null
  debug: DebugState
  /** Righe della console di debug (uscita del programma e risultati delle espressioni). */
  output: string[]
  progress: JavaProgress | null
  /** Breakpoint per file (chiave = percorso come lo vede il debugger). */
  breakpoints: Record<string, JavaBreakpoint[]>
  /** Solo la prima volta. */
  init(): void
  refresh(root?: string, fresh?: boolean): Promise<void>
  toggleBreakpoint(file: string, line: number): Promise<void>
  /** Modifica un breakpoint (condizione, attivo) o lo toglie (`null`). */
  updateBreakpoint(file: string, line: number, patch: Partial<JavaBreakpoint> | null): Promise<void>
  say(line: string): void
  clearOutput(): void
}

async function apply(file: string, list: JavaBreakpoint[]): Promise<void> {
  const breakpoints = { ...useJavaDev.getState().breakpoints }
  if (list.length) breakpoints[file] = list
  else delete breakpoints[file]
  useJavaDev.setState({ breakpoints })
  await api.java.setBreakpoints(file, list)
}

let started = false
const MAX_LINES = 1000

/** Java development pack: stato letto dal processo principale (servizi, JDK, configurazioni) e dal debugger. */
export const useJavaDev = create<JavaStore>((set, get) => ({
  root: '',
  state: null,
  debug: emptyDebugState(),
  output: [],
  progress: null,
  breakpoints: {},
  init() {
    if (started) return
    started = true
    api.java.onChanged(() => void get().refresh())
    api.java.onDebug((debug) => {
      set({ debug })
      if (debug.message && (debug.status === 'terminated' || debug.status === 'starting')) get().say(`● ${debug.message}`)
    })
    api.java.onOutput((o) => get().say(o.text.replace(/\r?\n$/, '')))
    api.java.onProgress((p) => {
      set({ progress: p })
      if (p.done || p.error) window.setTimeout(() => set({ progress: null }), p.error ? 6000 : 1500)
    })
    void api.java.debugState().then((debug) => set({ debug }))
    void api.java.breakpoints().then((breakpoints) => set({ breakpoints }))
  },
  async refresh(root, fresh) {
    const target = root ?? get().root
    set({ root: target })
    set({ state: await api.java.state(target, fresh) })
  },
  async toggleBreakpoint(file, line) {
    const { key, list } = breakpointsOf(get().breakpoints, file)
    const next = list.some((b) => b.line === line) ? list.filter((b) => b.line !== line) : [...list, { line, enabled: true }].sort((x, y) => x.line - y.line)
    await apply(key, next)
  },
  async updateBreakpoint(file, line, patch) {
    const { key, list } = breakpointsOf(get().breakpoints, file)
    await apply(key, patch === null ? list.filter((b) => b.line !== line) : list.map((b) => (b.line === line ? { ...b, ...patch } : b)))
  },
  say(line) {
    set((s) => ({ output: [...s.output, line].slice(-MAX_LINES) }))
  },
  clearOutput() {
    set({ output: [] })
  }
}))

/** Breakpoint di un file (confronto senza maiuscole/minuscole come fa Windows). */
export function breakpointsOf(all: Record<string, JavaBreakpoint[]>, file: string): { key: string; list: JavaBreakpoint[] } {
  const k = normPath(file)
  const key = Object.keys(all).find((f) => normPath(f) === k) ?? file
  return { key, list: all[key] ?? [] }
}
