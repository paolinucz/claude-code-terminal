import { useEffect, useRef, useState } from 'react'
import { Plus, Send, Settings2, TextSelect, Trash2, X } from 'lucide-react'
import { REVIEW_KIND_LIMITS, REVIEW_TONES, type ReviewKind, type ReviewNote } from '@shared/changes'
import { useReviewKinds } from '@/state/reviewKinds'
import { TONE_BORDER, TONE_LABEL, ToneIcon } from './tone'
import { cn } from '@/lib/cn'
import type { LineSelection } from './DiffView'

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
  seed,
  onSend,
  onCancel
}: {
  sessionTitle: string
  selection: LineSelection | null
  sending: boolean
  error: string
  /** Selezione da cui è partita la revisione (tasto destro «Revisiona»): aggiunge subito una nota su quelle righe. */
  seed?: { selection: LineSelection; n: number } | null
  onSend(notes: ReviewNote[]): void
  onCancel(): void
}) {
  const kinds = useReviewKinds((s) => s.kinds)
  useEffect(() => void useReviewKinds.getState().load(), [])
  const [notes, setNotes] = useState<ReviewNote[]>([])
  const [editingKinds, setEditingKinds] = useState(false)
  const kindOf = (id: string): ReviewKind | undefined => kinds.find((k) => k.id === id)
  const lastRef = useRef<HTMLTextAreaElement>(null)
  const [focusLast, setFocusLast] = useState(0)

  useEffect(() => {
    if (focusLast) lastRef.current?.focus()
  }, [focusLast])

  const update = (i: number, patch: Partial<ReviewNote>) => setNotes(notes.map((n, j) => (j === i ? { ...n, ...patch } : n)))
  const add = (kindId: string, sel?: LineSelection) => {
    const k = kindOf(kindId) ?? kinds[0]
    const note: ReviewNote = { kind: k.id, text: '', ...(sel ? { lines: { start: sel.start, end: sel.end }, excerpt: sel.excerpt } : {}) }
    // Se l'ultima nota è vuota e senza righe, la si sostituisce invece di aggiungerne un'altra.
    const last = notes.at(-1)
    setNotes(last && !last.text.trim() && !last.lines ? [...notes.slice(0, -1), note] : [...notes, note])
    setFocusLast((n) => n + 1)
  }
  // Prima nota vuota all'apertura, o una nota già ancorata alle righe se si parte dal tasto destro.
  const seeded = useRef(0)
  useEffect(() => {
    if (kinds.length === 0) return
    if (seed && seed.n !== seeded.current) {
      seeded.current = seed.n
      add(kinds[0].id, seed.selection)
    } else if (notes.length === 0) add(kinds[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, kinds])
  const filled = notes.filter((n) => n.text.trim())
  // Nome, istruzione e colore si copiano nella nota: restano giusti anche se i tipi cambiano dopo.
  const withKind = (n: ReviewNote): ReviewNote => {
    const k = kindOf(n.kind)
    return k ? { ...n, label: k.label, hint: k.hint, tone: k.tone } : n
  }
  const send = () => filled.length && !sending && onSend(filled.map(withKind))

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
          <div key={i} className={cn('rounded-lg border bg-background p-2', TONE_BORDER[kindOf(n.kind)?.tone ?? 'info'])}>
            <div className="flex items-center gap-2">
              <ToneIcon tone={kindOf(n.kind)?.tone} />
              <select
                aria-label="Tipo di nota"
                value={n.kind}
                onChange={(e) => update(i, { kind: e.target.value })}
                className="h-7 rounded-md border border-input bg-surface px-1.5 text-[12px] text-foreground outline-none focus:border-brand"
              >
                {!kindOf(n.kind) && <option value={n.kind}>{n.kind}</option>}
                {kinds.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
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
              placeholder={kindOf(n.kind)?.placeholder ?? 'Cosa deve fare Claude su questo file'}
              aria-label={`Testo: ${kindOf(n.kind)?.label ?? 'nota'}`}
              className="mt-1.5 w-full resize-y rounded-md border border-input bg-surface px-2 py-1.5 text-[13px] text-foreground outline-none placeholder:text-text-faint focus:border-brand"
            />
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-1.5">
          {kinds.map((k) => (
            <button key={k.id} type="button" onClick={() => add(k.id)} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[12px] text-text-muted hover:bg-border hover:text-foreground">
              <Plus size={12} /> {k.label}
            </button>
          ))}
          <button
            type="button"
            disabled={!selection}
            onClick={() => selection && add(kinds[0].id, selection)}
            title={selection ? undefined : 'Seleziona delle righe nel lato «dopo» del diff'}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[12px] text-text-muted hover:bg-border hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <TextSelect size={12} /> {selection ? `Nota su ${linesLabel(selection)}` : 'Nota sulle righe selezionate'}
          </button>
          <button
            type="button"
            onClick={() => setEditingKinds((v) => !v)}
            aria-pressed={editingKinds}
            title="Configura i tipi di nota"
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-text-faint hover:bg-border hover:text-foreground"
          >
            <Settings2 size={12} /> Tipi di nota
          </button>
        </div>
        {editingKinds && <KindsEditor onClose={() => setEditingKinds(false)} />}
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

/** Modifica dei tipi di nota: nome, istruzione per Claude e colore. Vale per tutti i progetti. */
function KindsEditor({ onClose }: { onClose(): void }) {
  const saved = useReviewKinds((s) => s.kinds)
  const [draft, setDraft] = useState<ReviewKind[]>(saved)
  const [error, setError] = useState('')
  const set = (i: number, patch: Partial<ReviewKind>) => setDraft(draft.map((k, j) => (j === i ? { ...k, ...patch } : k)))
  const input = 'h-7 rounded-md border border-input bg-surface px-2 text-[12px] text-foreground outline-none placeholder:text-text-faint focus:border-brand'
  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-2">
      <p className="text-[11px] leading-snug text-text-faint">
        L'istruzione si scrive accanto alla nota nel messaggio a Claude (es. «da rispettare»): più è precisa, più Claude capisce come trattare la nota.
      </p>
      {draft.map((k, i) => (
        <div key={k.id} className="flex flex-wrap items-center gap-1.5">
          <ToneIcon tone={k.tone} />
          <input aria-label="Nome del tipo" value={k.label} maxLength={REVIEW_KIND_LIMITS.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Nome" className={cn(input, 'w-32')} />
          <input aria-label="Istruzione per Claude" value={k.hint} maxLength={REVIEW_KIND_LIMITS.hint} onChange={(e) => set(i, { hint: e.target.value })} placeholder="Istruzione per Claude" className={cn(input, 'min-w-40 flex-1')} />
          <select aria-label="Colore" value={k.tone} onChange={(e) => set(i, { tone: e.target.value as ReviewKind['tone'] })} className={input}>
            {REVIEW_TONES.map((t) => (
              <option key={t} value={t}>
                {TONE_LABEL[t]}
              </option>
            ))}
          </select>
          <button type="button" aria-label={`Elimina ${k.label}`} onClick={() => setDraft(draft.filter((_, j) => j !== i))} className="inline-flex size-7 items-center justify-center rounded text-text-faint hover:bg-border hover:text-foreground">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => setDraft([...draft, { id: crypto.randomUUID(), label: '', hint: '', tone: 'info' }])} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[12px] text-text-muted hover:bg-border hover:text-foreground">
          <Plus size={12} /> Nuovo tipo
        </button>
        <button type="button" onClick={() => void useReviewKinds.getState().restoreDefaults().then(() => onClose())} className="h-7 rounded-md px-2 text-[12px] text-text-faint hover:bg-border hover:text-foreground">
          Ripristina i predefiniti
        </button>
        {error && <span className="text-[12px] text-danger">{error}</span>}
        <button type="button" onClick={onClose} className="ml-auto h-7 rounded-md px-2 text-[12px] text-text-subtle hover:bg-border hover:text-foreground">
          Annulla
        </button>
        <button
          type="button"
          onClick={() => void useReviewKinds.getState().save(draft).then((e) => (e ? setError(e) : onClose()))}
          className="h-7 rounded-md bg-info px-3 text-[12px] font-semibold text-on-brand hover:opacity-90"
        >
          Salva
        </button>
      </div>
    </div>
  )
}
