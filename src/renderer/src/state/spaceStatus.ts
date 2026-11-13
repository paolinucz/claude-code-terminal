import { useMemo } from 'react'
import type { SessionInfo, SessionStatus } from '@shared/sessions'
import type { PanelParams } from '@/panels/kinds'
import { useBots } from '@/state/bots'
import { useSessions } from '@/state/sessions'
import { useWorkspace } from '@/state/workspace'
import { dockRegistry } from '@/workspace/registry'

/** Stato che uno spazio mostra nel suo chip: il caso più urgente tra le sue sessioni vince. */
export type SpaceBadge = 'waiting' | 'working' | null

export interface SpaceSession {
  id: string
  title: string
  status: SessionStatus
}

/** Etichette lette dagli screen reader e mostrate nei suggerimenti (lo stato non si comunica solo con il colore). */
export const BADGE_LABELS: Record<Exclude<SpaceBadge, null>, string> = {
  waiting: 'Una sessione attende input o un permesso',
  working: 'Claude sta lavorando'
}

/** Sessioni aperte in uno spazio, nell'ordine dei pannelli (una sessione con più viste conta una volta). */
export function sessionsOfSpace(spaceId: string, sessions: Record<string, SessionInfo>): SpaceSession[] {
  const out: SpaceSession[] = []
  const seen = new Set<string>()
  for (const p of dockRegistry.get(spaceId)?.panels ?? []) {
    const id = (p.params as PanelParams | undefined)?.sessionId
    const s = id ? sessions[id] : undefined
    if (!id || !s || seen.has(id)) continue
    seen.add(id)
    out.push({ id, title: useBots.getState().bots[id]?.name ?? s.title, status: s.status })
  }
  return out
}

export function badgeOf(list: SpaceSession[]): SpaceBadge {
  if (list.some((s) => s.status === 'waiting')) return 'waiting'
  if (list.some((s) => s.status === 'working')) return 'working'
  return null
}

/** Sessioni di uno spazio, sempre aggiornate: anche per gli spazi che non sono quello aperto (restano tutti montati). */
export function useSpaceSessions(spaceId: string): SpaceSession[] {
  const sessions = useSessions((s) => s.sessions)
  const sig = useWorkspace((s) => s.panelSigs[spaceId])
  const bots = useBots((s) => s.bots)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => sessionsOfSpace(spaceId, sessions), [spaceId, sessions, sig, bots])
}

/** Il pannello di Dockview che mostra una sessione in uno spazio (per trascinarla altrove). */
export function panelOfSession(spaceId: string, sessionId: string): string | undefined {
  return dockRegistry.get(spaceId)?.panels.find((p) => (p.params as PanelParams | undefined)?.sessionId === sessionId)?.id
}
