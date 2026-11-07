import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { api } from '@/lib/api'
import { useProject } from '@/state/project'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui-kit'

const lastSegment = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? ''

/** Crea un progetto: sceglie la cartella (nuova o già in uso) e scrive il file `.cctproj` (J1). */
export function NewProjectDialog(props: { open: boolean; onClose(): void }) {
  const [root, setRoot] = useState('')
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!props.open) return
    setRoot('')
    setName('')
    setNameEdited(false)
    setError('')
    setBusy(false)
  }, [props.open])

  const chooseFolder = async () => {
    const dir = await api.env.pickFolder(root || undefined, 'Cartella del progetto')
    if (!dir) return
    setRoot(dir)
    if (!nameEdited) setName(lastSegment(dir))
    setError('')
  }

  const cleanRoot = root.trim()
  const cleanName = name.trim()
  const valid = cleanRoot !== '' && cleanName !== ''

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    const err = await useProject.getState().create(cleanRoot, cleanName)
    setBusy(false)
    if (err) setError(err)
    else props.onClose()
  }

  const inputClass =
    'mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-[13px] text-foreground outline-none focus:border-brand'

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Nuovo progetto</DialogTitle>
            <DialogDescription>
              Crea il file di progetto (.cctproj) nella cartella scelta. La cartella può essere nuova o già in uso: i suoi file non vengono toccati.
            </DialogDescription>
          </DialogHeader>

          <label htmlFor="project-root" className="mt-4 block text-[12px] text-text-subtle">
            Cartella del progetto
          </label>
          <div className="flex gap-2">
            <input
              id="project-root"
              value={root}
              placeholder="C:\progetti\mio-progetto"
              onChange={(e) => {
                setRoot(e.target.value)
                if (!nameEdited) setName(lastSegment(e.target.value))
                setError('')
              }}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => void chooseFolder()}
              className="mt-1 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-text-muted transition-colors hover:bg-border hover:text-foreground"
            >
              <FolderOpen size={14} /> Sfoglia
            </button>
          </div>

          <label htmlFor="project-name" className="mt-3 block text-[12px] text-text-subtle">
            Nome del progetto
          </label>
          <input
            id="project-name"
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value)
              setNameEdited(true)
            }}
            className={inputClass}
          />

          <p className="mt-1.5 min-h-4 text-[12px] text-danger">{error}</p>
          <DialogFooter className="mt-4">
            <button
              type="button"
              onClick={props.onClose}
              className="h-9 rounded-lg border border-border px-4 text-text-muted transition-colors hover:bg-border hover:text-foreground"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={!valid || busy}
              className="h-9 rounded-lg bg-brand px-4 font-semibold text-on-brand transition-opacity disabled:opacity-40"
            >
              Crea progetto
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
