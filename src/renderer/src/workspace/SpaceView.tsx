import { useCallback, useEffect, useRef } from 'react'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type SerializedDockview } from 'dockview-react'
import type { Space } from '@shared/types'
import { api } from '@/lib/api'
import { PanelHost } from '@/panels/PanelHost'
import { PanelTab } from '@/panels/PanelTab'
import { useWorkspace } from '@/state/workspace'
import { GroupActions } from './GroupActions'
import { EmptySpace } from './EmptySpace'
import { buildDefaultLayout, removeHiddenPanels } from './panels'
import { dockRegistry } from './registry'
import { cctDockTheme } from './theme'

const components = { placeholder: PanelHost }

const SAVE_DELAY_MS = 400

/** URL della pagina vuota usata da Dockview per le finestre staccate (L4). Funziona sia in dev sia da file://. */
const popoutUrl = new URL('popout.html', window.location.href).href

/** Uno spazio: un'istanza Dockview indipendente, con salvataggio automatico della disposizione (L5). */
export function SpaceView({ space, active }: { space: Space; active: boolean }) {
  const setPanelCount = useWorkspace((s) => s.setPanelCount)
  const saveTimer = useRef<number | undefined>(undefined)
  /** Salvataggio del layout in attesa: si esegue subito se lo spazio si smonta o la finestra si chiude (passaggio tra finestre). */
  const pendingSave = useRef<(() => void) | null>(null)
  const dockRef = useRef<DockviewApi | null>(null)
  const spaceRef = useRef(space)
  spaceRef.current = space

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      // In StrictMode (sviluppo) Dockview crea l'istanza due volte: vale sempre l'ultima.
      const dock = event.api
      dockRef.current = dock
      dockRegistry.set(space.id, dock)

      let restored = false
      if (space.layout) {
        try {
          dock.fromJSON(space.layout as unknown as SerializedDockview)
          removeHiddenPanels(dock)
          restored = true
        } catch (err) {
          console.warn(`Layout dello spazio «${space.name}» non valido, uso quello predefinito`, err)
        }
      }
      if (!restored) buildDefaultLayout(dock, space.id)
      const sigOf = () => dock.panels.map((p) => (p.params as { sessionId?: string } | undefined)?.sessionId ?? '').sort().join('|')
      setPanelCount(space.id, dock.panels.length, sigOf())

      dock.onDidLayoutChange(() => {
        if (dockRef.current !== dock) return
        setPanelCount(space.id, dock.panels.length, sigOf())
        window.clearTimeout(saveTimer.current)
        const save = () => {
          pendingSave.current = null
          void api.workspace.saveSpaceLayout(space.id, dock.toJSON() as unknown as Record<string, unknown>)
        }
        pendingSave.current = save
        saveTimer.current = window.setTimeout(save, SAVE_DELAY_MS)
      })
    },
    // L'istanza Dockview nasce una volta sola per spazio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [space.id]
  )

  useEffect(() => {
    // Rimonta (StrictMode) senza nuovo onReady: l'istanza è la stessa, va solo registrata di nuovo.
    if (dockRef.current) dockRegistry.set(space.id, dockRef.current)
    const flush = () => pendingSave.current?.()
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.clearTimeout(saveTimer.current)
      flush()
      if (dockRef.current && dockRegistry.get(space.id) === dockRef.current) dockRegistry.delete(space.id)
    }
  }, [space.id])

  return (
    // Gli spazi restano montati anche quando non sono visibili: così pannelli fluttuanti
    // e finestre staccate non si chiudono cambiando spazio.
    <div className="absolute inset-0 p-(--cct-gap)" style={{ display: active ? 'block' : 'none' }} aria-hidden={!active}>
      <DockviewReact
        className="h-full"
        theme={cctDockTheme}
        components={components}
        defaultTabComponent={PanelTab}
        onReady={onReady}
        rightHeaderActionsComponent={GroupActions}
        watermarkComponent={EmptySpace}
        popoutUrl={popoutUrl}
        floatingGroupBounds="boundedWithinViewport"
      />
    </div>
  )
}
