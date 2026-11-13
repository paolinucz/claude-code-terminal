import { HOST_EVENT_HIVE, HOST_EVENT_NOTIFY, HOST_EVENT_TERMINAL, type InstalledPlugin, type PluginCommand, type PluginPermission } from '@shared/plugins'
import { HOST_EVENT_BROWSER } from '@shared/browser'
import { HOST_EVENT_STATUS_ITEM, extKey, type MenuContext } from '@shared/pluginExt'
import { api } from '@/lib/api'
import type { PanelParams } from '@/panels/kinds'
import { useHives } from '@/state/hives'
import { pluginNotify } from '@/state/pluginUi'
import { useEditor } from '@/state/editor'
import { usePluginExt } from '@/state/pluginExt'
import { useSessions } from '@/state/sessions'
import { useSidebar } from '@/state/sidebar'
import { useWorkspace } from '@/state/workspace'
import { addPanel, hintOf } from '@/workspace/panels'
import { dockRegistry } from '@/workspace/registry'

/**
 * I servizi dell'app per i plugin che non dipendono da una pagina: li usano sia le pagine (`PluginFrame`) sia gli adapter
 * (eventi riservati `$…`) sia la palette. Vedi docs/PLUGIN_API_DOCS.md.
 */
export const findPlugin = (pluginId: string): InstalledPlugin | undefined => useEditor.getState().plugins.find((p) => p.manifest.id === pluginId)
export const pluginName = (pluginId: string) => findPlugin(pluginId)?.manifest.name ?? pluginId
export const hasPermission = (pluginId: string, perm: PluginPermission) => Boolean(findPlugin(pluginId)?.manifest.permissions?.includes(perm))

/** Chiave dell'impostazione di un plugin: le pagine usano nomi corti, l'app li mette nello spazio del plugin. */
export function settingKey(pluginId: string, key: unknown): string {
  if (typeof key !== 'string' || !/^[\w.-]{1,100}$/.test(key)) throw new Error(`Chiave non valida: ${String(key)}`)
  return `plugin.${pluginId}.${key}`
}

/** Mostra il terminale di una sessione in un pannello sotto quello attivo (se non c'è già un pannello che la mostra). */
export function showSessionTerminal(sessionId: string): boolean {
  const info = useSessions.getState().sessions[sessionId]
  const dock = dockRegistry.get(useWorkspace.getState().activeSpaceId)
  if (!info || !dock) return false
  const existing = dock.panels.find((p) => (p.params as { sessionId?: string } | undefined)?.sessionId === sessionId)
  if (existing) {
    existing.api.setActive()
    return true
  }
  const ref = dock.panels.find((p) => (p.params as { kind?: string } | undefined)?.kind === 'terminal') ?? dock.activePanel
  const id = addPanel(dock, 'terminal', {
    title: info.title,
    params: { sessionId, hint: hintOf(info) },
    position: ref ? { referencePanel: ref.id, direction: 'below' } : undefined
  })
  dock.getPanel(id)?.group.api.setSize({ height: 280 })
  return true
}

/** Dati di un gruppo di terminali da un plugin: chiave, titolo ed elenco di sessioni, controllati. */
export function parseHive(pluginId: string, d: Record<string, unknown>): { key: string; title: string; sessionIds: string[]; pluginId: string } | null {
  if (typeof d.key !== 'string' || !/^[\w.:-]{1,80}$/.test(d.key)) return null
  const ids = Array.isArray(d.sessionIds) ? d.sessionIds.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80).slice(0, 24) : []
  // La chiave sta nello spazio del plugin: due plugin non possono prendersi il gruppo l'uno dell'altro.
  return { key: `${pluginId}/${d.key}`, title: typeof d.title === 'string' && d.title ? d.title.slice(0, 80) : 'Terminali', sessionIds: ids, pluginId }
}

/**
 * Mostra un gruppo di terminali nella vista «alveare». Se il pannello c'è già (in qualunque spazio) si aggiorna da solo
 * dall'elenco nuovo; altrimenti se ne apre uno sotto il pannello attivo dello spazio attivo.
 */
export function showHive(h: { key: string; title: string; sessionIds: string[]; pluginId?: string }): boolean {
  useHives.getState().set(h)
  const has = (api: ReturnType<typeof dockRegistry.all>[number]) => api.panels.some((p) => (p.params as PanelParams | undefined)?.hiveKey === h.key)
  if (dockRegistry.all().some(has)) return true
  const dock = dockRegistry.get(useWorkspace.getState().activeSpaceId)
  if (!dock) return false
  const ref = dock.activePanel
  const id = addPanel(dock, 'hive', { title: h.title, params: { hiveKey: h.key }, position: ref ? { referencePanel: ref.id, direction: 'below' } : undefined })
  dock.getPanel(id)?.group.api.setSize({ height: 460 })
  return true
}

/** Mostra il pannello di una vista del browser integrato (se c'è già, in qualunque spazio, la porta in primo piano). */
export function showBrowser(b: { id: string; title: string }): boolean {
  const has = (d: ReturnType<typeof dockRegistry.all>[number]) => d.panels.find((p) => (p.params as PanelParams | undefined)?.browserId === b.id)
  for (const d of dockRegistry.all()) {
    const found = has(d)
    if (found) {
      found.api.setActive()
      return true
    }
  }
  const dock = dockRegistry.get(useWorkspace.getState().activeSpaceId)
  if (!dock) return false
  // Accanto all'editor, se c'è; altrimenti a destra del pannello attivo.
  const ref = dock.panels.find((p) => (p.params as PanelParams | undefined)?.kind === 'editor') ?? dock.activePanel
  addPanel(dock, 'browser', { title: b.title, params: { browserId: b.id }, position: ref ? { referencePanel: ref.id, direction: 'right' } : undefined })
  return true
}

/** Esegue un comando della palette contribuito da un plugin. */
export function runPluginCommand(pluginId: string, cmd: PluginCommand, context?: MenuContext): void {
  if (cmd.openView) {
    useSidebar.getState().show(`${pluginId}:${cmd.openView}`)
    return
  }
  if (cmd.method) {
    api.plugins.call(pluginId, cmd.method, { command: cmd.id, ...(context ? { context } : {}) }).catch((e: Error) => pluginNotify(pluginName(pluginId), e.message, 'error'))
  }
}

/** La sessione appena creata può arrivare all'interfaccia un attimo dopo l'evento dell'adapter: si riprova per ~2 secondi. */
function showWhenKnown(sessionId: string, attempt = 0): void {
  if (!showSessionTerminal(sessionId) && attempt < 20) window.setTimeout(() => showWhenKnown(sessionId, attempt + 1), 100)
}

let started = false

/** Eventi riservati degli adapter (`app.notify`, `app.terminal.show`): l'app li esegue e non li passa alle pagine. */
export function startPluginBridge(): void {
  if (started) return
  started = true
  api.plugins.onEvent((e) => {
    const d = (e.data ?? {}) as Record<string, unknown>
    if (e.event === HOST_EVENT_NOTIFY) pluginNotify(pluginName(e.pluginId), d.message, d.kind)
    else if (e.event === HOST_EVENT_STATUS_ITEM && typeof d.id === 'string') {
      const { id, ...patch } = d
      usePluginExt.getState().patchStatus(extKey(e.pluginId, String(id)), patch)
    } else if (e.event === HOST_EVENT_TERMINAL &&hasPermission(e.pluginId, 'terminal')) showWhenKnown(String(d.sessionId ?? ''))
    else if (e.event === HOST_EVENT_BROWSER && hasPermission(e.pluginId, 'browser') && typeof d.id === 'string' && d.id.startsWith(`${e.pluginId}/`)) {
      showBrowser({ id: d.id, title: typeof d.title === 'string' ? d.title : 'Browser' })
    } else if (e.event === HOST_EVENT_HIVE && hasPermission(e.pluginId, 'terminal')) {
      const hive = parseHive(e.pluginId, d)
      if (hive) showHive(hive)
    }
  })
}
