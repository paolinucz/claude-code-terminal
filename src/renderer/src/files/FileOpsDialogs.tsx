import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { normPath, type DirEntry } from '@shared/files'
import { isInside, validateName } from '@shared/textEdits'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { FileIcon } from '@/lib/fileIcons'
import { baseName, moveInto, parentOf, relativeTo, renameTo, useFileOps, type FileOpsDialog } from '@/state/fileOps'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui-kit'

/** Le finestre di «Rinomina», «Sposta in…/Copia in…» e la conferma del refactoring. Una alla volta, montate una sola volta nell'app. */
export function FileOpsDialogs() {
  const dialog = useFileOps((s) => s.dialog)
  if (!dialog) return null
  if (dialog.kind === 'rename') return <RenameDialog key={dialog.path} d={dialog} />
  if (dialog.kind === 'move') return <MoveDialog key={dialog.paths.join('|')} d={dialog} />
  return <ConfirmDialog d={dialog} />
}

const btnCancel = 'h-8 rounded-lg border border-border px-3 text-[12px] text-text-muted hover:bg-border'
const btnOk = 'h-8 rounded-lg bg-brand px-3 text-[12px] font-semibold text-on-brand disabled:opacity-50'

function RenameDialog({ d }: { d: Extract<FileOpsDialog, { kind: 'rename' }> }) {
  const close = useFileOps((s) => s.close)
  const current = baseName(d.path)
  const [name, setName] = useState(current)
  const input = useRef<HTMLInputElement>(null)
  const error = name === current ? null : validateName(name)
  useEffect(() => {
    // Si seleziona il nome senza estensione, come negli IDE.
    const t = window.setTimeout(() => {
      const el = input.current
      if (!el) return
      el.focus()
      const dot = d.dir ? -1 : current.lastIndexOf('.')
      el.setSelectionRange(0, dot > 0 ? dot : current.length)
    }, 30)
    return () => window.clearTimeout(t)
  }, [current, d.dir])
  const submit = () => {
    if (error || name === current) return
    close()
    void renameTo(d.path, d.root, name)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Rinomina {d.dir ? 'la cartella' : 'il file'}</DialogTitle>
          <DialogDescription className="cct-selectable truncate">{relativeTo(d.root, d.path)}</DialogDescription>
        </DialogHeader>
        <input
          ref={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          spellCheck={false}
          aria-label="Nuovo nome"
          className="cct-selectable mt-3 h-9 w-full rounded-lg border border-border bg-bg px-3 font-mono text-[13px] text-foreground outline-none focus:border-brand"
        />
        <p className={cn('mt-1.5 min-h-4 text-[11.5px]', error ? 'text-danger' : 'text-text-faint')}>
          {error ?? 'Se un plugin sa aggiornare il codice (per esempio Java), vedrai cosa cambia prima di confermare.'}
        </p>
        <DialogFooter className="mt-3">
          <button type="button" onClick={close} className={btnCancel}>
            Annulla
          </button>
          <button type="button" onClick={submit} disabled={Boolean(error) || name === current} className={btnOk}>
            Rinomina
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Cartella da scegliere: l'albero delle sole cartelle del progetto, che si apre man mano. */
function MoveDialog({ d }: { d: Extract<FileOpsDialog, { kind: 'move' }> }) {
  const close = useFileOps((s) => s.close)
  const [dirs, setDirs] = useState<Record<string, DirEntry[]>>({})
  const [open, setOpen] = useState<Set<string>>(() => new Set([normPath(d.root)]))
  const [selected, setSelected] = useState(() => parentOf(d.paths[0]))
  const loading = useRef(new Set<string>())

  const load = (dir: string) => {
    const k = normPath(dir)
    if (dirs[k] || loading.current.has(k)) return
    loading.current.add(k)
    void api.files
      .list(dir)
      .then((list) => setDirs((c) => ({ ...c, [k]: list.filter((e) => e.dir) })))
      .catch(() => setDirs((c) => ({ ...c, [k]: [] })))
  }
  useEffect(() => {
    // Si apre il percorso fino alla cartella attuale, così è visibile e selezionata.
    const chain: string[] = []
    let cur = parentOf(d.paths[0])
    while (cur && isInside(cur, d.root) && normPath(cur) !== normPath(d.root)) {
      chain.push(cur)
      cur = parentOf(cur)
    }
    setOpen((o) => new Set([...o, ...chain.map(normPath)]))
    load(d.root)
    for (const c of chain) load(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const blocked = (path: string) => d.paths.some((p) => isInside(path, p))
  const toggle = (path: string) => {
    const k = normPath(path)
    setOpen((o) => {
      const n = new Set(o)
      if (n.has(k)) n.delete(k)
      else {
        n.add(k)
        load(path)
      }
      return n
    })
  }

  const rows = useMemo(() => {
    const out: { path: string; name: string; depth: number }[] = []
    const walk = (dir: string, depth: number) => {
      for (const e of dirs[normPath(dir)] ?? []) {
        out.push({ path: e.path, name: e.name, depth })
        if (open.has(normPath(e.path))) walk(e.path, depth + 1)
      }
    }
    walk(d.root, 1)
    return out
  }, [dirs, open, d.root])

  const submit = () => {
    if (blocked(selected)) return
    close()
    void moveInto(d.paths, selected, d.root, d.copy)
  }
  const what = d.paths.length === 1 ? `«${baseName(d.paths[0])}»` : `${d.paths.length} elementi`
  const rootRow = (
    <div className="flex items-center">
      <button
        type="button"
        onClick={() => setSelected(d.root)}
        className={cn('flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 text-left text-[12px]', normPath(selected) === normPath(d.root) ? 'bg-brand/20 text-foreground' : 'text-text-muted hover:bg-surface-2')}
      >
        <FileIcon name={baseName(d.root)} dir open size={16} />
        <span className="truncate font-semibold">{baseName(d.root)}</span>
      </button>
    </div>
  )
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{d.copy ? 'Copia in…' : 'Sposta in…'}</DialogTitle>
          <DialogDescription className="cct-selectable truncate">
            {d.copy ? 'Copia' : 'Sposta'} {what} nella cartella scelta.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-3 h-64 overflow-auto rounded-lg border border-border bg-bg p-1" role="tree" aria-label="Cartelle del progetto">
          {rootRow}
          {rows.map((r) => {
            const isOpen = open.has(normPath(r.path))
            const off = blocked(r.path)
            return (
              <div key={r.path} className="flex items-center" style={{ paddingLeft: r.depth * 14 }}>
                <button type="button" aria-label={isOpen ? 'Chiudi' : 'Apri'} onClick={() => toggle(r.path)} className="inline-flex size-5 shrink-0 items-center justify-center text-text-faint hover:text-foreground">
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <button
                  type="button"
                  disabled={off}
                  onClick={() => setSelected(r.path)}
                  onDoubleClick={() => toggle(r.path)}
                  title={off ? 'Non si può scegliere una cartella dentro quella che si sposta' : r.path}
                  className={cn(
                    'flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 text-left text-[12px] disabled:opacity-40',
                    normPath(selected) === normPath(r.path) ? 'bg-brand/20 text-foreground' : 'text-text-muted hover:bg-surface-2'
                  )}
                >
                  <FileIcon name={r.name} dir open={isOpen} size={16} />
                  <span className="truncate">{r.name}</span>
                </button>
              </div>
            )
          })}
        </div>
        <p className="cct-selectable mt-2 truncate font-mono text-[11.5px] text-text-subtle" title={selected}>
          → {relativeTo(d.root, selected) || baseName(d.root)}
        </p>
        <DialogFooter className="mt-3">
          <button type="button" onClick={close} className={btnCancel}>
            Annulla
          </button>
          <button type="button" onClick={submit} disabled={blocked(selected)} className={btnOk}>
            {d.copy ? 'Copia' : 'Sposta'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Anteprima del refactoring e conferma delle sostituzioni, prima di toccare il disco. */
function ConfirmDialog({ d }: { d: Extract<FileOpsDialog, { kind: 'confirm' }> }) {
  const { prepared } = d
  const edits = prepared.edits
  const total = edits.reduce((n, f) => n + f.edits.length, 0)
  const cancel = () => d.resolve(null)
  return (
    <Dialog open onOpenChange={(o) => !o && cancel()}>
      <DialogContent className="max-h-[86vh] max-w-lg overflow-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{edits.length ? 'Aggiornare anche il codice?' : 'Sostituire?'}</DialogTitle>
          <DialogDescription>
            {d.items.length === 1 ? `«${baseName(d.items[0].from)}» → ${relativeTo(d.root, d.items[0].to) || baseName(d.items[0].to)}` : `${d.items.length} elementi`}
          </DialogDescription>
        </DialogHeader>
        {prepared.conflicts.length > 0 && (
          <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-[12px] text-foreground">
            <p className="font-semibold">Esiste già, verrebbe sostituito:</p>
            <ul className="cct-selectable mt-1 space-y-0.5 font-mono text-[11.5px] text-text-muted">
              {prepared.conflicts.slice(0, 6).map((c) => (
                <li key={c} className="truncate">
                  {relativeTo(d.root, c)}
                </li>
              ))}
              {prepared.conflicts.length > 6 && <li>… e altri {prepared.conflicts.length - 6}</li>}
            </ul>
          </div>
        )}
        {edits.length > 0 && (
          <div className="mt-3">
            <p className="text-[12px] text-text-muted">
              Il plugin propone {total} {total === 1 ? 'modifica' : 'modifiche'} in {edits.length} {edits.length === 1 ? 'file' : 'file'} (package, import, riferimenti) perché il codice resti coerente:
            </p>
            <ul className="cct-selectable mt-2 max-h-56 space-y-0.5 overflow-auto rounded-lg border border-border bg-bg p-2 font-mono text-[11.5px] text-text-muted">
              {edits.map((f) => (
                <li key={f.path} className="flex justify-between gap-3">
                  <span className="truncate" title={f.path}>
                    {relativeTo(d.root, f.path)}
                  </span>
                  <span className="shrink-0 text-text-faint">{f.edits.length}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter className="mt-4">
          <button type="button" onClick={cancel} className={btnCancel}>
            Annulla
          </button>
          {edits.length > 0 && (
            <button type="button" onClick={() => d.resolve('plain')} className={btnCancel}>
              {d.copy ? 'Copia' : 'Sposta'} senza aggiornare il codice
            </button>
          )}
          <button type="button" onClick={() => d.resolve(edits.length ? 'apply' : 'plain')} className={btnOk}>
            {edits.length ? 'Applica' : 'Sostituisci'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
