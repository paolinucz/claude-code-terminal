import { create } from 'zustand'
import type { StatusItemPatch } from '@shared/pluginExt'

/**
 * Stato dinamico degli elementi che i plugin aggiungono all'interfaccia (Plugin API v2, docs/plugin-estensioni.md).
 * La dichiarazione (dove compare, quale comando) sta nel manifest; qui c'è solo quello che l'adapter aggiorna mentre gira.
 */
interface PluginExtStore {
  /** Barra di stato: `<id-plugin>/<id>` → ultimo stato mandato dall'adapter. */
  status: Record<string, StatusItemPatch>
  patchStatus(key: string, patch: StatusItemPatch): void
  /** Dimentica gli elementi di un plugin (disattivato o disinstallato). */
  clearPlugin(pluginId: string): void
}

export const usePluginExt = create<PluginExtStore>((set) => ({
  status: {},
  patchStatus: (key, patch) => set((s) => ({ status: { ...s.status, [key]: { ...s.status[key], ...patch } } })),
  clearPlugin: (pluginId) =>
    set((s) => ({ status: Object.fromEntries(Object.entries(s.status).filter(([k]) => !k.startsWith(`${pluginId}/`))) }))
}))
