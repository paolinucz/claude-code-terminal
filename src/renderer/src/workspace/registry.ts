import type { DockviewApi } from 'dockview-react'

/**
 * Le API Dockview degli spazi montati. Non stanno nello store React perché sono oggetti
 * vivi (non serializzabili) e cambiarli non deve causare un nuovo render.
 */
const apis = new Map<string, DockviewApi>()

export const dockRegistry = {
  set(spaceId: string, api: DockviewApi): void {
    apis.set(spaceId, api)
  },
  delete(spaceId: string): void {
    apis.delete(spaceId)
  },
  get(spaceId: string): DockviewApi | undefined {
    return apis.get(spaceId)
  },
  /** Tutti gli spazi montati (anche quelli nascosti). */
  all(): DockviewApi[] {
    return [...apis.values()]
  }
}
