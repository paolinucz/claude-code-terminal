import { create } from 'zustand'
import { normPath } from '@shared/files'
import type { GutterMarker } from '@shared/plugins'
import { api } from '@/lib/api'
import { openFile } from '@/state/editor'

/** Segni nel margine dell'editor mandati dai plugin: plugin → file (percorso normalizzato) → segni. */
interface GutterStore {
  markers: Record<string, Record<string, GutterMarker[]>>
  set(pluginId: string, path: string | null, markers: GutterMarker[]): void
}

export const usePluginGutter = create<GutterStore>((set) => ({
  markers: {},
  set(pluginId, path, markers) {
    set((s) => {
      const mine = path === null ? {} : { ...(s.markers[pluginId] ?? {}) }
      if (path !== null) {
        if (markers.length) mine[normPath(path)] = markers
        else delete mine[normPath(path)]
      }
      return { markers: { ...s.markers, [pluginId]: mine } }
    })
  }
}))

let started = false
const revealed = new Map<string, string>()

/** Riceve i segni dei plugin; un segno con `reveal` apre il file sulla riga (una volta per cambiamento). */
export function startPluginGutter(): void {
  if (started) return
  started = true
  api.plugins.onMarkers((u) => {
    usePluginGutter.getState().set(u.pluginId, u.path, u.markers)
    const r = u.path ? u.markers.find((m) => m.reveal) : undefined
    if (!u.path || !r) {
      // Il programma riparte (o i segni sono stati tolti): la prossima sosta, anche sulla stessa riga, riapre il file.
      const last = revealed.get(u.pluginId)
      if (u.path === null || (last && u.path && last.startsWith(normPath(u.path) + ':'))) revealed.delete(u.pluginId)
      return
    }
    const sig = `${normPath(u.path)}:${r.line}`
    if (revealed.get(u.pluginId) === sig) return
    revealed.set(u.pluginId, sig)
    openFile(u.path, { line: r.line, column: 1 })
  })
}
