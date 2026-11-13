import { useMemo } from 'react'
import { extKey, type StatusItemPatch } from '@shared/pluginExt'
import type { PluginStatusItem } from '@shared/pluginExt'
import type { PluginCommand } from '@shared/plugins'
import { isPluginActive } from '@/plugins/extensions'
import { runPluginCommand } from '@/plugins/pluginBridge'
import { useEditor } from '@/state/editor'
import { usePluginExt } from '@/state/pluginExt'

const DOT: Record<NonNullable<StatusItemPatch['tone']>, string> = {
  neutral: 'bg-text-faint',
  ok: 'bg-ok',
  warn: 'bg-amber-500',
  error: 'bg-danger',
  busy: 'bg-info animate-pulse'
}

interface Entry {
  key: string
  pluginId: string
  pluginName: string
  item: PluginStatusItem
  command?: PluginCommand
}

/**
 * Barra di stato dell'app per i plugin (Plugin API v2, `contributes.statusBar`). Il plugin dichiara gli elementi nel manifest
 * e ne aggiorna testo e stato con `app.ui.statusItem`; l'app li disegna. Senza elementi visibili la barra non c'è.
 */
export function PluginStatusBar() {
  const plugins = useEditor((s) => s.plugins)
  const status = usePluginExt((s) => s.status)
  const entries = useMemo<Entry[]>(
    () =>
      plugins.filter(isPluginActive).flatMap((p) =>
        (p.manifest.contributes?.statusBar ?? []).map((item) => ({
          key: extKey(p.manifest.id, item.id),
          pluginId: p.manifest.id,
          pluginName: p.manifest.name,
          item,
          command: (p.manifest.contributes?.commands ?? []).find((c) => c.id === item.command)
        }))
      ),
    [plugins]
  )
  const shown = entries
    .map((e) => ({ ...e, s: { text: e.item.text, tooltip: e.item.tooltip, ...status[e.key] } as StatusItemPatch }))
    .filter((e) => e.s.visible !== false && (e.s.text ?? '') !== '')
  if (!shown.length) return null
  const side = (align: 'left' | 'right') => shown.filter((e) => (e.item.align ?? 'left') === align)
  const render = (e: (typeof shown)[number]) => {
    const body = (
      <>
        {e.s.tone && <span className={`size-1.5 shrink-0 rounded-full ${DOT[e.s.tone]}`} aria-hidden />}
        <span className="truncate">{e.s.text}</span>
      </>
    )
    const title = `${e.pluginName}${e.s.tooltip ? ` — ${e.s.tooltip}` : ''}`
    const cls = 'inline-flex h-5 max-w-[260px] items-center gap-1.5 rounded px-1.5 text-[11px] text-text-muted'
    return e.command ? (
      <button key={e.key} type="button" title={title} onClick={() => runPluginCommand(e.pluginId, e.command!)} className={`${cls} transition-colors hover:bg-surface hover:text-foreground`}>
        {body}
      </button>
    ) : (
      <span key={e.key} title={title} className={cls}>
        {body}
      </span>
    )
  }
  return (
    <div className="flex h-6 shrink-0 items-center justify-between gap-2 border-t border-border px-2" role="status" aria-label="Barra di stato dei plugin">
      <div className="flex min-w-0 items-center gap-1">{side('left').map(render)}</div>
      <div className="flex min-w-0 items-center gap-1">{side('right').map(render)}</div>
    </div>
  )
}
