import { create } from 'zustand'
import { DEFAULT_REVIEW_KINDS, REVIEW_KIND_LIMITS, sanitizeReviewKinds, type ReviewKind } from '@shared/changes'
import { api } from '@/lib/api'

const KEY = 'review.kinds'

interface ReviewKindsStore {
  kinds: ReviewKind[]
  loaded: boolean
  load(): Promise<void>
  /** Sostituisce la lista. Restituisce l'errore, se c'è. */
  save(kinds: ReviewKind[]): Promise<string | null>
  restoreDefaults(): Promise<void>
}

export const useReviewKinds = create<ReviewKindsStore>((set, get) => ({
  kinds: DEFAULT_REVIEW_KINDS,
  loaded: false,
  async load() {
    if (get().loaded) return
    set({ loaded: true })
    const saved = sanitizeReviewKinds(await api.settings.get(KEY))
    if (saved && saved.length) set({ kinds: saved })
  },
  async save(kinds) {
    if (!kinds.length) return 'Serve almeno un tipo di nota'
    if (kinds.length > REVIEW_KIND_LIMITS.count) return `Al massimo ${REVIEW_KIND_LIMITS.count} tipi`
    const names = kinds.map((k) => k.label.trim().toLowerCase())
    if (names.some((n) => !n)) return 'Ogni tipo ha bisogno di un nome'
    if (new Set(names).size !== names.length) return 'Due tipi hanno lo stesso nome'
    set({ kinds })
    await api.settings.set(KEY, kinds)
    return null
  },
  async restoreDefaults() {
    set({ kinds: DEFAULT_REVIEW_KINDS })
    await api.settings.set(KEY, DEFAULT_REVIEW_KINDS)
  }
}))
