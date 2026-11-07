import { create } from 'zustand'
import { contextWorkdir, type ProjectContextDef, type ProjectFile, type ProjectInfo, type ProjectRef, type ProjectResult } from '@shared/project'
import { api } from '@/lib/api'
import { useWorkspace } from './workspace'

const ACTIVE_KEY = 'project.active'
const contextKey = (root: string) => `project.context.${root.toLowerCase()}`

interface ProjectStore {
  /** Progetto attivo, o `null` se non ne è aperto nessuno (l'app funziona come nella 1.0). */
  active: ProjectInfo | null
  /** Contesto attivo del progetto (J5), o `null` se il progetto non ne ha ancora. */
  activeContextId: string | null
  recents: ProjectRef[]
  init(): void
  refreshRecents(): Promise<void>
  /** Apre un progetto da cartella o da `.cctproj`. Restituisce `false` e scrive l'errore in barra di stato se fallisce. */
  openPath(path: string): Promise<boolean>
  /** Crea il `.cctproj` in una cartella. Restituisce l'errore, se c'è, per mostrarlo nella finestra. */
  create(root: string, name: string): Promise<string | null>
  /** Per un progetto della 1.0 senza file: lo crea nella radice (solo su richiesta dell'utente). */
  createFileForActive(): Promise<void>
  close(): void
  forget(root: string): Promise<void>

  // ---- Contesti (J5) ----
  setContext(id: string): void
  addContext(name: string, dir?: string): Promise<string | null>
  updateContext(id: string, patch: Partial<Pick<ProjectContextDef, 'name' | 'dirs'>>): Promise<string | null>
  duplicateContext(id: string): Promise<void>
  removeContext(id: string): Promise<void>
  moveContext(id: string, delta: -1 | 1): Promise<void>

  // ---- Documentazione (J4, J6) ----
  addDocs(scope: 'global' | { contextId: string }, paths: string[]): Promise<void>
  removeDoc(scope: 'global' | { contextId: string }, path: string): Promise<void>
}

let started = false

const setStatus = (text: string) => useWorkspace.getState().setStatus(text)

/** Contesto attivo come oggetto (per chi non è un componente React). */
export function activeContextOf(s: Pick<ProjectStore, 'active' | 'activeContextId'>): ProjectContextDef | undefined {
  return s.active?.data.contexts.find((c) => c.id === s.activeContextId)
}

/** Cartella di lavoro predefinita del contesto di un foglio, o `undefined` se non c'è un progetto aperto. */
export function workdirForSheet(sheetId: string | undefined): string | undefined {
  const { active } = useProject.getState()
  if (!active) return undefined
  const sheet = useWorkspace.getState().sheets.find((s) => s.id === sheetId)
  const ctx = active.data.contexts.find((c) => c.id === sheet?.contextId)
  return contextWorkdir(active.root, ctx)
}

/** Progetto attivo, contesti e progetti recenti (release 2). */
export const useProject = create<ProjectStore>((set, get) => {
  /** Salva i dati del progetto (crea il file se non c'era: è sempre una scelta esplicita dell'utente). */
  const persistData = async (next: ProjectFile): Promise<string | null> => {
    const active = get().active
    if (!active) return 'Nessun progetto aperto'
    const res = await api.project.save(active.root, next)
    if (!res.ok) {
      setStatus(res.error)
      return res.error
    }
    set({ active: res.value })
    void get().refreshRecents()
    return null
  }

  /** Dopo aver aperto un progetto: ripristina l'ultimo contesto e mostra i suoi fogli. */
  const applyContext = (info: ProjectInfo | null) => {
    const contexts = info?.data.contexts ?? []
    if (!info || contexts.length === 0) {
      set({ activeContextId: null })
      useWorkspace.getState().setContext(null)
      return
    }
    void api.settings.get(contextKey(info.root)).then((saved) => {
      const id = contexts.some((c) => c.id === saved) ? (saved as string) : contexts[0].id
      set({ activeContextId: id })
      useWorkspace.getState().setContext(id)
    })
  }

  const adopt = (res: ProjectResult<ProjectInfo>): ProjectInfo | null => {
    if (!res.ok) return null
    set({ active: res.value })
    void api.settings.set(ACTIVE_KEY, res.value.root)
    void get().refreshRecents()
    applyContext(res.value)
    return res.value
  }

  return {
    active: null,
    activeContextId: null,
    recents: [],
    init() {
      if (started) return
      started = true
      void get().refreshRecents()
      // Riapre l'ultimo progetto. Se non c'è più (cartella spostata o file rovinato) si riparte senza.
      void api.settings.get(ACTIVE_KEY).then(async (root) => {
        if (typeof root !== 'string' || !root) return
        const res = await api.project.open(root)
        if (res.ok) {
          set({ active: res.value })
          applyContext(res.value)
        } else void api.settings.set(ACTIVE_KEY, null)
      })
    },
    async refreshRecents() {
      set({ recents: await api.project.recents() })
    },
    async openPath(path) {
      const res = await api.project.open(path)
      const info = adopt(res)
      if (!info) {
        setStatus(res.ok ? 'Progetto non aperto' : res.error)
        return false
      }
      setStatus(`Progetto «${info.data.name}» aperto${info.file ? '' : ' (senza file di progetto)'}`)
      return true
    },
    async create(root, name) {
      const res = await api.project.create(root, name)
      const info = adopt(res)
      if (!info) return res.ok ? 'Progetto non creato' : res.error
      setStatus(`Progetto «${info.data.name}» creato`)
      return null
    },
    async createFileForActive() {
      const active = get().active
      if (!active) return
      const res = await api.project.save(active.root, active.data)
      if (res.ok) set({ active: res.value })
      void get().refreshRecents()
      setStatus(res.ok ? `File di progetto creato: ${res.value.file ?? ''}` : res.error)
    },
    close() {
      set({ active: null, activeContextId: null })
      useWorkspace.getState().setContext(null)
      void api.settings.set(ACTIVE_KEY, null)
    },
    async forget(root) {
      await api.project.forget(root)
      await get().refreshRecents()
    },

    setContext(id) {
      const { active } = get()
      if (!active || !active.data.contexts.some((c) => c.id === id)) return
      set({ activeContextId: id })
      void api.settings.set(contextKey(active.root), id)
      useWorkspace.getState().setContext(id)
    },

    async addContext(name, dir) {
      const active = get().active
      const clean = name.trim()
      if (!active || !clean) return 'Dai un nome al contesto'
      if (active.data.contexts.some((c) => c.name.toLowerCase() === clean.toLowerCase())) return 'Esiste già un contesto con questo nome'
      const ctx: ProjectContextDef = { id: crypto.randomUUID(), name: clean, dirs: dir ? [dir] : [], docs: [] }
      const err = await persistData({ ...active.data, contexts: [...active.data.contexts, ctx] })
      if (err) return err
      // Il primo contesto prende i fogli già aperti, così non si perde il lavoro in corso.
      if (active.data.contexts.length === 0) useWorkspace.getState().adoptLooseSheets(ctx.id)
      get().setContext(ctx.id)
      setStatus(`Contesto «${clean}» creato`)
      return null
    },

    async updateContext(id, patch) {
      const active = get().active
      if (!active) return 'Nessun progetto aperto'
      const name = patch.name?.trim()
      if (patch.name !== undefined && !name) return 'Dai un nome al contesto'
      if (name && active.data.contexts.some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) {
        return 'Esiste già un contesto con questo nome'
      }
      const contexts = active.data.contexts.map((c) => (c.id === id ? { ...c, ...patch, ...(name ? { name } : {}) } : c))
      return persistData({ ...active.data, contexts })
    },

    async duplicateContext(id) {
      const active = get().active
      const src = active?.data.contexts.find((c) => c.id === id)
      if (!active || !src) return
      let name = `${src.name} (copia)`
      for (let n = 2; active.data.contexts.some((c) => c.name.toLowerCase() === name.toLowerCase()); n++) name = `${src.name} (copia ${n})`
      const copy: ProjectContextDef = { id: crypto.randomUUID(), name, dirs: [...src.dirs], docs: [...src.docs] }
      if (await persistData({ ...active.data, contexts: [...active.data.contexts, copy] })) return
      get().setContext(copy.id)
      setStatus(`Contesto «${name}» creato: ambito e documenti copiati, fogli nuovi`)
    },

    async removeContext(id) {
      const active = get().active
      if (!active) return
      const contexts = active.data.contexts.filter((c) => c.id !== id)
      if (await persistData({ ...active.data, contexts })) return
      useWorkspace.getState().removeContextSheets(id)
      if (get().activeContextId === id) {
        if (contexts.length > 0) get().setContext(contexts[0].id)
        else {
          set({ activeContextId: null })
          useWorkspace.getState().setContext(null)
        }
      }
    },

    async moveContext(id, delta) {
      const active = get().active
      if (!active) return
      const list = [...active.data.contexts]
      const from = list.findIndex((c) => c.id === id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= list.length) return
      const [item] = list.splice(from, 1)
      list.splice(to, 0, item)
      await persistData({ ...active.data, contexts: list })
    },

    async addDocs(scope, paths) {
      const active = get().active
      if (!active || paths.length === 0) return
      const merge = (list: string[]) => [...new Set([...list, ...paths])]
      if (scope === 'global') {
        await persistData({ ...active.data, docs: { global: merge(active.data.docs.global) } })
      } else {
        const contexts = active.data.contexts.map((c) => (c.id === scope.contextId ? { ...c, docs: merge(c.docs) } : c))
        await persistData({ ...active.data, contexts })
      }
    },

    async removeDoc(scope, path) {
      const active = get().active
      if (!active) return
      if (scope === 'global') {
        await persistData({ ...active.data, docs: { global: active.data.docs.global.filter((p) => p !== path) } })
      } else {
        const contexts = active.data.contexts.map((c) => (c.id === scope.contextId ? { ...c, docs: c.docs.filter((p) => p !== path) } : c))
        await persistData({ ...active.data, contexts })
      }
    }
  }
})
