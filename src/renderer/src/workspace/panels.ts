import type { AddPanelOptions, DockviewApi } from 'dockview-react'
import { PANEL_KINDS, type PanelKind, type PanelParams } from '@/panels/kinds'

let counter = 0

/** Aggiunge un pannello di un certo tipo. Senza posizione lo mette come scheda nel gruppo attivo. */
export function addPanel(
  api: DockviewApi,
  kind: PanelKind,
  options: { title?: string; position?: AddPanelOptions['position']; initialWidth?: number; initialHeight?: number } = {}
): string {
  const id = `${kind}-${Date.now().toString(36)}-${(counter++).toString(36)}`
  const params: PanelParams = { kind }
  api.addPanel<PanelParams>({
    id,
    component: 'placeholder',
    title: options.title ?? PANEL_KINDS[kind].title,
    params,
    position: options.position,
    initialWidth: options.initialWidth,
    initialHeight: options.initialHeight
  })
  return id
}

/** Nome per un nuovo terminale: «Terminale 2», «Terminale 3»… */
export function nextTerminalTitle(api: DockviewApi): string {
  const used = new Set(api.panels.map((p) => p.title))
  let n = 1
  while (used.has(n === 1 ? 'Terminale' : `Terminale ${n}`)) n++
  return n === 1 ? 'Terminale' : `Terminale ${n}`
}

/**
 * Layout iniziali dei fogli predefiniti (L1). Il foglio Sviluppo ricalca il mockup:
 * esplora file a sinistra, terminali e modifiche al centro, widget a destra.
 */
export function buildDefaultLayout(api: DockviewApi, sheetId: string): void {
  api.clear()
  switch (sheetId) {
    case 'sviluppo': {
      const term = addPanel(api, 'terminal', { title: 'api-server' })
      addPanel(api, 'terminal', { title: 'test-ordini', position: { referencePanel: term, direction: 'within' } })
      addPanel(api, 'explorer', { position: { referencePanel: term, direction: 'left' }, initialWidth: 260 })
      addPanel(api, 'widgets', { position: { referencePanel: term, direction: 'right' }, initialWidth: 330 })
      addPanel(api, 'changes', { position: { referencePanel: term, direction: 'below' }, initialHeight: 360 })
      api.getPanel(term)?.api.setActive()
      break
    }
    case 'revisione': {
      const changes = addPanel(api, 'changes')
      addPanel(api, 'terminal', { title: 'review', position: { referencePanel: changes, direction: 'right' }, initialWidth: 520 })
      addPanel(api, 'explorer', { position: { referencePanel: changes, direction: 'left' }, initialWidth: 260 })
      api.getPanel(changes)?.api.setActive()
      break
    }
    case 'debug': {
      const term = addPanel(api, 'terminal', { title: 'debug' })
      addPanel(api, 'editor', { position: { referencePanel: term, direction: 'above' } })
      addPanel(api, 'problems', { position: { referencePanel: term, direction: 'right' }, initialWidth: 380 })
      addPanel(api, 'explorer', { position: { direction: 'left' }, initialWidth: 260 })
      api.getPanel(term)?.api.setActive()
      break
    }
    default:
      // Foglio nuovo: parte vuoto, la filigrana propone i pannelli da aggiungere.
      break
  }
}
