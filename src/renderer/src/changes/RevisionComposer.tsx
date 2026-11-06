import { useEffect, useRef, useState } from 'react'
import { Ban, Lightbulb, Plus, Send, TextSelect, X } from 'lucide-react'
import type { ReviewNote } from '@shared/changes'
import { cn } from '@/lib/cn'
import { Segmented } from '@/components/ui-kit'
import type { LineSelection } from './DiffView'

const KINDS = [
  { id: 'care', label: 'Accortezza' },
  { id: 'forbid', label: 'Divieto' }
] as const satisfies readonly { id: ReviewNote['kind']; label: string }[]

const linesLabel = (l: { start: number; end: number }) => (l.start === l.end ? `riga ${l.start}` : `righe ${l.start}–${l.end}`)

/**
 * «Richiedi modifiche» (F8): indicazioni per Claude su questo file. Un'accortezza è qualcosa da fare
 * o a cui stare attenti, un divieto è qualcosa da non fare. Ogni nota può riferirsi a righe precise.
 */
export function RevisionComposer({
  sessionTitle,
  selection,
  sending,
  error,
  onSend,
  onCancel
}: {
  sessionTitle: string
  selection: LineSelection | null
  sending: boolean
  error: string
  onSend(notes: ReviewNote[]): void
  onCancel(): void
}) {
  const [notes, setNotes] = useState<ReviewNote[]>([{ kind: 'care', text: '' }])
  const lastRef = useRef<HTMLTextAreaElement>(null)
  const [focusLast, setFocusLast] = useState(0)

  useEffect(() => {
    if (focusLast) lastRef.current?.focus()
  }, [focusLast])

  const update = (i: number, patch: Partial<ReviewNote>) => setNotes(notes.map((n, j) => (j === i ? { ...n, ...patch } : n)))
  const add = (kind: ReviewNote['kind'], sel?: LineSelection) => {
    const note: ReviewNote = { kind, text: '', ...(sel ? { lines: { start: sel.start, end: sel.end }, excerpt: sel.excerpt } : {}) }
    // Se l'ultima nota è vuota e senza righe, la si sostituisce invece di aggiungerne un'altra.
    const last = notes.at(-1)
    setNotes(last && !last.text.trim() && !last.lines ? [...notes.slice(0, -1), note] : [...notes, note])
    setFocusLast((n) => n + 1)
  }
  const filled = notes.filter((n) => n.text.trim())
  const send = () => filled.length && !sending && onSend(filled)

  return (
    <div
      className="flex max-h-[55%] shrink-0 flex-col border-t border-info/40 bg-surface"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault()
          send()
        }
        if (e.key === 'Escape') onCancel()
      }}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <span className="text-[13px] font-semibold text-foreground">Richiedi modifiche</span>
        <span className="truncate text-[12px] text-text-faint">a «{sessionTitle}»</span>
        <button type="button" aria-label="Chiudi" onClick={onCancel} className="ml-auto inline-flex size-6 items-center justify-center rounded text-text-faint hover:bg-border hover:text-foreground">
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-2">
        {notes.map((n, i) => (
          <div key={i} className={cn('rounded-lg border bg-background p-2', n.kind === 'forbid' ? 'border-danger/40' : 'border-border')}>
            <div className="flex items-center gap-2">
              {n.kind === 'forbid' ? <Ban size={14} className="shrink-0 text-danger" /> : <Lightbulb size={14} className="shrink-0 text-warn" />}
              <Segmented label="Tipo di nota" size="sm" value={n.kind} onChange={(kind) => update(i, { kind })} options={KINDS} className="w-48" />
              {n.lines && (
                <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-text-muted" title={n.excerpt}>
                  {linesLabel(n.lines)}
                  <button type="button" aria-label="Togli il riferimento alle righe" onClick={() => update(i, { lines: undefined, excerpt: undefined })} className="text-text-faint hover:text-foreground">
                    <X size={11} />
                  </button>
                </span>
              )}
              {notes.length > 1 && (
                <button
                  type="button"
                  aria-label="Elimina la nota"
                  onClick={() => setNotes(notes.filter((_, j) => j !== i))}
                  className="ml-auto inline-flex size-6 items-center justify-center rounded text-text-faint hover:bg-border hover:text-foreground"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {n.excerpt && (
              <pre className="mt-1.5 max-h-16 overflow-hidden rounded bg-surface px-2 py-1 font-mono text-[11px] leading-snug text-text-subtle">
                {n.excerpt.split('\n').slice(0, 3).join('\n')}
              </pre>
            )}
            <textarea
              ref={i === notes.length - 1 ? lastRef : undefined}
              value={n.text}
              rows={2}
              onChange={(e) => update(i, { text: e.target.value })}
              placeholder={n.kind === 'forbid' ? 'Cosa NON deve fare, es. «non cambiare la firma del metodo»' : 'Cosa deve fare o a cosa stare attento, es. «gestisci anche il caso null»'}
              aria-label={n.kind === 'forbid' ? 'Testo del divieto' : "Testo dell'accortezza"}
              className="mt-1.5 w-full resize-y rounded-md border border-input bg-surface px-2 py-1.5 text-[13px] text-foreground outline-none placeholder:text-text-faint focus:border-brand"
            />
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => add('care')} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[12px] text-text-muted hover:bg-border hover:text-foreground">
            <Plus size={12} /> Accortezza
          </button>
          <button type="button" onClick={() => add('forbid')} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[12px] text-text-muted hover:bg-border hover:text-foreground">
            <Plus size={12} /> Divieto
          </button>
          <button
            type="button"
            disabled={!selection}
            onClick={() => selection && add('care', selection)}
            title={selection ? undefined : 'Seleziona delle righe nel lato «dopo» del diff'}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[12px] text-text-muted hover:bg-border hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <TextSelect size={12} /> {selection ? `Nota su ${linesLabel(selection)}` : 'Nota sulle righe selezionate'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        {error ? (
          <span className="min-w-0 flex-1 text-[12px] text-danger">{error}</span>
        ) : (
          <span className="min-w-0 flex-1 text-[11px] leading-snug text-text-faint">
            Le indicazioni arrivano a Claude come un tuo messaggio. Quando riscrive il file, la modifica torna qui da rivedere.
          </span>
        )}
        <button type="button" onClick={onCancel} className="h-8 rounded-md px-3 text-[12px] text-text-subtle hover:bg-border hover:text-foreground">
          Annulla
        </button>
        <button
          type="button"
          disabled={!filled.length || sending}
          onClick={send}
          title="Ctrl+Invio"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-info px-3 text-[12px] font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Send size={13} /> {sending ? 'Invio…' : `Invia a Claude${filled.length > 1 ? ` (${filled.length})` : ''}`}
        </button>
      </div>
    </div>
  )
}
