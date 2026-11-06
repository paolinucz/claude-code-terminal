import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Ban, Check, CheckCheck, ChevronDown, ChevronRight, FilePlus2, FileText, Lightbulb, MessageSquarePlus, RotateCcw, Undo2 } from 'lucide-react'
import { isOpen, type ChangeContents, type FileChange, type ReviewNote } from '@shared/changes'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Segmented } from '@/components/ui-kit'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { CHANGE_STATUS_COLORS, CHANGE_STATUS_LABELS, pendingCount, splitPath, useChanges } from '@/state/changes'
import { useWorkspace } from '@/state/workspace'
import type { LineSelection } from './DiffView'
import { RevisionComposer } from './RevisionComposer'

const DiffView = lazy(() => import('./DiffView'))

type Filter = 'open' | 'all'
const FILTERS = [
  { id: 'open', label: 'Aperte' },
  { id: 'all', label: 'Tutte' }
] as const satisfies readonly { id: Filter; label: string }[]

type Base = 'original' | 'lastRequest'
const BASES = [
  { id: 'lastRequest', label: "Dall'ultima richiesta" },
  { id: 'original', label: "Dall'originale" }
] as const satisfies readonly { id: Base; label: string }[]

/**
 * Pannello Modifiche (F5–F8): i file toccati da Claude, sessione per sessione, con il diff
 * prima ↔ dopo e i pulsanti Approva / Richiedi modifiche / Rifiuta.
 */
export function ChangesPanel() {
  const changes = useChanges((s) => s.changes)
  const setStatus = useWorkspace((s) => s.setStatus)
  const [filter, setFilter] = useState<Filter>('open')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [contents, setContents] = useState<ChangeContents | null>(null)
  const [rejecting, setRejecting] = useState<{ change: FileChange; force: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [composing, setComposing] = useState(false)
  const [composeError, setComposeError] = useState('')
  const [selection, setSelection] = useState<LineSelection | null>(null)
  const [base, setBase] = useState<Base>('lastRequest')
  const [historyOpen, setHistoryOpen] = useState(false)

  const visible = useMemo(() => (filter === 'open' ? changes.filter(isOpen) : changes), [changes, filter])
  const groups = useMemo(() => {
    const map = new Map<string, { title: string; items: FileChange[] }>()
    for (const c of visible) {
      const g = map.get(c.sessionId) ?? { title: c.sessionTitle, items: [] }
      g.items.push(c)
      map.set(c.sessionId, g)
    }
    return [...map.entries()]
  }, [visible])
  const toReview = pendingCount(changes)
  const waitingClaude = changes.filter((c) => c.status === 'revision').length
  const selected = changes.find((c) => c.id === selectedId) ?? null

  // Selezione: resta sulla modifica scelta finché esiste nell'elenco visibile, altrimenti passa alla prima.
  useEffect(() => {
    if (selectedId && visible.some((c) => c.id === selectedId)) return
    setSelectedId(visible[0]?.id ?? null)
  }, [visible, selectedId])

  useEffect(() => {
    setComposing(false)
    setComposeError('')
    setSelection(null)
    setHistoryOpen(false)
  }, [selectedId])

  // Contenuti del diff: si ricaricano quando cambia la selezione o la modifica stessa (nuovi Edit sullo stesso file).
  useEffect(() => {
    if (!selected) {
      setContents(null)
      return
    }
    let stale = false
    void api.changes.contents(selected.id).then((c) => !stale && setContents(c))
    return () => {
      stale = true
    }
  }, [selected?.id, selected?.updatedAt, selected?.status, selected?.requests])

  const nextOpenAfter = (id: string) => {
    const list = changes.filter((c) => c.status === 'pending')
    const i = list.findIndex((c) => c.id === id)
    return list[i + 1]?.id ?? list[i - 1]?.id ?? null
  }

  const approve = async (c: FileChange) => {
    setBusy(true)
    await api.changes.approve(c.id)
    setBusy(false)
    if (filter === 'open') setSelectedId(nextOpenAfter(c.id))
  }

  const reject = async (c: FileChange, force: boolean) => {
    setBusy(true)
    const res = await api.changes.reject(c.id, force)
    setBusy(false)
    if (res.needsForce) {
      setRejecting({ change: c, force: true })
      return
    }
    setRejecting(null)
    if (!res.ok) {
      setStatus(res.error ?? 'Impossibile rifiutare la modifica')
      return
    }
    setStatus(`${splitPath(c).name} ripristinato: Claude lo saprà al prossimo messaggio`)
    if (filter === 'open') setSelectedId(nextOpenAfter(c.id))
  }

  const requestRevision = async (c: FileChange, notes: ReviewNote[]) => {
    setBusy(true)
    setComposeError('')
    const res = await api.changes.requestRevision(c.id, notes)
    setBusy(false)
    if (!res.ok) {
      setComposeError(res.error ?? 'Impossibile inviare la richiesta')
      return
    }
    setComposing(false)
    setStatus(`Richiesta inviata a «${c.sessionTitle}»: ${splitPath(c).name} tornerà qui quando Claude lo aggiorna`)
  }

  // Confronto: dopo una richiesta conviene vedere solo cosa ha cambiato Claude da allora.
  const canCompareLast = Boolean(contents?.lastRequestBase !== null && contents?.lastRequestBase !== undefined && selected?.status === 'pending')
  const diffBefore = canCompareLast && base === 'lastRequest' ? contents!.lastRequestBase! : contents?.before

  return (
    <div className="@container h-full bg-surface">
      <div className="flex h-full flex-col @[720px]:flex-row">
        {/* Elenco dei file (F5) */}
        <aside className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-b border-border @[720px]:max-h-none @[720px]:w-72 @[720px]:border-r @[720px]:border-b-0">
          <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold text-foreground">Modifiche</h2>
              <p className="truncate text-[12px] text-text-subtle">
                {toReview ? `${toReview} da rivedere` : 'Niente da rivedere'}
                {waitingClaude ? ` · ${waitingClaude} attende Claude` : ''}
              </p>
            </div>
            <Segmented label="Filtro" size="sm" value={filter} onChange={setFilter} options={FILTERS} className="w-36" />
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2" role="listbox" aria-label="File modificati">
            {groups.length === 0 && (
              <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-text-faint">
                {filter === 'open'
                  ? 'Quando Claude modifica un file in una sessione aperta da qui, la modifica compare in questo elenco.'
                  : 'Nessuna modifica registrata.'}
              </p>
            )}
            {groups.map(([sessionId, g]) => (
              <div key={sessionId} className="mt-1">
                <div className="flex items-center gap-2 px-2 pt-2 pb-1">
                  <span className="truncate text-[11px] font-medium tracking-wide text-text-faint uppercase">{g.title}</span>
                  {g.items.some((c) => c.status === 'pending') && (
                    <button
                      type="button"
                      onClick={async () => {
                        const n = await api.changes.approveAll(sessionId)
                        setStatus(`${n} ${n === 1 ? 'modifica approvata' : 'modifiche approvate'} per «${g.title}»`)
                      }}
                      className="ml-auto shrink-0 text-[11px] text-text-subtle hover:text-foreground"
                    >
                      Approva sessione
                    </button>
                  )}
                </div>
                {g.items.map((c) => {
                  const { name, dir } = splitPath(c)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      aria-selected={c.id === selectedId}
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        c.id === selectedId ? 'bg-border' : 'hover:bg-surface-2'
                      )}
                    >
                      {c.created ? (
                        <FilePlus2 size={14} className="mt-0.5 shrink-0 text-ok" />
                      ) : (
                        <FileText size={14} className="mt-0.5 shrink-0 text-text-faint" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate font-mono text-[12px] text-foreground">{name}</span>
                          <span className="ml-auto shrink-0 font-mono text-[11px]">
                            {c.added > 0 && <span className="text-ok">+{c.added}</span>} {c.removed > 0 && <span className="text-danger">−{c.removed}</span>}
                          </span>
                        </span>
                        {dir && <span className="block truncate font-mono text-[11px] text-text-faint">{dir}</span>}
                        <span className="block text-[11px]" style={{ color: CHANGE_STATUS_COLORS[c.status] }}>
                          {c.created && c.status === 'pending' ? 'nuovo file · ' : ''}
                          {c.status === 'pending' && c.requests > 0 ? 'aggiornata da Claude · ' : ''}
                          {CHANGE_STATUS_LABELS[c.status]}
                          {c.requests > 0 ? ` · ${c.requests} ${c.requests === 1 ? 'richiesta' : 'richieste'}` : ''}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          {toReview > 1 && (
            <div className="border-t border-border p-2">
              <button
                type="button"
                onClick={async () => {
                  const n = await api.changes.approveAll()
                  setStatus(`${n} modifiche approvate`)
                }}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-text-muted transition-colors hover:bg-border hover:text-foreground"
              >
                <CheckCheck size={14} /> Approva tutte ({toReview})
              </button>
            </div>
          )}
        </aside>

        {/* Diff affiancato (F6) e richieste di modifiche (F8) */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                <span className="min-w-0 truncate font-mono text-[12px] text-foreground" title={selected.filePath}>
                  {splitPath(selected).name}
                  <span className="text-text-faint"> · prima ↔ dopo</span>
                </span>
                {contents?.modifiedSince && (
                  <span className="shrink-0 rounded border border-warn/40 px-1.5 text-[11px] text-warn" title="Il file su disco è diverso dall'ultima versione scritta da Claude">
                    cambiato dopo
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {isOpen(selected) ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRejecting({ change: selected, force: false })}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-danger/50 px-2.5 text-[12px] text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
                      >
                        <Undo2 size={13} /> Rifiuta
                      </button>
                      <button
                        type="button"
                        disabled={busy || selected.status === 'revision'}
                        onClick={() => setComposing((v) => !v)}
                        aria-pressed={composing}
                        title={selected.status === 'revision' ? 'Hai già chiesto modifiche: aspetta che Claude aggiorni il file' : 'Aggiungi accortezze o divieti e rimanda il file a Claude'}
                        className={cn(
                          'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors disabled:opacity-40',
                          composing ? 'border-info bg-info/15 text-foreground' : 'border-info/50 text-info hover:bg-info/10'
                        )}
                      >
                        <MessageSquarePlus size={13} /> Richiedi modifiche
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void approve(selected)}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-ok px-2.5 text-[12px] font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        <Check size={13} /> Approva
                      </button>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: CHANGE_STATUS_COLORS[selected.status] }}>
                      {selected.status === 'rejected' ? <RotateCcw size={12} /> : <Check size={12} />}
                      {CHANGE_STATUS_LABELS[selected.status]}
                    </span>
                  )}
                </div>
              </div>

              {/* Stato della richiesta, confronto e storico */}
              {(selected.status === 'revision' || canCompareLast || (contents?.requests.length ?? 0) > 0) && (
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5 text-[12px]">
                  {selected.status === 'revision' && (
                    <span className="text-info">Modifiche richieste: aspetto che Claude aggiorni il file. Puoi comunque approvare o rifiutare.</span>
                  )}
                  {canCompareLast && (
                    <>
                      <span className="text-text-subtle">Claude ha aggiornato il file dopo la tua richiesta.</span>
                      <Segmented label="Confronta" size="sm" value={base} onChange={setBase} options={BASES} className="w-72" />
                    </>
                  )}
                  {(contents?.requests.length ?? 0) > 0 && (
                    <button type="button" onClick={() => setHistoryOpen((v) => !v)} className="ml-auto inline-flex items-center gap-1 text-text-subtle hover:text-foreground">
                      {historyOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      Richieste inviate ({contents!.requests.length})
                    </button>
                  )}
                </div>
              )}
              {historyOpen && contents && (
                <div className="max-h-40 shrink-0 space-y-2 overflow-auto border-b border-border px-3 py-2 text-[12px]">
                  {contents.requests.map((r, i) => (
                    <div key={r.id}>
                      <p className="text-[11px] text-text-faint">
                        Richiesta {i + 1} · {new Date(r.createdAt).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <ul className="mt-0.5 space-y-0.5">
                        {r.notes.map((n, j) => (
                          <li key={j} className="flex items-start gap-1.5 text-text-muted">
                            {n.kind === 'forbid' ? <Ban size={12} className="mt-0.5 shrink-0 text-danger" /> : <Lightbulb size={12} className="mt-0.5 shrink-0 text-warn" />}
                            <span>
                              {n.lines && <span className="font-mono text-text-faint">{n.lines.start === n.lines.end ? `r. ${n.lines.start}` : `r. ${n.lines.start}–${n.lines.end}`} · </span>}
                              {n.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              <div className="relative min-h-0 flex-1 bg-background">
                {contents === null ? (
                  <p className="p-4 text-text-faint">Caricamento…</p>
                ) : contents.binary ? (
                  <p className="p-4 text-text-subtle">File binario: il diff non è disponibile.</p>
                ) : diffBefore === null || diffBefore === undefined || contents.after === null ? (
                  <p className="p-4 text-text-subtle">Il contenuto non è disponibile (file troppo grande o archivio degli snapshot mancante).</p>
                ) : (
                  <Suspense fallback={<p className="p-4 text-text-faint">Caricamento del diff…</p>}>
                    <DiffView
                      key={`${selected.id}:${base}`}
                      filePath={selected.filePath}
                      before={diffBefore}
                      after={contents.after}
                      onSelection={setSelection}
                    />
                  </Suspense>
                )}
              </div>

              {composing && (
                <RevisionComposer
                  sessionTitle={selected.sessionTitle}
                  selection={selection}
                  sending={busy}
                  error={composeError}
                  onSend={(notes) => void requestRevision(selected, notes)}
                  onCancel={() => setComposing(false)}
                />
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-text-faint">
              {toReview === 0 ? 'Tutte le modifiche sono state riviste.' : "Scegli un file dall'elenco."}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={rejecting !== null}
        title={
          rejecting?.force
            ? `«${rejecting ? splitPath(rejecting.change).name : ''}» è cambiato dopo la modifica di Claude`
            : `Rifiutare la modifica a «${rejecting ? splitPath(rejecting.change).name : ''}»?`
        }
        description={
          rejecting?.force
            ? 'Il file su disco non è più quello scritto da Claude (lo hai modificato tu, o è cambiato dopo). Ripristinando la versione precedente perdi anche quei cambiamenti.'
            : rejecting?.change.created
              ? 'Il file è stato creato da Claude: verrà cancellato. Claude ne sarà informato al prossimo messaggio della sessione.'
              : 'Il file torna alla versione precedente alla modifica di Claude. Claude ne sarà informato al prossimo messaggio della sessione.'
        }
        confirmLabel={rejecting?.force ? 'Ripristina comunque' : rejecting?.change.created ? 'Rifiuta e cancella' : 'Rifiuta e ripristina'}
        destructive
        onCancel={() => setRejecting(null)}
        onConfirm={() => rejecting && void reject(rejecting.change, rejecting.force)}
      />
    </div>
  )
}
