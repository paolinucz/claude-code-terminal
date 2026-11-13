import { isClaudePanel, openSessionView } from './panels'
import { dockRegistry } from './registry'
import { useAppearance, type ClaudeMode } from '@/state/appearance'
import { useBots } from '@/state/bots'
import { useSessions } from '@/state/sessions'
import { useWorkspace } from '@/state/workspace'
import type { PanelParams } from '@/panels/kinds'

/**
 * Cambia la modalità di Claude (schede o bolle) spostando le sessioni vive da una forma all'altra: schede → bolle chiude i
 * pannelli terminale di Claude (le sessioni restano vive, ora sono bolle); bolle → schede apre un pannello per ogni sessione
 * di Claude viva nello spazio attivo. Le due modalità non convivono.
 */
export async function switchClaudeMode(mode: ClaudeMode): Promise<void> {
  if (useAppearance.getState().claudeMode === mode) return
  useAppearance.getState().setClaudeMode(mode)
  useBots.getState().close()
  if (mode === 'bubbles') {
    for (const api of dockRegistry.all()) {
      for (const p of [...api.panels]) if (isClaudePanel(p.params as PanelParams | undefined)) api.removePanel(p)
    }
    return
  }
  const api = dockRegistry.get(useWorkspace.getState().activeSpaceId)
  if (!api) return
  const shown = new Set(api.panels.map((p) => (p.params as PanelParams | undefined)?.sessionId).filter(Boolean))
  const live = Object.values(useSessions.getState().sessions)
    .filter((s) => s.kind === 'claude' && s.status !== 'exited' && !shown.has(s.id))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  for (const s of live) openSessionView(api, s)
}
