import { useEffect, useRef, useState } from 'react'
import { Copy, MessageSquareWarning, Sparkles } from 'lucide-react'
import { useContextPopup, type PopupItem } from '@/components/ContextPopup'
import { FindBar } from './FindBar'
import type { LineSelection } from '@/changes/DiffView'
import { openFile } from '@/state/editor'
import { cn } from '@/lib/cn'

/** Revisione e spiegazione dal Markdown impaginato: le righe vengono dagli attributi `data-l` dei blocchi. */
export interface MarkdownActions {
  /** Testo sorgente da cui è stato generato l'HTML (per ricavare l'estratto delle righe). */
  source: string
  /** Voce «Revisiona…» del tasto destro (assente = la voce non c'è). */
  onReview?(sel: LineSelection): void
  /** Voce «Spiega con Haiku» (assente = la voce non c'è). */
  onExplain?(sel: LineSelection): void
}

/** Righe del sorgente toccate dalla selezione: dal primo all'ultimo blocco che la interseca. */
function selectionLines(root: HTMLElement, source: string): LineSelection | null {
  const sel = root.ownerDocument.defaultView?.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  let start = Infinity
  let end = 0
  root.querySelectorAll<HTMLElement>('[data-l]').forEach((el) => {
    if (!range.intersectsNode(el)) return
    const [s, e] = (el.getAttribute('data-l') ?? '').split('-').map(Number)
    if (!Number.isFinite(s) || !Number.isFinite(e)) return
    start = Math.min(start, s)
    end = Math.max(end, e)
  })
  if (end === 0) return null
  const excerpt = source.replace(/\r\n?/g, '\n').split('\n').slice(start - 1, end).join('\n')
  return { start, end, excerpt }
}

/**
 * Markdown che supportano Ctrl+F (con `findable`): il tasto va a quello su cui si è cliccato per ultimo, se è ancora
 * visibile, altrimenti al primo visibile. Chi gestisce Ctrl+F da fuori (la scorciatoia globale) usa `openMarkdownFind`.
 */
const findables = new Set<{ el: HTMLElement; open(initial?: string): void }>()
let lastTouched: HTMLElement | null = null

/** Apre la ricerca nel Markdown giusto. `false` se non c'è nessun Markdown visibile che la supporti. */
export function openMarkdownFind(initial?: string): boolean {
  const visible = [...findables].filter((f) => f.el.isConnected && f.el.getClientRects().length > 0)
  const target = visible.find((f) => lastTouched && f.el.contains(lastTouched)) ?? visible[0]
  if (!target) return false
  target.open(initial)
  return true
}

/** Markdown già trasformato da `renderMarkdown`/`renderMarkdownDiff` (HTML sanificato): link ai file e ancore funzionanti. */
export function MarkdownView({ html, className, actions, findable }: { html: string; className?: string; actions?: MarkdownActions; findable?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [find, setFind] = useState<{ n: number; initial?: string } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!findable || !el) return
    const entry = { el, open: (initial?: string) => setFind((f) => ({ n: (f?.n ?? 0) + 1, initial })) }
    findables.add(entry)
    return () => void findables.delete(entry)
  }, [findable])
  const { show, popup } = useContextPopup()

  // Tasto destro su un testo selezionato: Revisiona / Spiega con Haiku (se disponibili) e Copia.
  // Senza selezione, o in un Markdown senza azioni, compare il menu di base dell'app (Copia).
  const onContextMenu = (e: React.MouseEvent) => {
    const root = ref.current
    const text = root?.ownerDocument.defaultView?.getSelection()?.toString() ?? ''
    if (!actions || !root || !text.trim()) return
    const sel = selectionLines(root, actions.source)
    const items: PopupItem[] = []
    if (actions.onReview) items.push({ label: 'Revisiona…', icon: <MessageSquareWarning size={13} />, disabled: !sel, onSelect: () => sel && actions.onReview!(sel) })
    if (actions.onExplain) items.push({ label: 'Spiega con Haiku', icon: <Sparkles size={13} />, disabled: !sel, onSelect: () => sel && actions.onExplain!(sel) })
    if (items.length) items.push({ separator: true })
    items.push({ label: 'Copia', icon: <Copy size={13} />, onSelect: () => void navigator.clipboard.writeText(text) })
    show(e, items)
  }

  // Il tasto destro non deve cancellare la selezione su cui si vuole agire (succede quando il clic cade su altro testo).
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2 && actions && ref.current?.ownerDocument.defaultView?.getSelection()?.toString().trim()) e.preventDefault()
  }

  const onClick = (e: React.MouseEvent) => {
    const copy = (e.target as HTMLElement).closest('[data-copy]')
    if (copy) {
      const code = copy.closest('pre')?.querySelector('code')?.textContent ?? ''
      void navigator.clipboard.writeText(code).then(() => {
        copy.textContent = 'Copiato'
        window.setTimeout(() => (copy.textContent = 'Copia'), 1500)
      })
      return
    }
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const file = a.getAttribute('data-file')
    const anchor = a.getAttribute('data-anchor')
    if (file) openFile(file)
    else if (anchor) {
      const target = [...(ref.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? [])].find(
        (h) => (h.textContent ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') === anchor.toLowerCase()
      )
      target?.scrollIntoView({ block: 'start' })
    }
  }

  return (
    <>
      <div ref={ref} tabIndex={findable ? -1 : undefined} onClick={onClick} onMouseDown={(e) => { lastTouched = e.currentTarget; onMouseDown(e) }} onContextMenu={onContextMenu} className={cn('cct-md overflow-y-auto px-6 py-4', className)} dangerouslySetInnerHTML={{ __html: html }} />
      {popup}
      {find && ref.current && <FindBar key={find.n} root={ref.current} initial={find.initial} onClose={() => { setFind(null); ref.current?.focus() }} />}
    </>
  )
}
