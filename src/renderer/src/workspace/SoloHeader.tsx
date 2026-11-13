import { useEffect } from 'react'
import { useAccent } from '@/state/accent'
import { useDocs } from '@/state/docs'
import { useExplainSettings } from '@/state/explain'
import { usePresets } from '@/state/presets'
import { useProject } from '@/state/project'
import { useFullScreen, windowControlsWidth } from '@/state/fullscreen'
import { SOLO_SPACE_ID, useWorkspace } from '@/state/workspace'
import { SpaceIcon } from './SpaceChips'


/**
 * Barra della finestra di un solo spazio («Apri in una nuova finestra»): nome dello spazio e un pulsante per riportarlo nella
 * finestra principale. L'area vuota trascina la finestra.
 */
export function SoloHeader() {
  const space = useWorkspace((s) => s.spaces.find((x) => x.id === SOLO_SPACE_ID))
  const fullScreen = useFullScreen((s) => s.on)
  // Quello che nella finestra principale parte dalla barra in alto (TopBar) e che i pannelli dello spazio danno per scontato:
  // il progetto (la cartella di lavoro di terminali ed Esplora file viene da lì), i documenti, l'accento, i prompt predefiniti.
  useEffect(() => {
    useProject.getState().init()
    useDocs.getState().init()
    void useAccent.getState().load()
    void usePresets.getState().load()
    void useExplainSettings.getState().load()
  }, [])
  return (
    <div className="app-drag mg-glass-1 relative z-30 shrink-0 border-x-0 border-t-0" style={{ paddingRight: windowControlsWidth(fullScreen) || 10 }}>
      <header className="flex h-12 items-center gap-3 px-3">
        {space && <SpaceIcon space={space} />}
        <span className="text-[13px] font-semibold text-foreground">{space?.name ?? 'Spazio'}</span>
        <span className="text-[12px] text-text-faint">· finestra dello spazio</span>
        <div className="min-w-12 flex-1 self-stretch" aria-hidden="true" />
        <button type="button" onClick={() => window.close()} className="app-no-drag h-8 rounded-lg border border-border px-3 text-[13px] text-text-muted hover:bg-border hover:text-foreground" title="Chiude questa finestra: lo spazio torna nella finestra principale">
          Riporta nella finestra principale
        </button>
      </header>
    </div>
  )
}
