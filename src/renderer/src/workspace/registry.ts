import type { DockviewApi } from 'dockview-react'

/**
 * Le API Dockview dei fogli montati. Non stanno nello store React perché sono oggetti
 * vivi (non serializzabili) e cambiarli non deve causare un nuovo render.
 */
const apis = new Map<string, DockviewApi>()

export const dockRegistry = {
  set(sheetId: string, api: DockviewApi): void {
    apis.set(sheetId, api)
  },
  delete(sheetId: string): void {
    apis.delete(sheetId)
  },
  get(sheetId: string): DockviewApi | undefined {
    return apis.get(sheetId)
  }
}
