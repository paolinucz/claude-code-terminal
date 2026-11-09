import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaseSensitive, ChevronDown, ChevronUp, X } from 'lucide-react'
import { cn } from '@/lib/cn'

const HL_ALL = 'cct-find'
const HL_CURRENT = 'cct-find-current'

/** Intervalli di testo che corrispondono, nell'ordine del documento (testo semplice, senza leggere l'HTML). */
export function findRanges(root: HTMLElement, query: string, caseSensitive: boolean): Range[] {
  if (!query) return []
  const doc = root.ownerDocument
  const needle = caseSensitive ? query : query.toLowerCase()
  const out: Range[] = []
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = caseSensitive ? (n.nodeValue ?? '') : (n.nodeValue ?? '').toLowerCase()
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      const r = doc.createRange()
      r.setStart(n, at)
      r.setEnd(n, at + needle.length)
      out.push(r)
    }
  }
  return out
}

/**
 * Ricerca nel documento (Ctrl+F) per i Markdown impaginati, con la stessa idea della ricerca di VS Code:
 * tutte le corrispondenze evidenziate, quella corrente più marcata, Invio / Maiusc+Invio per scorrere.
 * Evidenzia con la Custom Highlight API: l'HTML della pagina non si tocca.
 */
export function FindBar({ root, onClose, initial }: { root: HTMLElement; onClose(): void; initial?: string }) {
  const [query, setQuery] = useState(initial ?? '')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [current, setCurrent] = useState(0)
  const [count, setCount] = useState(0)
  const rangesRef = useRef<Range[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const win = root.ownerDocument.defaultView

  // Posizione: in alto a destra dell'area che scorre.
  useLayoutEffect(() => {
    const place = () => {
      const r = root.getBoundingClientRect()
      setPos({ top: r.top + 8, right: (win?.innerWidth ?? 0) - r.right + 18 })
    }
    place()
    win?.addEventListener('resize', place)
    return () => win?.removeEventListener('resize', place)
  }, [root, win])

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Trova, evidenzia e porta in vista quella corrente.
  useEffect(() => {
    const ranges = findRanges(root, query, caseSensitive)
    rangesRef.current = ranges
    setCount(ranges.length)
    setCurrent((c) => (ranges.length ? Math.min(c, ranges.length - 1) : 0))
  }, [root, query, caseSensitive, root.innerHTML.length])

  useEffect(() => {
    const css = win?.CSS as (typeof CSS & { highlights?: Map<string, unknown> }) | undefined
    const HighlightCtor = (win as unknown as { Highlight?: new (...r: Range[]) => unknown } | null)?.Highlight
    const ranges = rangesRef.current
    if (!css?.highlights || !HighlightCtor) return
    css.highlights.set(HL_ALL, new HighlightCtor(...ranges))
    const cur = ranges[current]
    css.highlights.set(HL_CURRENT, cur ? new HighlightCtor(cur) : new HighlightCtor())
    cur?.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
  }, [current, count, query, caseSensitive, win])

  // Alla chiusura si toglie l'evidenziazione.
  useEffect(
    () => () => {
      const css = win?.CSS as (typeof CSS & { highlights?: Map<string, unknown> }) | undefined
      css?.highlights?.delete(HL_ALL)
      css?.highlights?.delete(HL_CURRENT)
    },
    [win]
  )

  const step = (dir: 1 | -1) => {
    if (!count) return
    setCurrent((c) => (c + dir + count) % count)
  }

  const btn = 'inline-flex size-6 items-center justify-center rounded text-text-subtle hover:bg-border hover:text-foreground disabled:opacity-40'
  return createPortal(
    <div
      role="search"
      aria-label="Cerca nel documento"
      style={{ top: pos.top, right: pos.right }}
      className="fixed z-[60] flex items-center gap-1 rounded-lg border border-border bg-surface-2 px-1.5 py-1 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          step(e.shiftKey ? -1 : 1)
        }
      }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setCurrent(0)
        }}
        spellCheck={false}
        placeholder="Trova"
        aria-label="Testo da trovare"
        className="h-6 w-44 rounded border border-input bg-background px-2 text-[12px] text-foreground outline-none placeholder:text-text-faint focus:border-brand"
      />
      <span className={cn('min-w-14 text-center text-[11px]', query && count === 0 ? 'text-danger' : 'text-text-subtle')} aria-live="polite">
        {query ? (count ? `${current + 1} di ${count}` : 'Nessun risultato') : ''}
      </span>
      <button type="button" aria-pressed={caseSensitive} title="Maiuscole e minuscole" aria-label="Maiuscole e minuscole" onClick={() => setCaseSensitive((v) => !v)} className={cn(btn, caseSensitive && 'bg-brand/25 text-foreground')}>
        <CaseSensitive size={14} />
      </button>
      <button type="button" title="Precedente (Maiusc+Invio)" aria-label="Risultato precedente" disabled={!count} onClick={() => step(-1)} className={btn}>
        <ChevronUp size={14} />
      </button>
      <button type="button" title="Successivo (Invio)" aria-label="Risultato successivo" disabled={!count} onClick={() => step(1)} className={btn}>
        <ChevronDown size={14} />
      </button>
      <button type="button" title="Chiudi (Esc)" aria-label="Chiudi la ricerca" onClick={onClose} className={btn}>
        <X size={14} />
      </button>
    </div>,
    root.ownerDocument.body
  )
}
