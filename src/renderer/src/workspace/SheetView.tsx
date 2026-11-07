import { useCallback, useEffect, useRef } from 'react'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type SerializedDockview } from 'dockview-react'
import type { Sheet } from '@shared/types'
import { api } from '@/lib/api'
import { PanelHost } from '@/panels/PanelHost'
import { PanelTab } from '@/panels/PanelTab'
import { useWorkspace } from '@/state/workspace'
import { GroupActions } from './GroupActions'
import { EmptySheet } from './EmptySheet'
import { buildDefaultLayout, removeHiddenPanels } from './panels'
import { dockRegistry } from './registry'
import { cctDockTheme } from './theme'

const components = { placeholder: PanelHost }

const SAVE_DELAY_MS = 400

/** URL della pagina vuota usata da Dockview per le finestre staccate (L4). Funziona sia in dev sia da file://. */
const popoutUrl = new URL('popout.html', window.location.href).href

/** Un foglio: un'istanza Dockview indipendente, con salvataggio automatico della disposizione (L5). */
export function SheetView({ sheet, active }: { sheet: Sheet; active: boolean }) {
  const setStatus = useWorkspace((s) => s.setStatus)
  const setPanelCount = useWorkspace((s) => s.setPanelCount)
  const saveTimer = useRef<number | undefined>(undefined)
  const dockRef = useRef<DockviewApi | null>(null)
  const sheetRef = useRef(sheet)
  sheetRef.current = sheet

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      // In StrictMode (sviluppo) Dockview crea l'istanza due volte: vale sempre l'ultima.
      const dock = event.api
      dockRef.current = dock
      dockRegistry.set(sheet.id, dock)

      let restored = false
      if (sheet.layout) {
        try {
          dock.fromJSON(sheet.layout as unknown as SerializedDockview)
          removeHiddenPanels(dock)
          restored = true
        } catch (err) {
          console.warn(`Layout del foglio «${sheet.name}» non valido, uso quello predefinito`, err)
        }
      }
      if (!restored) buildDefaultLayout(dock, sheet.id)
      setPanelCount(sheet.id, dock.panels.length)

      dock.onDidLayoutChange(() => {
        if (dockRef.current !== dock) return
        setPanelCount(sheet.id, dock.panels.length)
        window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => {
          void api.workspace.saveSheetLayout(sheet.id, dock.toJSON() as unknown as Record<string, unknown>)
          // Il salvataggio automatico non copre messaggi più importanti (es. «inviata a Debug»).
          const current = useWorkspace.getState().status
          if (!current || current.endsWith('salvato automaticamente')) {
            setStatus(`Layout «${sheetRef.current.name}» · salvato automaticamente`)
          }
        }, SAVE_DELAY_MS)
      })
    },
    // L'istanza Dockview nasce una volta sola per foglio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet.id]
  )

  useEffect(() => {
    // Rimonta (StrictMode) senza nuovo onReady: l'istanza è la stessa, va solo registrata di nuovo.
    if (dockRef.current) dockRegistry.set(sheet.id, dockRef.current)
    return () => {
      window.clearTimeout(saveTimer.current)
      if (dockRef.current && dockRegistry.get(sheet.id) === dockRef.current) dockRegistry.delete(sheet.id)
    }
  }, [sheet.id])

  return (
    // I fogli restano montati anche quando non sono visibili: così pannelli fluttuanti
    // e finestre staccate non si chiudono cambiando foglio.
    <div className="absolute inset-0 p-1.5" style={{ display: active ? 'block' : 'none' }} aria-hidden={!active}>
      <DockviewReact
        className="h-full"
        theme={cctDockTheme}
        components={components}
        defaultTabComponent={PanelTab}
        onReady={onReady}
        rightHeaderActionsComponent={GroupActions}
        watermarkComponent={EmptySheet}
        popoutUrl={popoutUrl}
        floatingGroupBounds="boundedWithinViewport"
      />
    </div>
  )
}
