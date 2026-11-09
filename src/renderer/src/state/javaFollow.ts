import { useJavaDev } from '@/state/javaDev'
import { useSessions } from '@/state/sessions'
import { addPanel, hintOf } from '@/workspace/panels'
import { dockRegistry } from '@/workspace/registry'
import { openFile } from '@/state/editor'
import { rootForSheet, useSidebar } from '@/state/sidebar'
import { useWorkspace } from '@/state/workspace'

let started = false

/**
 * Collegamenti del Java development pack con il resto dell'app, attivi da subito (anche con la vista chiusa):
 * lo stato si rilegge quando cambia foglio o cartella, e quando il programma si ferma l'editor si apre sulla riga.
 */
export function startJavaDev(): void {
  if (started) return
  started = true
  useJavaDev.getState().init()
  const refresh = () => void useJavaDev.getState().refresh(rootForSheet(useWorkspace.getState().activeSheetId))
  refresh()
  useWorkspace.subscribe((s, p) => {
    if (s.activeSheetId !== p.activeSheetId) refresh()
  })
  useSidebar.subscribe((s, p) => {
    if (s.explorerCwd !== p.explorerCwd) refresh()
  })
  // Il programma lanciato da una run configuration (sessione «task») va mostrato subito in un terminale: senza una vista
  // la sessione sparirebbe appena finisce e non si vedrebbe nulla dell'avvio, degli errori né dei log.
  const known = new Set(Object.keys(useSessions.getState().sessions))
  useSessions.subscribe((s) => {
    for (const x of Object.values(s.sessions)) {
      if (known.has(x.id)) continue
      known.add(x.id)
      if (x.kind !== 'task') continue
      const dock = dockRegistry.get(useWorkspace.getState().activeSheetId)
      if (!dock) continue
      const ref = dock.panels.find((p) => (p.params as { kind?: string } | undefined)?.kind === 'terminal') ?? dock.activePanel
      const id = addPanel(dock, 'terminal', {
        title: x.title,
        params: { sessionId: x.id, hint: hintOf(x) },
        position: ref ? { referencePanel: ref.id, direction: 'below' } : undefined
      })
      dock.getPanel(id)?.group.api.setSize({ height: 280 })
    }
  })
  useJavaDev.subscribe((s, p) => {
    const top = s.debug.frames[0]
    if (s.debug.status !== 'paused' || !top?.path) return
    if (p.debug.status === 'paused' && p.debug.frames[0]?.id === top.id) return
    openFile(top.path, { line: top.line, column: top.column ?? 1 })
  })
}

/** Riga in cui il programma è fermo, se è in questo file. */
export function stoppedLineIn(file: string, normalize: (p: string) => string): number | null {
  const d = useJavaDev.getState().debug
  const top = d.frames[0]
  return d.status === 'paused' && top?.path && normalize(top.path) === normalize(file) ? top.line : null
}
