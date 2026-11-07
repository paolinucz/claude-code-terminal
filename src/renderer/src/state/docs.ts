import { create } from 'zustand'
import { CLAUDE_MD, joinRel } from '@shared/project'
import { normPath } from '@shared/files'
import { api } from '@/lib/api'
import { useProject } from './project'
import { useWorkspace } from './workspace'

/** Testo di partenza per un `CLAUDE.md` nuovo (J3a): l'utente lo completa. */
export function claudeMdTemplate(projectName: string): string {
  return `# ${projectName}

Descrivi qui il progetto: a cosa serve e come è organizzato.

## Comandi

- Come si compila:
- Come si provano le modifiche:

## Regole di lavoro

- Lingua dei commenti e dei messaggi di commit:
- Cose da non fare:
`
}

export type ClaudeMdState = 'unknown' | 'present' | 'missing'

interface DocsStore {
  /** Il `CLAUDE.md` nella radice del progetto attivo (J3): lo si rileva da solo, se manca si avvisa (J3a). */
  claudeMd: ClaudeMdState
  /** Cambia a ogni modifica rilevata su disco: i pannelli lo usano per rileggere i documenti. */
  version: number
  init(): void
  refresh(): Promise<void>
  /** Crea un `CLAUDE.md` di partenza, solo su richiesta dell'utente. Restituisce l'errore, se c'è. */
  createClaudeMd(): Promise<string | null>
}

let started = false
let watched: string | null = null

export const useDocs = create<DocsStore>((set, get) => ({
  claudeMd: 'unknown',
  version: 0,

  init() {
    if (started) return
    started = true
    const sync = () => {
      const root = useProject.getState().active?.root ?? null
      if (root === watched) return
      if (watched) api.files.unwatch(watched)
      watched = root
      if (root) api.files.watch(root)
      set({ claudeMd: 'unknown' })
      void get().refresh()
    }
    useProject.subscribe(sync)
    sync()
    // Il file si osserva sul disco; in più si ricontrolla quando la finestra torna in primo piano.
    api.files.onChanged((root) => {
      if (watched && normPath(root) === normPath(watched)) void get().refresh()
    })
    window.addEventListener('focus', () => void get().refresh())
  },

  async refresh() {
    const active = useProject.getState().active
    if (!active) {
      set({ claudeMd: 'unknown' })
      return
    }
    const status = await api.env.pathStatus(joinRel(active.root, CLAUDE_MD))
    set((s) => ({ claudeMd: status === 'file' ? 'present' : 'missing', version: s.version + 1 }))
  },

  async createClaudeMd() {
    const active = useProject.getState().active
    if (!active) return 'Nessun progetto aperto'
    const path = joinRel(active.root, CLAUDE_MD)
    if ((await api.env.pathStatus(path)) === 'file') {
      await get().refresh()
      return null
    }
    const res = await api.files.write(path, claudeMdTemplate(active.data.name))
    if (!res.ok) return res.error ?? 'Impossibile creare il file'
    useWorkspace.getState().setStatus(`${CLAUDE_MD} creato in ${active.root}`)
    await get().refresh()
    return null
  }
}))
