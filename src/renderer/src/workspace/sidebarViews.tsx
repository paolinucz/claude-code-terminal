import { create } from 'zustand'
import type { ReactNode } from 'react'
import { FolderTree, Search } from 'lucide-react'
import { ExplorerView } from '@/files/ExplorerView'
import { SearchView } from '@/files/SearchView'
import { useMemo } from 'react'
import { pluginUiUrl } from '@shared/plugins'
import { EMPTY_DECOR, PluginFrame } from '@/plugins/PluginFrame'
import { useEditor } from '@/state/editor'
import { useSidebar } from '@/state/sidebar'

/**
 * Una vista della barra laterale fissa. Quelle dell'app sono qui sotto; i widget installati (fase 7, pacchetti
 * `.ccwidget` isolati) si registreranno con `registerSidebarView`: un'icona nella barra e il loro pannello.
 */
export interface SidebarView {
  id: string
  title: string
  icon: ReactNode
  /** Scorciatoia mostrata nel suggerimento. */
  shortcut?: string
  render(): ReactNode
}

const BUILTIN: SidebarView[] = [
  { id: 'explorer', title: 'Esplora file', icon: <FolderTree size={20} strokeWidth={1.6} />, shortcut: 'Ctrl+Maiusc+E', render: () => <ExplorerView /> },
  { id: 'search', title: 'Cerca', icon: <Search size={20} strokeWidth={1.6} />, shortcut: 'Ctrl+Maiusc+F', render: () => <SearchView /> }
]

interface ViewsStore {
  extra: SidebarView[]
}

const useExtraViews = create<ViewsStore>(() => ({ extra: [] }))

/** Aggiunge (o sostituisce) una vista; restituisce la funzione che la toglie. */
export function registerSidebarView(view: SidebarView): () => void {
  useExtraViews.setState((s) => ({ extra: [...s.extra.filter((v) => v.id !== view.id), view] }))
  return () => useExtraViews.setState((s) => ({ extra: s.extra.filter((v) => v.id !== view.id) }))
}

/** Pagina di un plugin nella barra laterale: lavora nella cartella dell'Esplora file. */
function PluginSidebarPage({ pluginId, entry }: { pluginId: string; entry: string }) {
  const cwd = useSidebar((s) => s.explorerCwd)
  return <PluginFrame pluginId={pluginId} entry={entry} cwd={cwd} decor={EMPTY_DECOR} />
}

/** Viste che i plugin attivi aggiungono alla barra laterale (contributi `sidebarViews`). */
export function usePluginSidebarViews(): SidebarView[] {
  const plugins = useEditor((s) => s.plugins)
  return useMemo(
    () =>
      plugins
        .filter((p) => p.enabled && p.state === 'ok')
        .flatMap((p) =>
          (p.manifest.contributes?.sidebarViews ?? []).map((v) => ({
            id: `${p.manifest.id}:${v.id}`,
            title: v.title,
            shortcut: v.shortcut,
            icon: v.icon ? <img src={pluginUiUrl(p.manifest.id, v.icon)} alt="" aria-hidden="true" className="size-6" draggable={false} /> : <FolderTree size={20} strokeWidth={1.6} />,
            render: () => <PluginSidebarPage pluginId={p.manifest.id} entry={v.entry} />
          }))
        ),
    [plugins]
  )
}

/** Viste in ordine: prima quelle dell'app, poi i widget. */
export function useSidebarViews(): SidebarView[] {
  const extra = useExtraViews((s) => s.extra)
  const fromPlugins = usePluginSidebarViews()
  return [...BUILTIN, ...fromPlugins, ...extra]
}
