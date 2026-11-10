import { useEffect } from 'react'
import { Splash } from '@/components/Splash'
import { Toasts } from '@/components/Toasts'
import { preloadAll } from '@/lib/preload'
import { trackBoot } from '@/state/boot'
import { useSheetColors } from '@/state/sheetColors'
import { PluginUi } from '@/components/PluginUi'
import { FileOpsDialogs } from '@/files/FileOpsDialogs'
import { startPluginBridge } from '@/plugins/pluginBridge'
import { useChanges } from '@/state/changes'
import { useEditor } from '@/state/editor'
import { useSessions } from '@/state/sessions'
import { useTerminalSettings } from '@/state/terminalSettings'
import { useWorkspace } from '@/state/workspace'
import { startPluginGutter } from '@/state/pluginGutter'
import { useRecent } from '@/state/recent'
import { useSidebar } from '@/state/sidebar'
import { ActivityBar, SideBarPanel } from '@/workspace/SideBar'
import { SheetTabs } from '@/workspace/SheetTabs'
import { SheetView } from '@/workspace/SheetView'
import { TopBar } from '@/workspace/TopBar'

export function App() {
  const { loaded, sheets, activeSheetId, load } = useWorkspace()

  useEffect(() => {
    // Ogni caricamento che serve per partire si registra: la schermata iniziale ne mostra l'avanzamento.
    void trackBoot('workspace', 'Spazio di lavoro', load())
    void trackBoot('sessions', 'Sessioni', useSessions.getState().init())
    void trackBoot('terminal', 'Impostazioni del terminale', useTerminalSettings.getState().load())
    void trackBoot('changes', 'Modifiche di Claude', useChanges.getState().init())
    void trackBoot('sidebar', 'Barra laterale', useSidebar.getState().load())
    void trackBoot('recent', 'File recenti', useRecent.getState().load())
    void trackBoot('colors', 'Colori dei fogli', useSheetColors.getState().load())
    startPluginGutter()
    startPluginBridge()
    void trackBoot('plugins', 'Plugin', useEditor.getState().init())
    // Quello che altrimenti si carica alla prima apertura (editor, confronto, icone, shell, adapter dei plugin).
    preloadAll()
  }, [load])

  // La schermata iniziale sta sopra a tutto e dura finché i caricamenti registrati non sono finiti (vedi state/boot.ts).
  return (
    <>
    {loaded && (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <SideBarPanel />
        <main className="relative min-h-0 min-w-0 flex-1" aria-label="Pannelli del foglio">
          {sheets.map((sheet) => (
            <SheetView key={sheet.id} sheet={sheet} active={sheet.id === activeSheetId} />
          ))}
        </main>
      </div>
      <SheetTabs />
      <Toasts />
      <PluginUi />
      <FileOpsDialogs />
    </div>
    )}
    <Splash />
    </>
  )
}
