import { create } from 'zustand'
import type { ReactNode } from 'react'
import { FolderTree, Search } from 'lucide-react'
import { FileIcon } from '@/lib/fileIcons'
import { ExplorerView } from '@/files/ExplorerView'
import { SearchView } from '@/files/SearchView'
import { JavaView } from '@/java/JavaView'
import { useJavaDev } from '@/state/javaDev'

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

/** Viste in ordine: prima quelle dell'app, poi i widget. */
export function useSidebarViews(): SidebarView[] {
  const extra = useExtraViews((s) => s.extra)
  // «Esegui e debug» compare solo con il Java development pack installato e attivo.
  const javaOn = useJavaDev((s) => s.state?.enabled === true)
  const java: SidebarView[] = javaOn ? [{ id: 'java', title: 'Esegui e debug', icon: <FileIcon name="Main.java" size={24} />, shortcut: 'Ctrl+Maiusc+D', render: () => <JavaView /> }] : []
  return [...BUILTIN, ...java, ...extra]
}
