import { useEffect } from 'react'
import { Splash } from '@/components/Splash'
import { Toasts } from '@/components/Toasts'
import { preloadAll } from '@/lib/preload'
import { trackBoot } from '@/state/boot'
import { AppBackground } from '@/components/AppBackground'
import { PluginUi } from '@/components/PluginUi'
import { FileOpsDialogs } from '@/files/FileOpsDialogs'
import { startPluginBridge } from '@/plugins/pluginBridge'
import { useAppearance } from '@/state/appearance'
import { useFullScreen } from '@/state/fullscreen'
import { useChanges } from '@/state/changes'
import { useEditor } from '@/state/editor'
import { useSessions } from '@/state/sessions'
import { useTerminalSettings } from '@/state/terminalSettings'
import { SOLO_SPACE_ID, useWorkspace } from '@/state/workspace'
import { startPluginGutter } from '@/state/pluginGutter'
import { startReviewAutoOpen } from '@/state/review'
import { startBots } from '@/state/bots'
import { BotBubbles } from '@/workspace/BotBubbles'
import { useRecent } from '@/state/recent'
import { useSidebar } from '@/state/sidebar'
import { ActivityBar, SideBarPanel } from '@/workspace/SideBar'
import { PluginStatusBar } from '@/workspace/PluginStatusBar'
import { SpaceView } from '@/workspace/SpaceView'
import { ExternalSpace } from '@/workspace/ExternalSpace'
import { SoloHeader } from '@/workspace/SoloHeader'
import { api } from '@/lib/api'
import { useProject } from '@/state/project'
import { SpaceOverview } from '@/workspace/SpaceOverview'
import { TopBar } from '@/workspace/TopBar'

export function App() {
  const { loaded, spaces, activeSpaceId, externalSpaces, load } = useWorkspace()
  // Nella finestra di uno spazio la barra principale non c'è: il progetto lo carica SoloHeader, e gli spazi si montano dopo,
  // altrimenti i pannelli proporrebbero la cartella prima di sapere qual è quella del progetto.
  const projectReady = useProject((s) => s.ready)
  // La modalità di Claude (schede o bolle) decide i layout iniziali: gli spazi si montano solo dopo averla letta.
  const appearanceReady = useAppearance((s) => s.ready)

  useEffect(() => {
    // Ogni caricamento che serve per partire si registra: la schermata iniziale ne mostra l'avanzamento.
    void trackBoot('workspace', 'Spazio di lavoro', load())
    void trackBoot('sessions', 'Sessioni', useSessions.getState().init())
    void trackBoot('terminal', 'Impostazioni del terminale', useTerminalSettings.getState().load())
    void trackBoot('changes', 'Modifiche di Claude', useChanges.getState().init())
    void trackBoot('appearance', 'Aspetto', useAppearance.getState().load())
    void trackBoot('sidebar', 'Barra laterale', useSidebar.getState().load())
    void trackBoot('recent', 'File recenti', useRecent.getState().load())
    useFullScreen.getState().init()
    startPluginGutter()
    startReviewAutoOpen()
    startBots()
    startPluginBridge()
    void trackBoot('plugins', 'Plugin', useEditor.getState().init())
    // Quello che altrimenti si carica alla prima apertura (editor, confronto, icone, shell, adapter dei plugin).
    preloadAll()
    // Finestra di uno spazio: niente TopBar che carichi il progetto, lo si avvia qui (è idempotente).
    if (SOLO_SPACE_ID) useProject.getState().init()
    // Spazi aperti in un'altra finestra: qui il loro Dockview non si monta.
    return api.windows.onSpaces((ids) => void useWorkspace.getState().setExternalSpaces(ids))
  }, [load])

  // La schermata iniziale sta sopra a tutto e dura finché i caricamenti registrati non sono finiti (vedi state/boot.ts).
  return (
    <>
    <AppBackground />
    {loaded && appearanceReady && (!SOLO_SPACE_ID || projectReady) && (
    <div className="relative z-10 flex h-full flex-col">
      {SOLO_SPACE_ID ? <SoloHeader /> : <TopBar />}
      <div className="flex min-h-0 flex-1">
        {!SOLO_SPACE_ID && <ActivityBar />}
        {!SOLO_SPACE_ID && <SideBarPanel />}
        <main className="relative min-h-0 min-w-0 flex-1" aria-label="Pannelli dello spazio">
          {spaces
            .filter((space) => !SOLO_SPACE_ID || space.id === SOLO_SPACE_ID)
            .map((space) =>
              !SOLO_SPACE_ID && externalSpaces.includes(space.id) ? (
                <ExternalSpace key={space.id} space={space} active={space.id === activeSpaceId} />
              ) : (
                <SpaceView key={space.id} space={space} active={space.id === activeSpaceId} />
              )
            )}
        </main>
      </div>
      <PluginStatusBar />
      <Toasts />
      <PluginUi />
      <FileOpsDialogs />
      {!SOLO_SPACE_ID && <SpaceOverview />}
      {!SOLO_SPACE_ID && <BotBubbles />}
    </div>
    )}
    <Splash />
    </>
  )
}
