import { getPanelData, type AddPanelOptions, type DockviewApi, type DockviewPanelApi, type IDockviewPanel } from 'dockview-react'
import type { SessionInfo } from '@shared/sessions'
import type { SerializedLayout } from '@shared/types'
import { PANEL_KINDS, type PanelKind, type PanelParams, type SessionHint } from '@/panels/kinds'
import { useWorkspace } from '@/state/workspace'
import { isBubbleMode } from '@/state/appearance'
import { botNameOf, useBots } from '@/state/bots'
import { useSessions } from '@/state/sessions'
import { dockRegistry } from './registry'

let counter = 0
const newPanelId = (kind: PanelKind) => `${kind}-${Date.now().toString(36)}-${(counter++).toString(36)}`

/** Dove aprire un terminale (S9). */
export type Placement = 'dock' | 'float' | 'window'

/** Aggiunge un pannello di un certo tipo. Senza posizione lo mette come scheda nel gruppo attivo. */
export function addPanel(
  api: DockviewApi,
  kind: PanelKind,
  options: {
    title?: string
    params?: Omit<PanelParams, 'kind'>
    position?: AddPanelOptions['position']
    initialWidth?: number
    initialHeight?: number
  } = {}
): string {
  const id = newPanelId(kind)
  api.addPanel<PanelParams>({
    id,
    component: 'placeholder',
    title: options.title ?? PANEL_KINDS[kind].title,
    params: { kind, ...options.params },
    position: options.position,
    initialWidth: options.initialWidth,
    initialHeight: options.initialHeight
  })
  return id
}

export function hintOf(s: SessionInfo): SessionHint {
  return {
    kind: s.kind,
    title: s.title,
    cwd: s.cwd,
    claudeSessionId: s.claudeSessionId,
    shell: s.shell,
    model: s.model,
    effort: s.effort,
    addDirs: s.addDirs
  }
}

/** Apre una vista su una sessione nello spazio indicato (S9: agganciata, fluttuante o in una finestra separata). */
export function openSessionView(api: DockviewApi, session: SessionInfo, placement: Placement = 'dock'): IDockviewPanel | undefined {
  // Modalità Bolle: le sessioni di Claude non stanno nelle schede, si apre la loro bolla.
  if (isBubbleMode() && session.kind === 'claude') {
    useBots.getState().open(session.id)
    return undefined
  }
  const id = addPanel(api, 'terminal', { title: session.kind === 'claude' ? botNameOf(session.id, session.title) : session.title, params: { sessionId: session.id, hint: hintOf(session) } })
  const panel = api.getPanel(id)
  if (!panel) return undefined
  if (placement === 'float') {
    api.addFloatingGroup(panel, { width: 720, height: 460, x: 120, y: 80 })
  } else if (placement === 'window') {
    void api.addPopoutGroup(panel)
  }
  panel.api.setActive()
  return panel
}

/** Collega una sessione a un pannello già esistente (pannello terminale vuoto). */
export function bindPanelToSession(panelApi: DockviewPanelApi, session: SessionInfo): void {
  panelApi.updateParameters({ kind: 'terminal', sessionId: session.id, hint: hintOf(session) } satisfies PanelParams)
  panelApi.setTitle(session.title)
}

/** Il pannello terminale che Dockview sta trascinando in questo momento, se ha una sessione (per lasciarlo su un altro spazio). */
export function draggedTerminal(): { spaceId: string; panelId: string; title: string } | undefined {
  const data = getPanelData()
  if (!data?.panelId) return undefined
  for (const space of useWorkspace.getState().spaces) {
    const panel = dockRegistry.get(space.id)?.getPanel(data.panelId)
    const params = panel?.params as PanelParams | undefined
    if (panel && params?.kind === 'terminal' && params.sessionId) return { spaceId: space.id, panelId: panel.id, title: panel.title ?? 'Terminale' }
  }
  return undefined
}

/**
 * «Invia a…» (S4) e trascinamento tra spazi (S5): la vista passa nell'altro spazio.
 * La sessione non si interrompe: si chiude solo la vista di partenza.
 */
export function moveTerminalToSpace(fromSpaceId: string, panelId: string, toSpaceId: string): boolean {
  const from = dockRegistry.get(fromSpaceId)
  const to = dockRegistry.get(toSpaceId)
  const panel = from?.getPanel(panelId)
  if (!from || !to || !panel || fromSpaceId === toSpaceId) return false
  const params = (panel.params ?? {}) as PanelParams
  addPanel(to, 'terminal', { title: panel.title ?? 'Terminale', params: { sessionId: params.sessionId, hint: params.hint } })
  panel.api.close()
  return true
}

/** In quali spazi è aperta ogni sessione (per «Collega» e per gli avvisi). */
export function sessionLocations(): Map<string, string[]> {
  const { spaces } = useWorkspace.getState()
  const out = new Map<string, string[]>()
  for (const space of spaces) {
    const dock = dockRegistry.get(space.id)
    if (!dock) continue
    for (const p of dock.panels) {
      const id = (p.params as PanelParams | undefined)?.sessionId
      if (!id) continue
      const list = out.get(id) ?? []
      if (!list.includes(space.name)) list.push(space.name)
      out.set(id, list)
    }
  }
  return out
}

/** Trova lo spazio che contiene un pannello. */
export function spaceOfPanel(api: DockviewApi): string | undefined {
  // Dockview può passare oggetti API diversi per la stessa istanza: si confronta l'id.
  return useWorkspace.getState().spaces.find((s) => dockRegistry.get(s.id)?.id === api.id)?.id
}

/** Il pannello terminale è (o era) una sessione di Claude? */
export function isClaudePanel(params: PanelParams | undefined): boolean {
  if (!params || params.kind !== 'terminal') return false
  if (params.hint?.kind === 'claude') return true
  return params.sessionId ? useSessions.getState().sessions[params.sessionId]?.kind === 'claude' : false
}

/** Toglie i pannelli dei tipi nascosti (per esempio i Widget) da un layout appena caricato. */
export function removeHiddenPanels(api: DockviewApi): void {
  for (const p of [...api.panels]) {
    const kind = (p.params as PanelParams | undefined)?.kind
    if (kind && PANEL_KINDS[kind]?.hidden) api.removePanel(p)
    // I terminali dei programmi lanciati da una run configuration non sopravvivono al riavvio: il pannello resterebbe vuoto.
    else if (kind === 'terminal' && (p.params as PanelParams | undefined)?.hint?.kind === 'task') api.removePanel(p)
    // Modalità Bolle: le schede di Claude (vive o rimaste dopo un riavvio) non ci sono.
    else if (kind === 'terminal' && isBubbleMode() && isClaudePanel(p.params as PanelParams | undefined)) api.removePanel(p)
  }
}

/**
 * Un layout salvato con un nome contiene solo la disposizione, non le sessioni (L5):
 * si tolgono sessione e dati di ripresa dai parametri dei terminali.
 */
export function stripSessions(layout: SerializedLayout): SerializedLayout {
  const copy = JSON.parse(JSON.stringify(layout)) as { panels?: Record<string, { params?: PanelParams; title?: string }> }
  for (const p of Object.values(copy.panels ?? {})) {
    if (p.params?.kind === 'terminal') {
      p.params = { kind: 'terminal' }
      p.title = 'Terminale'
    }
  }
  return copy as SerializedLayout
}

/**
 * Layout iniziali degli spazi predefiniti (L1). Lo spazio Sviluppo ricalca il mockup:
 * terminali e modifiche al centro (l'Esplora file sta nella barra laterale fissa) (i widget arriveranno dopo la 1.0).
 */
export function buildDefaultLayout(api: DockviewApi, spaceId: string): void {
  api.clear()
  // Le dimensioni iniziali di Dockview non sempre vengono rispettate: si fissano dopo aver creato i gruppi.
  const size = (panelId: string, s: { width?: number; height?: number }) => api.getPanel(panelId)?.group.api.setSize(s)
  // Gli spazi dei contesti hanno id come «sviluppo:1a2b3c4d»: conta la parte prima dei due punti.
  switch (spaceId.split(':')[0]) {
    case 'sviluppo': {
      // Solo il terminale: la revisione delle modifiche sta nel suo cassetto a destra (si apre da sola alla prima modifica).
      // In modalità Bolle il workspace parte vuoto: Claude sta nelle bolle.
      if (isBubbleMode()) break
      const term = addPanel(api, 'terminal')
      api.getPanel(term)?.api.setActive()
      break
    }
    case 'revisione': {
      const changes = addPanel(api, 'changes')
      if (!isBubbleMode()) {
        const term = addPanel(api, 'terminal', { position: { referencePanel: changes, direction: 'right' } })
        size(term, { width: 620 })
      }
      api.getPanel(changes)?.api.setActive()
      break
    }
    case 'debug': {
      if (isBubbleMode()) {
        const editor = addPanel(api, 'editor')
        const problems = addPanel(api, 'problems', { position: { referencePanel: editor, direction: 'right' } })
        size(problems, { width: 380 })
        api.getPanel(editor)?.api.setActive()
        break
      }
      const term = addPanel(api, 'terminal')
      const editor = addPanel(api, 'editor', { position: { referencePanel: term, direction: 'above' } })
      const problems = addPanel(api, 'problems', { position: { referencePanel: term, direction: 'right' } })
      size(problems, { width: 380 })
      size(editor, { height: 280 })
      api.getPanel(term)?.api.setActive()
      break
    }
    default:
      // Spazio nuovo: parte vuoto, la filigrana propone i pannelli da aggiungere.
      break
  }
}
