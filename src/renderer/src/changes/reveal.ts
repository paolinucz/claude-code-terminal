import type { FileChange } from '@shared/changes'
import type { PanelParams } from '@/panels/kinds'
import { useReviewUi } from '@/state/review'
import { useSessions } from '@/state/sessions'
import { useWorkspace } from '@/state/workspace'
import { dockRegistry } from '@/workspace/registry'

/** Il pannello terminale (in qualunque spazio) che mostra una sessione di Claude, se c'è. */
export function terminalPanelOf(sessionId: string): { spaceId: string; panelId: string } | undefined {
  for (const space of useWorkspace.getState().spaces) {
    const panel = dockRegistry.get(space.id)?.panels.find((p) => (p.params as PanelParams | undefined)?.sessionId === sessionId)
    if (panel) return { spaceId: space.id, panelId: panel.id }
  }
  return undefined
}

/**
 * Porta una modifica nel cassetto di revisione della sua sessione: apre lo spazio e il pannello terminale che la mostra e
 * apre il cassetto sul file. Restituisce false se la sessione non ha un pannello aperto (chiusa o terminata): in quel caso
 * resta il diff della panoramica.
 */
export function revealChange(change: Pick<FileChange, 'id' | 'sessionId'>): boolean {
  const session = useSessions.getState().sessions[change.sessionId]
  const where = terminalPanelOf(change.sessionId)
  if (!where || session?.kind !== 'claude') return false
  useReviewUi.getState().openReview(change.sessionId, change.id)
  const ws = useWorkspace.getState()
  if (ws.activeSpaceId !== where.spaceId) ws.setActive(where.spaceId)
  dockRegistry.get(where.spaceId)?.getPanel(where.panelId)?.api.setActive()
  return true
}

/** Sessione di Claude su cui agiscono i comandi di palette: il terminale attivo dello spazio aperto, altrimenti il primo con Claude. */
export function activeClaudeSessionId(): string | undefined {
  const dock = dockRegistry.get(useWorkspace.getState().activeSpaceId)
  if (!dock) return undefined
  const sessions = useSessions.getState().sessions
  const idOf = (p: { params?: unknown } | undefined) => (p?.params as PanelParams | undefined)?.sessionId
  const active = idOf(dock.activePanel)
  if (active && sessions[active]?.kind === 'claude') return active
  return dock.panels.map(idOf).find((id): id is string => Boolean(id && sessions[id]?.kind === 'claude'))
}
