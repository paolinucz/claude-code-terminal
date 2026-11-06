import type { AddPanelOptions, DockviewApi, DockviewPanelApi, IDockviewPanel } from 'dockview-react'
import type { SessionInfo } from '@shared/sessions'
import type { SerializedLayout } from '@shared/types'
import { PANEL_KINDS, type PanelKind, type PanelParams, type SessionHint } from '@/panels/kinds'
import { useWorkspace } from '@/state/workspace'
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

/** Apre una vista su una sessione nel foglio indicato (S9: agganciata, fluttuante o in una finestra separata). */
export function openSessionView(api: DockviewApi, session: SessionInfo, placement: Placement = 'dock'): IDockviewPanel | undefined {
  const id = addPanel(api, 'terminal', { title: session.title, params: { sessionId: session.id, hint: hintOf(session) } })
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

/**
 * «Invia a…» (S4) e trascinamento tra fogli (S5): la vista passa nell'altro foglio.
 * La sessione non si interrompe: si chiude solo la vista di partenza.
 */
export function moveTerminalToSheet(fromSheetId: string, panelId: string, toSheetId: string): boolean {
  const from = dockRegistry.get(fromSheetId)
  const to = dockRegistry.get(toSheetId)
  const panel = from?.getPanel(panelId)
  if (!from || !to || !panel || fromSheetId === toSheetId) return false
  const params = (panel.params ?? {}) as PanelParams
  addPanel(to, 'terminal', { title: panel.title ?? 'Terminale', params: { sessionId: params.sessionId, hint: params.hint } })
  panel.api.close()
  return true
}

/** In quali fogli è aperta ogni sessione (per «Collega» e per gli avvisi). */
export function sessionLocations(): Map<string, string[]> {
  const { sheets } = useWorkspace.getState()
  const out = new Map<string, string[]>()
  for (const sheet of sheets) {
    const dock = dockRegistry.get(sheet.id)
    if (!dock) continue
    for (const p of dock.panels) {
      const id = (p.params as PanelParams | undefined)?.sessionId
      if (!id) continue
      const list = out.get(id) ?? []
      if (!list.includes(sheet.name)) list.push(sheet.name)
      out.set(id, list)
    }
  }
  return out
}

/** Trova il foglio che contiene un pannello. */
export function sheetOfPanel(api: DockviewApi): string | undefined {
  // Dockview può passare oggetti API diversi per la stessa istanza: si confronta l'id.
  return useWorkspace.getState().sheets.find((s) => dockRegistry.get(s.id)?.id === api.id)?.id
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
 * Layout iniziali dei fogli predefiniti (L1). Il foglio Sviluppo ricalca il mockup:
 * esplora file a sinistra, terminali e modifiche al centro, widget a destra.
 */
export function buildDefaultLayout(api: DockviewApi, sheetId: string): void {
  api.clear()
  // Le dimensioni iniziali di Dockview non sempre vengono rispettate: si fissano dopo aver creato i gruppi.
  const size = (panelId: string, s: { width?: number; height?: number }) => api.getPanel(panelId)?.group.api.setSize(s)
  switch (sheetId) {
    case 'sviluppo': {
      const term = addPanel(api, 'terminal')
      const explorer = addPanel(api, 'explorer', { position: { referencePanel: term, direction: 'left' } })
      const widgets = addPanel(api, 'widgets', { position: { referencePanel: term, direction: 'right' } })
      const changes = addPanel(api, 'changes', { position: { referencePanel: term, direction: 'below' } })
      size(explorer, { width: 260 })
      size(widgets, { width: 330 })
      size(changes, { height: 300 })
      api.getPanel(term)?.api.setActive()
      break
    }
    case 'revisione': {
      const changes = addPanel(api, 'changes')
      const term = addPanel(api, 'terminal', { position: { referencePanel: changes, direction: 'right' } })
      const explorer = addPanel(api, 'explorer', { position: { referencePanel: changes, direction: 'left' } })
      size(explorer, { width: 260 })
      size(term, { width: 620 })
      api.getPanel(changes)?.api.setActive()
      break
    }
    case 'debug': {
      const term = addPanel(api, 'terminal')
      const editor = addPanel(api, 'editor', { position: { referencePanel: term, direction: 'above' } })
      const problems = addPanel(api, 'problems', { position: { referencePanel: term, direction: 'right' } })
      const explorer = addPanel(api, 'explorer', { position: { direction: 'left' } })
      size(explorer, { width: 260 })
      size(problems, { width: 380 })
      size(editor, { height: 280 })
      api.getPanel(term)?.api.setActive()
      break
    }
    default:
      // Foglio nuovo: parte vuoto, la filigrana propone i pannelli da aggiungere.
      break
  }
}
