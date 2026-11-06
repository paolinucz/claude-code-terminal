import { useEffect } from 'react'
import { Toasts } from '@/components/Toasts'
import { useChanges } from '@/state/changes'
import { useSessions } from '@/state/sessions'
import { useTerminalSettings } from '@/state/terminalSettings'
import { useWorkspace } from '@/state/workspace'
import { SheetTabs } from '@/workspace/SheetTabs'
import { SheetView } from '@/workspace/SheetView'
import { TopBar } from '@/workspace/TopBar'

export function App() {
  const { loaded, sheets, activeSheetId, load } = useWorkspace()

  useEffect(() => {
    void load()
    void useSessions.getState().init()
    void useTerminalSettings.getState().load()
    void useChanges.getState().init()
  }, [load])

  if (!loaded) {
    return <div className="flex h-full items-center justify-center text-text-faint">Caricamento…</div>
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="relative min-h-0 flex-1" aria-label="Pannelli del foglio">
        {sheets.map((sheet) => (
          <SheetView key={sheet.id} sheet={sheet} active={sheet.id === activeSheetId} />
        ))}
      </main>
      <SheetTabs />
      <Toasts />
    </div>
  )
}
