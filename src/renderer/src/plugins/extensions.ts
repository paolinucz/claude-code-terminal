import { evalWhen, type MenuContext, type PluginMenuId } from '@shared/pluginExt'
import type { InstalledPlugin, PluginCommand } from '@shared/plugins'
import { runPluginCommand } from '@/plugins/pluginBridge'

/**
 * Registro dei contributi ai menu (Plugin API v2): trasforma i `contributes.menus` dei plugin attivi nelle voci di un menu,
 * già filtrate dalla condizione `when` sul contesto di quel momento. I menu dell'app (Esplora file, editor, terminale)
 * chiamano `menuItems` e disegnano le voci con i propri componenti: un plugin non disegna niente.
 */
export interface ResolvedMenuItem {
  key: string
  pluginId: string
  pluginName: string
  command: PluginCommand
  group: string
}

export const isPluginActive = (p: InstalledPlugin) => p.enabled && p.state === 'ok'

export function menuItems(plugins: InstalledPlugin[], menu: PluginMenuId, ctx: MenuContext): ResolvedMenuItem[] {
  const out: ResolvedMenuItem[] = []
  for (const p of plugins) {
    if (!isPluginActive(p)) continue
    const commands = p.manifest.contributes?.commands ?? []
    for (const item of p.manifest.contributes?.menus?.[menu] ?? []) {
      const command = commands.find((c) => c.id === item.command)
      if (!command || !evalWhen(item.when, ctx)) continue
      out.push({ key: `${p.manifest.id}/${menu}/${item.command}`, pluginId: p.manifest.id, pluginName: p.manifest.name, command, group: item.group ?? 'z' })
    }
  }
  // Per gruppo e, dentro il gruppo, per plugin e titolo: l'ordine non cambia da un'apertura all'altra.
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.pluginName.localeCompare(b.pluginName) || a.command.title.localeCompare(b.command.title))
}

/** Esegue una voce: l'adapter riceve `{command, context}` con gli stessi valori usati per la condizione. */
export function runMenuItem(item: ResolvedMenuItem, ctx: MenuContext): void {
  runPluginCommand(item.pluginId, item.command, ctx)
}

/** Contesto di un file o una cartella (Esplora file, editor). */
export function resourceContext(path: string): MenuContext {
  const name = path.split(/[\\/]/).pop() ?? path
  const dot = name.lastIndexOf('.')
  return { resourcePath: path, resourceName: name, resourceExt: dot > 0 ? name.slice(dot) : '' }
}
