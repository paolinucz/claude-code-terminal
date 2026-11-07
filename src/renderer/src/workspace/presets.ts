import type { PromptPreset } from '@shared/prompts'
import { api } from '@/lib/api'
import type { PanelParams } from '@/panels/kinds'
import { useSessions } from '@/state/sessions'
import { useWorkspace } from '@/state/workspace'
import { dockRegistry } from './registry'

/**
 * La sessione Claude a cui mandare un prompt predefinito: il terminale attivo del foglio, altrimenti uno visibile,
 * altrimenti il primo. Restituisce un messaggio d'errore se nel foglio non c'è nessuna sessione Claude viva.
 */
export function targetClaudeSession(): { id: string; title: string } | { error: string } {
  const dock = dockRegistry.get(useWorkspace.getState().activeSheetId)
  const sessions = useSessions.getState().sessions
  const claude = (dock?.panels ?? []).filter((p) => {
    const sid = (p.params as PanelParams | undefined)?.sessionId
    const s = sid ? sessions[sid] : undefined
    return s?.kind === 'claude' && s.status !== 'exited'
  })
  const chosen = claude.find((p) => p.api.isActive) ?? claude.find((p) => p.api.isVisible) ?? claude[0]
  const sid = (chosen?.params as PanelParams | undefined)?.sessionId
  if (!sid) return { error: 'Nessuna sessione Claude aperta in questo foglio: aprine una con «Terminale».' }
  return { id: sid, title: sessions[sid]?.title ?? 'sessione' }
}

/** Manda un prompt predefinito a Claude con un clic; l'esito va nella barra di stato. */
export async function sendPreset(preset: PromptPreset): Promise<void> {
  const setStatus = useWorkspace.getState().setStatus
  const target = targetClaudeSession()
  if ('error' in target) {
    setStatus(target.error)
    return
  }
  const res = await api.sessions.sendPrompt(target.id, preset.text)
  setStatus(res.ok ? `«${preset.name}» inviato a «${target.title}»` : (res.error ?? 'Messaggio non inviato'))
}
