import { create } from 'zustand'
import type { SnippetRequest } from '@shared/explain'

/** «Spiega con Haiku» su righe selezionate: la richiesta aperta (null = finestra chiusa). */
interface SnippetExplainStore {
  request: SnippetRequest | null
  open(req: SnippetRequest): void
  close(): void
}

export const useSnippetExplain = create<SnippetExplainStore>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null })
}))
