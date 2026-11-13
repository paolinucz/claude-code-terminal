import { create } from 'zustand'
import { isOpen, type FileChange } from '@shared/changes'
import { api } from '@/lib/api'
import { useChanges } from '@/state/changes'

/** Come si legge il diff: automatico (affiancato se c'è larghezza, in linea se stretto), sempre in linea, sempre affiancato. */
export type DiffMode = 'auto' | 'inline' | 'side'
export const DIFF_MODES = [
  { id: 'auto', label: 'Auto' },
  { id: 'inline', label: 'In linea' },
  { id: 'side', label: 'Affiancato' }
] as const satisfies readonly { id: DiffMode; label: string }[]

const KEY_WIDTH = 'ui.reviewWidth'
const KEY_AUTO = 'ui.reviewAutoOpen'
const KEY_MODE = 'ui.diffMode'
export const REVIEW_MIN_WIDTH = 360
export const REVIEW_DEFAULT_WIDTH = 520

interface SessionReviewUi {
  open: boolean
  /** Modifica da portare in primo piano (clic su una card della conversazione). `n` fa scattare di nuovo lo stesso file. */
  focusId: string | null
  n: number
  /** L'utente l'ha chiuso a mano: non si riapre da solo finché non c'è più nulla da rivedere. */
  userClosed: boolean
  /** Si è aperto da solo: quando non resta nulla da rivedere si richiude da solo. */
  autoOpened: boolean
}

interface ReviewStore {
  /** Cassetto di revisione per sessione di Claude (vedi `changes/ReviewDrawer.tsx`). */
  sessions: Record<string, SessionReviewUi>
  width: number
  autoOpen: boolean
  diffMode: DiffMode
  loaded: boolean
  load(): Promise<void>
  setWidth(w: number): void
  setAutoOpen(on: boolean): void
  setDiffMode(m: DiffMode): void
  /** Apre il cassetto della sessione, sul file indicato se c'è. */
  openReview(sessionId: string, changeId?: string | null): void
  closeReview(sessionId: string): void
  toggleReview(sessionId: string): void
}

const blank: SessionReviewUi = { open: false, focusId: null, n: 0, userClosed: false, autoOpened: false }

export const useReviewUi = create<ReviewStore>((set, get) => {
  const patch = (sessionId: string, p: Partial<SessionReviewUi>) =>
    set((s) => ({ sessions: { ...s.sessions, [sessionId]: { ...(s.sessions[sessionId] ?? blank), ...p } } }))
  return {
    sessions: {},
    width: REVIEW_DEFAULT_WIDTH,
    autoOpen: true,
    diffMode: 'auto',
    loaded: false,
    async load() {
      if (get().loaded) return
      set({ loaded: true })
      const [w, auto, mode] = await Promise.all([api.settings.get(KEY_WIDTH), api.settings.get(KEY_AUTO), api.settings.get(KEY_MODE)])
      if (typeof w === 'number' && w >= REVIEW_MIN_WIDTH && w <= 2000) set({ width: w })
      if (typeof auto === 'boolean') set({ autoOpen: auto })
      if (mode === 'auto' || mode === 'inline' || mode === 'side') set({ diffMode: mode })
    },
    setWidth(w) {
      const width = Math.max(REVIEW_MIN_WIDTH, Math.round(w))
      set({ width })
      void api.settings.set(KEY_WIDTH, width)
    },
    setAutoOpen(on) {
      set({ autoOpen: on })
      void api.settings.set(KEY_AUTO, on)
    },
    setDiffMode(m) {
      set({ diffMode: m })
      void api.settings.set(KEY_MODE, m)
    },
    openReview(sessionId, changeId = null) {
      const cur = get().sessions[sessionId] ?? blank
      patch(sessionId, { open: true, focusId: changeId ?? cur.focusId, n: cur.n + 1, userClosed: false, autoOpened: false })
    },
    closeReview(sessionId) {
      patch(sessionId, { open: false, userClosed: true, autoOpened: false })
    },
    toggleReview(sessionId) {
      if (get().sessions[sessionId]?.open) get().closeReview(sessionId)
      else get().openReview(sessionId)
    }
  }
})

/** Modifiche ancora da rivedere (o in attesa di Claude) di una sessione. */
export const openChangesOf = (changes: FileChange[], sessionId: string): FileChange[] => changes.filter((c) => c.sessionId === sessionId && isOpen(c))

let started = false

/**
 * Apertura automatica: quando una sessione riceve una modifica da rivedere il suo cassetto si apre (se l'utente non l'ha chiuso a
 * mano); quando non resta nulla da rivedere, un cassetto aperto da solo si richiude. Non ruba mai il focus alla casella di input.
 */
export function startReviewAutoOpen(): void {
  if (started) return
  started = true
  void useReviewUi.getState().load()
  let known = new Set<string>()
  const seen = (changes: FileChange[]) => new Set(changes.filter((c) => c.status === 'pending').map((c) => c.id))
  const apply = (changes: FileChange[]) => {
    const ui = useReviewUi.getState()
    const now = seen(changes)
    const fresh = changes.filter((c) => c.status === 'pending' && !known.has(c.id))
    known = now
    for (const sessionId of new Set(fresh.map((c) => c.sessionId))) {
      const cur = ui.sessions[sessionId]
      if (ui.autoOpen && !cur?.userClosed && !cur?.open) {
        useReviewUi.setState((s) => ({ sessions: { ...s.sessions, [sessionId]: { ...(s.sessions[sessionId] ?? blank), open: true, autoOpened: true } } }))
      }
    }
    // Niente più da rivedere: si richiude se si era aperto da solo, e il «chiuso a mano» si azzera.
    for (const [sessionId, cur] of Object.entries(ui.sessions)) {
      if (openChangesOf(changes, sessionId).length > 0) continue
      if (cur.autoOpened || cur.userClosed) {
        useReviewUi.setState((s) => ({ sessions: { ...s.sessions, [sessionId]: { ...s.sessions[sessionId], open: cur.autoOpened ? false : s.sessions[sessionId].open, autoOpened: false, userClosed: false } } }))
      }
    }
  }
  // Le modifiche già presenti all'avvio non aprono nulla da sole: si parte dallo stato attuale.
  known = seen(useChanges.getState().changes)
  useChanges.subscribe((s, prev) => {
    if (s.changes !== prev.changes) apply(s.changes)
  })
}
