import { useEffect, useState } from 'react'
import type { NamedLayout } from '@shared/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui-kit'

/** Salva la disposizione dello spazio attivo come layout con un nome (L5). */
export function SaveLayoutDialog(props: {
  open: boolean
  defaultName: string
  existing: NamedLayout[]
  onSave(name: string): void
  onClose(): void
}) {
  const [name, setName] = useState(props.defaultName)
  useEffect(() => {
    if (props.open) setName(props.defaultName)
  }, [props.open, props.defaultName])

  const clean = name.trim()
  const overwrites = props.existing.some((l) => l.name.toLowerCase() === clean.toLowerCase())

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (clean) props.onSave(clean)
          }}
        >
          <DialogHeader>
            <DialogTitle>Salva layout</DialogTitle>
            <DialogDescription>
              Salva solo la disposizione dei pannelli, non le sessioni. Puoi riapplicarla a qualsiasi spazio.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor="layout-name" className="mt-4 block text-[12px] text-text-subtle">
            Nome del layout
          </label>
          <input
            id="layout-name"
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-[13px] text-foreground outline-none focus:border-brand"
          />
          <p className="mt-1.5 min-h-4 text-[12px] text-warn">{overwrites ? 'Esiste già un layout con questo nome: verrà sostituito.' : ''}</p>
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
              disabled={!clean}
              className="h-9 rounded-lg bg-brand px-4 font-semibold text-on-brand transition-opacity disabled:opacity-40"
            >
              {overwrites ? 'Sostituisci' : 'Salva'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
