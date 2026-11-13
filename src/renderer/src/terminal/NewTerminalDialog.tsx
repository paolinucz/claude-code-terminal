import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui-kit'
import { useWorkspace } from '@/state/workspace'
import { openSessionView } from '@/workspace/panels'
import { dockRegistry } from '@/workspace/registry'
import { NewSessionForm } from './NewSessionForm'

/** Dialogo «Nuovo terminale» (mockup, schermata 3). Apre la vista nello spazio attivo. */
export function NewTerminalDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const space = useWorkspace((s) => s.spaces.find((x) => x.id === s.activeSpaceId))
  const setStatus = useWorkspace((s) => s.setStatus)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
        <DialogHeader className="mb-4">
          <DialogTitle>
            Nuovo terminale <span className="font-normal text-text-subtle">· spazio {space?.name}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">Scegli Claude Code o una shell, la cartella e dove aprire il terminale.</DialogDescription>
        </DialogHeader>
        {open && (
          <NewSessionForm
            variant="dialog"
            onCancel={onClose}
            onDone={(session, placement) => {
              const dock = space ? dockRegistry.get(space.id) : undefined
              if (dock) openSessionView(dock, session, placement)
              setStatus(`«${session.title}» aperta nello spazio «${space?.name}»`)
              onClose()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
