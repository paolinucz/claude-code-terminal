import { lazy, Suspense } from 'react'
import { Check, ChevronDown, ChevronRight, MessageSquarePlus, RotateCcw, Undo2 } from 'lucide-react'
import { isOpen, REVIEW_RUNNING_MESSAGE } from '@shared/changes'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Segmented } from '@/components/ui-kit'
import { MarkdownView } from '@/docs/MarkdownView'
import { CHANGE_STATUS_COLORS, CHANGE_STATUS_LABELS, splitPath } from '@/state/changes'
import { DIFF_MODES, useReviewUi } from '@/state/review'
import { useSnippetExplain } from '@/state/snippetExplain'
import { RevisionComposer } from './RevisionComposer'
import { SmartExplain } from './SmartExplain'
import { ToneIcon } from './tone'
import type { ReviewApi, ReviewBase, ReviewView } from './useReview'

const DiffView = lazy(() => import('./DiffView'))

const VIEWS = [
  { id: 'diff', label: 'Diff' },
  { id: 'explain', label: 'Spiegazione' }
] as const satisfies readonly { id: ReviewView; label: string }[]

const BASES = [
  { id: 'lastRequest', label: "Dall'ultima richiesta" },
  { id: 'original', label: "Dall'originale" }
] as const satisfies readonly { id: ReviewBase; label: string }[]

/**
 * La parte «diff» della revisione: intestazione con Approva / Rifiuta / Richiedi modifiche, avviso se Claude sta lavorando,
 * confronto e storico delle richieste, il diff vero (Monaco, Markdown impaginato o spiegazione) e il compositore di richieste.
 * Sta sia nella panoramica «Modifiche» sia nel cassetto accanto al terminale.
 */
export function ReviewDiff({ review, emptyText }: { review: ReviewApi; emptyText?: string }) {
  const r = review
  const { selected, contents } = r
  const diffMode = useReviewUi((s) => s.diffMode)

  if (!selected) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-text-faint">
        {emptyText ?? (r.toReview === 0 ? 'Tutte le modifiche sono state riviste.' : "Scegli un file dall'elenco.")}
      </div>
    )
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 truncate font-mono text-[12px] text-foreground" title={selected.filePath}>
          {splitPath(selected).name}
          <span className="text-text-faint"> · prima ↔ dopo</span>
        </span>
        {r.explainOn && <Segmented label="Vista" size="sm" value={r.view} onChange={r.setView} options={VIEWS} className="w-44" />}
        {r.view === 'diff' && !(r.isMd && r.mdMode === 'layout') && (
          <Segmented label="Come leggere il diff" size="sm" value={diffMode} onChange={(m) => useReviewUi.getState().setDiffMode(m)} options={DIFF_MODES} className="w-56" />
        )}
        {r.isMd && r.view === 'diff' && (
          <Segmented
            label="Aspetto del Markdown"
            size="sm"
            value={r.mdMode}
            onChange={r.setMdMode}
            options={[
              { id: 'layout', label: 'Impaginato' },
              { id: 'source', label: 'Sorgente' }
            ]}
            className="w-44"
          />
        )}
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
                disabled={r.busy || r.selectedRunning}
                title={r.selectedRunning ? REVIEW_RUNNING_MESSAGE : undefined}
                onClick={() => r.setRejecting({ change: selected, force: false })}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-danger/50 px-2.5 text-[12px] text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
              >
                <Undo2 size={13} /> Rifiuta
              </button>
              <button
                type="button"
                disabled={r.busy || selected.status === 'revision'}
                onClick={() => r.setComposing((v) => !v)}
                aria-pressed={r.composing}
                title={selected.status === 'revision' ? 'Hai già chiesto modifiche: aspetta che Claude aggiorni il file' : 'Aggiungi accortezze o divieti e rimanda il file a Claude'}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors disabled:opacity-40',
                  r.composing ? 'border-info bg-info/15 text-foreground' : 'border-info/50 text-info hover:bg-info/10'
                )}
              >
                <MessageSquarePlus size={13} /> Richiedi modifiche
              </button>
              <button
                type="button"
                disabled={r.busy || r.selectedRunning}
                title={r.selectedRunning ? REVIEW_RUNNING_MESSAGE : undefined}
                onClick={() => void r.approve(selected)}
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

      {r.selectedRunning && isOpen(selected) && (
        <p className="shrink-0 border-b border-warn/40 bg-warn/10 px-3 py-1.5 text-[12px] text-warn" role="status">
          {REVIEW_RUNNING_MESSAGE} Intanto puoi preparare le richieste di modifica: vanno in coda a Claude.{' '}
          <button
            type="button"
            onClick={() => void api.sessions.markIdle(selected.sessionId)}
            title="Claude Code non avvisa quando lo si interrompe con Esc: se è fermo davvero, sblocca la revisione"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Claude è fermo? Sblocca
          </button>
        </p>
      )}

      {/* Stato della richiesta, confronto e storico */}
      {(selected.status === 'revision' || r.canCompareLast || (contents?.requests.length ?? 0) > 0) && (
        <div className="mg-bar flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-[12px]">
          {selected.status === 'revision' && <span className="text-info">Modifiche richieste: aspetto che Claude aggiorni il file. Puoi comunque approvare o rifiutare.</span>}
          {r.canCompareLast && (
            <>
              <span className="text-text-subtle">Claude ha aggiornato il file dopo la tua richiesta.</span>
              <Segmented label="Confronta" size="sm" value={r.base} onChange={r.setBase} options={BASES} className="w-72" />
            </>
          )}
          {(contents?.requests.length ?? 0) > 0 && (
            <button type="button" onClick={() => r.setHistoryOpen((v) => !v)} className="ml-auto inline-flex items-center gap-1 text-text-subtle hover:text-foreground">
              {r.historyOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Richieste inviate ({contents!.requests.length})
            </button>
          )}
        </div>
      )}
      {r.historyOpen && contents && (
        <div className="max-h-40 shrink-0 space-y-2 overflow-auto border-b border-border px-3 py-2 text-[12px]">
          {contents.requests.map((q, i) => (
            <div key={q.id}>
              <p className="text-[11px] text-text-faint">
                Richiesta {i + 1} · {new Date(q.createdAt).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {q.notes.map((n, j) => (
                  <li key={j} className="flex items-start gap-1.5 text-text-muted">
                    <ToneIcon tone={n.tone ?? (n.kind === 'forbid' ? 'danger' : 'warn')} size={12} className="mt-0.5" />
                    <span>
                      {n.lines && <span className="font-mono text-text-faint">{n.lines.start === n.lines.end ? `r. ${n.lines.start}` : `r. ${n.lines.start}–${n.lines.end}`} · </span>}
                      {n.label && <span className="font-semibold">{n.label}: </span>}
                      {n.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {r.view === 'explain' && r.explainOn ? (
          <SmartExplain change={selected} />
        ) : contents === null ? (
          <p className="p-4 text-text-faint">Caricamento…</p>
        ) : contents.binary ? (
          <p className="p-4 text-text-subtle">File binario: il diff non è disponibile.</p>
        ) : r.diffBefore === null || r.diffBefore === undefined || contents.after === null ? (
          <p className="p-4 text-text-subtle">Il contenuto non è disponibile (file troppo grande o archivio degli snapshot mancante).</p>
        ) : r.mdDiff ? (
          <div className="flex h-full flex-col">
            <p className="shrink-0 border-b border-border px-4 py-1.5 text-[11px] text-text-faint">
              {r.mdDiff.added + r.mdDiff.removed === 0 ? 'Nessuna differenza nei contenuti.' : `${r.mdDiff.added} blocchi aggiunti o cambiati (verde), ${r.mdDiff.removed} tolti (rosso).`}
            </p>
            <MarkdownView
              html={r.mdDiff.html}
              findable
              className="min-h-0 flex-1"
              actions={{
                source: contents.after,
                onReview: isOpen(selected) && selected.status !== 'revision' ? r.startReview : undefined,
                onExplain: r.explainOn ? (sel) => useSnippetExplain.getState().open({ filePath: selected.filePath, text: contents.after!, start: sel.start, end: sel.end }) : undefined
              }}
            />
          </div>
        ) : (
          <Suspense fallback={<p className="p-4 text-text-faint">Caricamento del diff…</p>}>
            <DiffView
              key={`${selected.id}:${r.base}`}
              filePath={selected.filePath}
              before={r.diffBefore}
              after={contents.after}
              mode={diffMode}
              onSelection={r.setSelection}
              onReview={isOpen(selected) && selected.status !== 'revision' ? r.startReview : undefined}
            />
          </Suspense>
        )}
      </div>

      {r.composing && (
        <RevisionComposer
          sessionTitle={selected.sessionTitle}
          selection={r.selection}
          seed={r.seed}
          sending={r.busy}
          error={r.composeError}
          onSend={(notes) => void r.requestRevision(selected, notes)}
          onCancel={() => r.setComposing(false)}
        />
      )}
    </section>
  )
}
