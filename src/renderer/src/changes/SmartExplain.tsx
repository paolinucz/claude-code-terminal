import { useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import type { FileChange } from '@shared/changes'
import { EXPLAIN_MODEL, explainUrl, type ExplainResult } from '@shared/explain'
import { api } from '@/lib/api'
import { useExplainSettings } from '@/state/explain'

const MODEL_LABEL = 'Haiku'

/**
 * Output smart (O1–O8): la spiegazione di una modifica scritta dal modello economico e mostrata come pagina HTML.
 * Si genera solo con il pulsante «Spiega»; quella già generata si riapre senza consumare token.
 */
export function SmartExplain({ change }: { change: FileChange }) {
  const [result, setResult] = useState<ExplainResult | null>(null)
  const [busy, setBusy] = useState(false)
  const requestRef = useRef<string | null>(null)
  const changeRef = useRef(change.id)
  changeRef.current = change.id

  // Cambiando modifica (o se Claude la aggiorna) si cerca solo la spiegazione già salvata: nessuna chiamata al modello.
  useEffect(() => {
    setResult(null)
    setBusy(false)
    requestRef.current = null
    let stale = false
    void api.explain.peek(change.id).then((r) => !stale && setResult(r))
    return () => {
      stale = true
    }
  }, [change.id, change.updatedAt])

  const run = async (force: boolean) => {
    const requestId = crypto.randomUUID()
    const forChange = change.id
    requestRef.current = requestId
    setBusy(true)
    const r = await api.explain.run(requestId, forChange, force)
    // Se nel frattempo si è scelta un'altra modifica o si è annullato, il risultato non si applica (resta comunque salvato).
    if (requestRef.current !== requestId || changeRef.current !== forChange) return
    setBusy(false)
    requestRef.current = null
    if (!r.ok && r.cancelled) return
    setResult(r)
  }

  const cancel = () => {
    if (requestRef.current) void api.explain.cancel(requestRef.current)
    requestRef.current = null
    setBusy(false)
  }

  if (busy) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" role="status">
        <Loader2 size={22} className="animate-spin text-brand" />
        <p className="text-foreground">{MODEL_LABEL} sta scrivendo la spiegazione…</p>
        <p className="max-w-sm text-[12px] text-text-faint">Di solito qualche secondo. Se cambi file, la spiegazione si salva comunque e la ritrovi qui.</p>
        <button type="button" onClick={cancel} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-text-muted hover:bg-border hover:text-foreground">
          <X size={13} /> Annulla
        </button>
      </div>
    )
  }

  if (result?.ok && result.kind === 'html') {
    return (
      <div className="flex h-full flex-col">
        {/* Isolata (O4): script permessi ma senza accesso all'app, ai cookie o alla rete (politica CSP nell'header della pagina). */}
        <iframe
          key={result.token}
          title={`Spiegazione di ${change.filePath}`}
          src={explainUrl(result.token)}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className="min-h-0 flex-1 border-0 bg-background"
        />
        <div className="mg-bar flex shrink-0 items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-text-faint">
          <span className="inline-flex items-center gap-1">
            <Sparkles size={11} /> Spiegazione di {MODEL_LABEL}
            {result.cached ? ' · salvata (nessun token consumato)' : result.costUsd !== undefined ? ` · costo stimato $${result.costUsd.toFixed(4)}` : ''}
          </span>
          <button type="button" onClick={() => void run(true)} className="ml-auto inline-flex items-center gap-1 text-text-subtle hover:text-foreground" title="Genera una spiegazione nuova (consuma token)">
            <RefreshCw size={11} /> Rigenera
          </button>
        </div>
      </div>
    )
  }

  if (result?.ok && result.kind === 'text') {
    return (
      <div className="h-full overflow-auto p-4">
        {result.warning && <p className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">Spiegazione smart non disponibile: {result.warning}</p>}
        <pre className="font-sans whitespace-pre-wrap text-[13px] leading-relaxed text-text-muted">{result.text}</pre>
        <button type="button" onClick={() => void run(true)} className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-text-muted hover:bg-border hover:text-foreground">
          <RefreshCw size={13} /> Riprova
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Sparkles size={22} className="text-brand" />
      <p className="text-foreground">Spiega questa modifica</p>
      <p className="max-w-md text-[12px] leading-relaxed text-text-faint">
        {MODEL_LABEL} ({EXPLAIN_MODEL}) scrive una pagina chiara con le parti importanti del diff. Usa il tuo login di Claude Code e consuma pochi token
        (circa un millesimo di dollaro). Parte solo quando premi il pulsante.
      </p>
      {result && !result.ok && <p className="max-w-md text-[12px] text-danger">{result.error}</p>}
      <button type="button" onClick={() => void run(false)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 font-semibold text-on-brand">
        <Sparkles size={14} /> Spiega
      </button>
      <button type="button" onClick={() => useExplainSettings.getState().setEnabled(false)} className="text-[11px] text-text-faint underline-offset-2 hover:text-foreground hover:underline">
        Nascondi la funzione
      </button>
    </div>
  )
}
