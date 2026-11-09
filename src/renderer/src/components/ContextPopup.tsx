import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

/** Voce di un menu contestuale dell'app. */
export type PopupItem = { separator: true } | { label: string; icon?: ReactNode; disabled?: boolean; onSelect(): void }

interface PopupState {
  x: number
  y: number
  items: PopupItem[]
  doc: Document
}

/**
 * Menu contestuale unico per i pannelli che lo disegnano da sé (terminale, Markdown, vista grafica).
 * Si apre dove si è cliccato ma resta dentro la finestra; si chiude con Esc, clic fuori, scorrimento, ridimensionamento
 * o perdita del focus, e rida il focus a chi lo aveva (importante per il terminale). Frecce e Invio funzionano.
 */
export function useContextPopup(): { show(e: { clientX: number; clientY: number; target: EventTarget | null; preventDefault(): void }, items: PopupItem[]): void; popup: ReactNode } {
  const [state, setState] = useState<PopupState | null>(null)
  const close = useCallback(() => setState(null), [])
  const show = useCallback<ReturnType<typeof useContextPopup>['show']>((e, items) => {
    if (!items.some((i) => !('separator' in i))) return
    e.preventDefault()
    const doc = (e.target as Node | null)?.ownerDocument ?? document
    setState({ x: e.clientX, y: e.clientY, items, doc })
  }, [])
  return { show, popup: state ? <ContextPopup {...state} onClose={close} /> : null }
}

function ContextPopup({ x, y, items, doc, onClose }: PopupState & { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const previous = useRef<Element | null>(doc.activeElement)

  // Dentro la finestra: se non ci sta a destra o in basso si sposta dall'altra parte del puntatore.
  useLayoutEffect(() => {
    const el = ref.current
    const win = doc.defaultView
    if (!el || !win) return
    const margin = 4
    const { width, height } = el.getBoundingClientRect()
    const left = x + width + margin > win.innerWidth ? Math.max(margin, x - width) : x
    const top = y + height + margin > win.innerHeight ? Math.max(margin, y - height) : y
    setPos({ left, top })
    el.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true })
  }, [x, y, doc])

  useEffect(() => {
    const win = doc.defaultView
    if (!win) return
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    doc.addEventListener('mousedown', outside, true)
    doc.addEventListener('contextmenu', outside, true)
    doc.addEventListener('wheel', onClose, { capture: true, passive: true })
    doc.addEventListener('keydown', key, true)
    win.addEventListener('resize', onClose)
    win.addEventListener('blur', onClose)
    return () => {
      doc.removeEventListener('mousedown', outside, true)
      doc.removeEventListener('contextmenu', outside, true)
      doc.removeEventListener('wheel', onClose, true)
      doc.removeEventListener('keydown', key, true)
      win.removeEventListener('resize', onClose)
      win.removeEventListener('blur', onClose)
      // Il focus torna dov'era (per esempio al terminale), se non è già stato preso da altro.
      const prev = previous.current as HTMLElement | null
      if (prev && prev.isConnected && (doc.activeElement === doc.body || ref.current?.contains(doc.activeElement))) prev.focus?.({ preventScroll: true })
    }
  }, [doc, onClose])

  const move = (e: React.KeyboardEvent, dir: 1 | -1) => {
    e.preventDefault()
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])]
    if (!buttons.length) return
    const i = buttons.indexOf(doc.activeElement as HTMLButtonElement)
    buttons[(i + dir + buttons.length) % buttons.length].focus()
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      data-cct-popup
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') move(e, 1)
        else if (e.key === 'ArrowUp') move(e, -1)
      }}
      className="fixed z-[100] min-w-44 overflow-hidden rounded-lg border border-border bg-surface-2 py-1 text-[12px] shadow-lg"
    >
      {items.map((it, i) =>
        'separator' in it ? (
          <div key={i} role="separator" className="my-1 h-px bg-border" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onSelect()
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-muted outline-none',
              it.disabled ? 'opacity-40' : 'hover:bg-border hover:text-foreground focus:bg-border focus:text-foreground'
            )}
          >
            {it.icon}
            {it.label}
          </button>
        )
      )}
    </div>,
    doc.body
  )
}
