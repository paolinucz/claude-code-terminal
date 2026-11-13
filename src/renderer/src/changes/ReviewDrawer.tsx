import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCheck, ChevronsLeft, FilePlus2, FileText, Undo2, X } from 'lucide-react'
import { isOpen, REVIEW_RUNNING_MESSAGE } from '@shared/changes'
import { cn } from '@/lib/cn'
import { Segmented } from '@/components/ui-kit'
import { CHANGE_STATUS_COLORS, CHANGE_STATUS_LABELS, splitPath, useChanges } from '@/state/changes'
import { REVIEW_MIN_WIDTH, useReviewUi } from '@/state/review'
import { useBot } from '@/state/bots'
import { RejectDialogs } from './RejectDialogs'
import { ReviewDiff } from './ReviewDiff'
import { useReview, type ReviewFilter } from './useReview'

/** Sotto questa larghezza del pannello il cassetto non divide il terminale: si sovrappone come un foglio a destra. */
const NARROW_BELOW = 720

const FILTERS = [
  { id: 'open', label: 'Aperte' },
  { id: 'all', label: 'Tutte' }
] as const satisfies readonly { id: ReviewFilter; label: string }[]

/**
 * Cassetto di revisione di una sessione di Claude, accanto al suo terminale: i file toccati dalla sessione, il diff e le azioni
 * Approva / Rifiuta / Richiedi modifiche. Si apre da solo alla prima modifica da rivedere (vedi `startReviewAutoOpen`), si
 * richiude in una barra stretta con il numero di file da rivedere e segue la sessione se il pannello cambia spazio o finestra,
 * perché i dati vengono dalle modifiche della sessione, non dal pannello.
 *
 * Va messo come figlio di un contenitore `relative flex` accanto alla colonna del terminale (vedi `TerminalPanel`).
 */
export function ReviewDock({ sessionId }: { sessionId: string }) {
  const ui = useReviewUi((s) => s.sessions[sessionId])
  const width = useReviewUi((s) => s.width)
  const allChanges = useChanges((s) => s.changes)
  const mine = useMemo(() => allChanges.filter((c) => c.sessionId === sessionId), [allChanges, sessionId])
  const openCount = mine.filter(isOpen).length
  const pendingCount = mine.filter((c) => c.status === 'pending').length
  const hostRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [parentWidth, setParentWidth] = useState(1200)

  // La larghezza del pannello decide se il cassetto divide o si sovrappone.
  useEffect(() => {
    const parent = hostRef.current?.parentElement
    if (!parent) return
    const ro = new ResizeObserver(() => {
      const w = parent.getBoundingClientRect().width
      setParentWidth(w)
      setNarrow(w < NARROW_BELOW)
    })
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])

  const open = Boolean(ui?.open)
  return (
    <div ref={hostRef} className={cn('contents')}>
      {!open && openCount > 0 && (
        <button
          type="button"
          onClick={() => useReviewUi.getState().openReview(sessionId)}
          aria-label={`Apri la revisione: ${pendingCount > 0 ? `${pendingCount} file da rivedere` : `${openCount} in attesa di Claude`}`}
          title="Apri la revisione delle modifiche di questa sessione"
          className="mg-bar relative z-10 flex w-7 shrink-0 flex-col items-center gap-2 border-l border-border pt-2 text-text-subtle transition-colors hover:text-foreground"
        >
          <ChevronsLeft size={14} />
          <span className="rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold text-on-brand" style={{ background: pendingCount > 0 ? 'var(--cct-warn)' : 'var(--cct-info)' }}>
            {pendingCount > 0 ? pendingCount : openCount}
          </span>
          <span className="[writing-mode:vertical-rl] text-[11px] tracking-wide">Revisione</span>
        </button>
      )}
      {open && <Drawer sessionId={sessionId} narrow={narrow} width={Math.min(width, Math.max(REVIEW_MIN_WIDTH, parentWidth * 0.7))} parentWidth={parentWidth} />}
    </div>
  )
}

function Drawer({ sessionId, narrow, width, parentWidth }: { sessionId: string; narrow: boolean; width: number; parentWidth: number }) {
  const ui = useReviewUi((s) => s.sessions[sessionId])
  const allChanges = useChanges((s) => s.changes)
  const mine = useMemo(() => allChanges.filter((c) => c.sessionId === sessionId), [allChanges, sessionId])
  const bot = useBot(sessionId)
  const [filter, setFilter] = useState<ReviewFilter>('open')
  const review = useReview({ changes: mine, filter, focusId: ui?.focusId, focusN: ui?.n })
  const { visible, selectedId, setSelectedId, toReview, pendingIds, anyPendingRunning, approveIds, startRejectMany } = review
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const asideRef = useRef<HTMLElement>(null)

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const max = parentWidth * 0.7
    const move = (ev: PointerEvent) => setDragWidth(Math.min(max, Math.max(REVIEW_MIN_WIDTH, startW + (startX - ev.clientX))))
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      useReviewUi.getState().setWidth(Math.min(max, Math.max(REVIEW_MIN_WIDTH, startW + (startX - ev.clientX))))
      setDragWidth(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = visible.findIndex((c) => c.id === selectedId)
    const next = visible[Math.max(0, Math.min(visible.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) setSelectedId(next.id)
  }

  const w = dragWidth ?? width
  return (
    <aside
      ref={asideRef}
      role="complementary"
      aria-label="Revisione delle modifiche"
      style={narrow ? undefined : { width: w }}
      className={cn(
        'flex min-h-0 flex-col border-l border-border',
        narrow ? 'mg-glass-sheet absolute inset-y-0 right-0 z-20 w-[min(100%,560px)] shadow-2xl' : 'relative shrink-0 bg-black/10'
      )}
    >
      {!narrow && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Larghezza della revisione"
          onPointerDown={startDrag}
          className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-brand/40"
        />
      )}
      <header className="mg-bar flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-foreground">Revisione{bot ? ` · ${bot.name}` : ''}</h2>
          <p className="truncate text-[12px] text-text-subtle">{toReview ? `${toReview} da rivedere` : 'Niente da rivedere'}</p>
        </div>
        <Segmented label="Filtro" size="sm" value={filter} onChange={setFilter} options={FILTERS} className="ml-auto w-32" />
        <button
          type="button"
          aria-label="Chiudi la revisione"
          title="Chiudi la revisione (si riapre dalla barra a destra)"
          onClick={() => useReviewUi.getState().closeReview(sessionId)}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-subtle hover:bg-border hover:text-foreground"
        >
          <X size={14} />
        </button>
      </header>

      {visible.length > 0 && (
        <div role="listbox" aria-label="File modificati dalla sessione" tabIndex={0} onKeyDown={onListKey} className="max-h-40 shrink-0 overflow-auto border-b border-border p-1 outline-none focus-visible:ring-1 focus-visible:ring-ring">
          {visible.map((c) => {
            const { name, dir } = splitPath(c)
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={c.id === selectedId}
                onClick={() => setSelectedId(c.id)}
                title={c.filePath}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors', c.id === selectedId ? 'bg-border' : 'hover:bg-white/5')}
              >
                {c.created ? <FilePlus2 size={13} className="shrink-0 text-ok" /> : <FileText size={13} className="shrink-0 text-text-faint" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12px] text-foreground">{name}</span>
                  <span className="block truncate text-[11px]" style={{ color: CHANGE_STATUS_COLORS[c.status] }}>
                    {dir ? `${dir} · ` : ''}
                    {c.created && c.status === 'pending' ? 'nuovo file · ' : ''}
                    {CHANGE_STATUS_LABELS[c.status]}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[11px]">
                  {c.added > 0 && <span className="text-ok">+{c.added}</span>} {c.removed > 0 && <span className="text-danger">−{c.removed}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <ReviewDiff review={review} emptyText={mine.length === 0 ? 'Claude non ha ancora modificato file in questa sessione.' : undefined} />

      {toReview > 1 && (
        <div className="mg-bar flex shrink-0 gap-2 border-t border-border p-2">
          <button
            type="button"
            disabled={anyPendingRunning}
            title={anyPendingRunning ? REVIEW_RUNNING_MESSAGE : undefined}
            onClick={() => void approveIds(pendingIds, 'di questa sessione')}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-ok/50 text-ok transition-colors hover:bg-ok/10 disabled:opacity-40"
          >
            <CheckCheck size={14} /> Approva tutto ({toReview})
          </button>
          <button
            type="button"
            disabled={anyPendingRunning}
            title={anyPendingRunning ? REVIEW_RUNNING_MESSAGE : undefined}
            onClick={() => startRejectMany(pendingIds, 'di questa sessione')}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-danger/50 text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
          >
            <Undo2 size={14} /> Respingi tutto ({toReview})
          </button>
        </div>
      )}

      <RejectDialogs review={review} />
    </aside>
  )
}
