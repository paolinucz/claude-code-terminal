import { useEffect, useState } from 'react'
import { Check, ChevronDown, FolderOpen, Layers } from 'lucide-react'
import type { ProjectContextDef } from '@shared/project'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useProject } from '@/state/project'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui-kit'

const buttonClass =
  'app-no-drag inline-flex h-8 max-w-48 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-lg border border-border px-3 text-[13px] text-text-muted transition-colors hover:bg-border hover:text-foreground data-[state=open]:bg-border data-[state=open]:text-foreground'

/** Crea o modifica un contesto: nome e cartella d'ambito (J5). */
function ContextDialog(props: { open: boolean; context: ProjectContextDef | null; onClose(): void }) {
  const root = useProject((s) => s.active?.root ?? '')
  const [name, setName] = useState('')
  const [dir, setDir] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!props.open) return
    setName(props.context?.name ?? '')
    setDir(props.context?.dirs[0] ?? '')
    setError('')
    setBusy(false)
  }, [props.open, props.context])

  const browse = async () => {
    const res = await api.project.pickRelative(root, 'dir')
    if (res.skipped > 0) setError('La cartella è su un altro disco: nel file di progetto servono percorsi relativi.')
    else if (res.paths[0] !== undefined) {
      setDir(res.paths[0] === '' ? '' : res.paths[0])
      setError('')
    }
  }

  const submit = async () => {
    const clean = name.trim()
    if (!clean || busy) return
    setBusy(true)
    const store = useProject.getState()
    const dirs = dir.trim() && dir.trim() !== '.' ? [dir.trim().replace(/\\/g, '/')] : []
    const err = props.context
      ? await store.updateContext(props.context.id, { name: clean, dirs })
      : await store.addContext(clean, dirs[0])
    setBusy(false)
    if (err) setError(err)
    else props.onClose()
  }

  const inputClass =
    'mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-[13px] text-foreground outline-none focus:border-brand'

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{props.context ? 'Modifica contesto' : 'Nuovo contesto'}</DialogTitle>
            <DialogDescription>
              Un contesto è un&apos;area di lavoro del progetto, con i suoi spazi, la sua cartella e i suoi documenti. Puoi tenerne aperti più di uno.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor="ctx-name" className="mt-4 block text-[12px] text-text-subtle">
            Nome
          </label>
          <input id="ctx-name" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={inputClass} />
          <label htmlFor="ctx-dir" className="mt-3 block text-[12px] text-text-subtle">
            Cartella di lavoro (relativa al progetto, facoltativa)
          </label>
          <div className="flex gap-2">
            <input
              id="ctx-dir"
              value={dir}
              placeholder="tutta la cartella del progetto"
              onChange={(e) => setDir(e.target.value)}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => void browse()}
              className="mt-1 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-text-muted transition-colors hover:bg-border hover:text-foreground"
            >
              <FolderOpen size={14} /> Sfoglia
            </button>
          </div>
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
              disabled={!name.trim() || busy}
              className="h-9 rounded-lg bg-brand px-4 font-semibold text-on-brand transition-opacity disabled:opacity-40"
            >
              {props.context ? 'Salva' : 'Crea contesto'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Selettore dei contesti del progetto attivo (J5): cambia, crea, rinomina, duplica, riordina, elimina. */
export function ContextSwitcher() {
  const active = useProject((s) => s.active)
  const activeId = useProject((s) => s.activeContextId)
  const [dialog, setDialog] = useState<{ context: ProjectContextDef | null } | null>(null)
  const [deleting, setDeleting] = useState<ProjectContextDef | null>(null)

  if (!active) return null
  const contexts = active.data.contexts
  const current = contexts.find((c) => c.id === activeId)
  const store = useProject.getState()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={buttonClass} title="Contesti del progetto">
            <Layers size={14} className={current ? 'text-brand' : undefined} />
            <span className="truncate">{current ? current.name : 'Contesti'}</span>
            <ChevronDown size={13} className="shrink-0 text-text-faint" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Contesti di «{active.data.name}»</DropdownMenuLabel>
          {contexts.length === 0 && <DropdownMenuItem disabled>Nessun contesto: il lavoro è unico</DropdownMenuItem>}
          {contexts.map((c) => (
            <DropdownMenuItem key={c.id} onSelect={() => store.setContext(c.id)}>
              <span className="flex-1 truncate">{c.name}</span>
              {c.id === activeId && <Check size={14} className="text-brand" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialog({ context: null })}>Nuovo contesto…</DropdownMenuItem>
          {current && (
            <>
              <DropdownMenuItem onSelect={() => setDialog({ context: current })}>Modifica «{current.name}»…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void store.duplicateContext(current.id)}>Duplica «{current.name}»</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Sposta «{current.name}»</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem disabled={contexts[0]?.id === current.id} onSelect={() => void store.moveContext(current.id, -1)}>
                    Prima
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={contexts[contexts.length - 1]?.id === current.id}
                    onSelect={() => void store.moveContext(current.id, 1)}
                  >
                    Dopo
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={() => setDeleting(current)}>Elimina «{current.name}»…</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ContextDialog open={dialog !== null} context={dialog?.context ?? null} onClose={() => setDialog(null)} />

      <ConfirmDialog
        open={deleting !== null}
        title={`Eliminare il contesto «${deleting?.name ?? ''}»?`}
        description="Si chiudono i suoi spazi. Le sessioni di Claude Code non si fermano e si possono riprendere da «Nuovo terminale». I file del progetto non vengono toccati."
        confirmLabel="Elimina"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting
          setDeleting(null)
          if (target) void useProject.getState().removeContext(target.id)
        }}
      />
    </>
  )
}
