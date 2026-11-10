import { HOST_EVENT_NOTIFY, HOST_EVENT_TERMINAL, type InstalledPlugin, type PluginCommand, type PluginPermission } from '@shared/plugins'
import { api } from '@/lib/api'
import { pluginNotify } from '@/state/pluginUi'
import { useEditor } from '@/state/editor'
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
  const dock = dockRegistry.get(useWorkspace.getState().activeSheetId)
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

/** Esegue un comando della palette contribuito da un plugin. */
export function runPluginCommand(pluginId: string, cmd: PluginCommand): void {
  if (cmd.openView) {
    useSidebar.getState().show(`${pluginId}:${cmd.openView}`)
    return
  }
  if (cmd.method) {
    api.plugins.call(pluginId, cmd.method, { command: cmd.id }).catch((e: Error) => pluginNotify(pluginName(pluginId), e.message, 'error'))
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
    else if (e.event === HOST_EVENT_TERMINAL && hasPermission(e.pluginId, 'terminal')) showWhenKnown(String(d.sessionId ?? ''))
  })
}
