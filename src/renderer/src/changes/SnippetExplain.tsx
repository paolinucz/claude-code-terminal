import { useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import { EXPLAIN_MODEL, explainUrl, type ExplainResult } from '@shared/explain'
import { api } from '@/lib/api'
import { useSnippetExplain } from '@/state/snippetExplain'

/**
 * Finestra «Spiega con Haiku»: il modello spiega le righe selezionate e il loro ruolo nel file.
 * Parte da sola alla scelta del comando (l'utente l'ha chiesto con il tasto destro); la risposta si salva.
 */
export function SnippetExplain() {
  const request = useSnippetExplain((s) => s.request)
  const close = useSnippetExplain((s) => s.close)
  const [result, setResult] = useState<ExplainResult | null>(null)
  const [busy, setBusy] = useState(false)
  const requestRef = useRef<string | null>(null)

  const run = async (force: boolean) => {
    if (!request) return
    const id = crypto.randomUUID()
    requestRef.current = id
    setBusy(true)
    setResult(null)
    const r = await api.explain.snippet(id, request, force)
    if (requestRef.current !== id) return
    requestRef.current = null
    setBusy(false)
    if (!r.ok && r.cancelled) return
    setResult(r)
  }

  useEffect(() => {
    setResult(null)
    if (request) void run(false)
    return () => {
      if (requestRef.current) void api.explain.cancel(requestRef.current)
      requestRef.current = null
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  if (!request) return null
  const name = request.filePath.split(/[\\/]/).pop()
  const where = request.start === request.end ? `riga ${request.start}` : `righe ${request.start}–${request.end}`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role="dialog"
      aria-label="Spiega con Haiku"
      onKeyDown={(e) => e.key === 'Escape' && close()}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="flex h-[min(640px,90vh)] w-[min(720px,95vw)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <Sparkles size={14} className="text-brand" />
          <span className="min-w-0 flex-1 truncate font-semibold text-foreground" title={request.filePath}>
            {name} · {where}
          </span>
          <button type="button" aria-label="Chiudi" onClick={close} autoFocus className="inline-flex size-7 items-center justify-center rounded text-text-faint hover:bg-border hover:text-foreground">
            <X size={14} />
          </button>
        </header>
        <div className="min-h-0 flex-1">
          {busy ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" role="status">
              <Loader2 size={22} className="animate-spin text-brand" />
              <p className="text-foreground">Haiku sta leggendo il file…</p>
              <button
                type="button"
                onClick={() => {
                  if (requestRef.current) void api.explain.cancel(requestRef.current)
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-text-muted hover:bg-border hover:text-foreground"
              >
                <X size={13} /> Annulla
              </button>
            </div>
          ) : result?.ok && result.kind === 'html' ? (
            <iframe key={result.token} title={`Spiegazione di ${name}`} src={explainUrl(result.token)} sandbox="allow-scripts" referrerPolicy="no-referrer" className="h-full w-full border-0 bg-background" />
          ) : result?.ok ? (
            <pre className="h-full overflow-auto p-4 font-sans text-[13px] whitespace-pre-wrap text-text-muted">{result.text}</pre>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="max-w-md text-danger">{result && !result.ok ? result.error : 'Nessun risultato.'}</p>
            </div>
          )}
        </div>
        <footer className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-1.5 text-[11px] text-text-faint">
          <span>
            Haiku ({EXPLAIN_MODEL})
            {result?.ok && result.kind === 'html' ? (result.cached ? ' · salvata (nessun token consumato)' : result.costUsd !== undefined ? ` · costo stimato $${result.costUsd.toFixed(4)}` : '') : ''}
          </span>
          <button type="button" disabled={busy} onClick={() => void run(true)} className="ml-auto inline-flex items-center gap-1 text-text-subtle hover:text-foreground disabled:opacity-40" title="Genera una spiegazione nuova (consuma token)">
            <RefreshCw size={11} /> Rigenera
          </button>
        </footer>
      </div>
    </div>
  )
}
