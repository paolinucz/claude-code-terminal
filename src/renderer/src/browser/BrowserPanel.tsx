import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { ArrowLeft, ArrowRight, Loader2, RotateCw } from 'lucide-react'
import type { BrowserState } from '@shared/browser'
import { api } from '@/lib/api'
import type { PanelParams } from '@/panels/kinds'

/** Qualcosa dell'interfaccia (finestra di dialogo, menu, palette) che deve stare sopra la vista web. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/**
 * Pannello del browser integrato. La pagina web non sta nel DOM: è una `WebContentsView` del processo principale
 * posizionata sopra il segnaposto di questo pannello. Qui ci sono la barra e il calcolo della posizione; la vista si nasconde
 * quando il pannello non si vede (scheda o spazio nascosti) e quando un dialogo o un menu dell'app le passerebbe sotto.
 * Chi apre e pilota la vista è un plugin (permesso `browser`).
 */
export function BrowserPanel(props: IDockviewPanelProps<PanelParams>) {
  const id = props.params.browserId ?? ''
  const holder = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<BrowserState | null>(null)
  const [address, setAddress] = useState('')
  const editing = useRef(false)

  useEffect(() => {
    let alive = true
    void api.browser.state(id).then((s) => {
      if (alive && s) setState(s)
    })
    const off = api.browser.onState((s) => {
      if (s.id !== id) return
      if (s.closed) {
        props.api.close()
        return
      }
      setState(s)
    })
    return () => {
      alive = false
      off()
    }
  }, [id, props.api])

  // Chiudere il pannello chiude anche la vista (e l'adapter lo sa).
  useEffect(() => {
    const sub = props.containerApi.onDidRemovePanel((p) => {
      if (p.id === props.api.id) api.browser.close(id)
    })
    return () => sub.dispose()
  }, [id, props.api.id, props.containerApi])

  // La scheda segue il titolo della pagina.
  useEffect(() => {
    const title = state?.title?.trim()
    if (title && props.api.title !== title) props.api.setTitle(title.slice(0, 40))
  }, [state?.title, props.api])

  // L'indirizzo mostrato segue la pagina, tranne mentre l'utente scrive.
  useEffect(() => {
    if (!editing.current && state) setAddress(state.url)
  }, [state?.url])

  // Posizione e visibilità della vista: si confronta il rettangolo a ogni fotogramma e si manda solo se cambia.
  useEffect(() => {
    const el = holder.current
    if (!el || !id) return
    let raf = 0
    let last = ''
    const tick = () => {
      const shown = el.getClientRects().length > 0 && !document.querySelector(OVERLAY)
      const r = el.getBoundingClientRect()
      const key = shown ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}` : 'hidden'
      if (key !== last) {
        last = key
        if (shown && r.width > 0 && r.height > 0) {
          api.browser.setBounds(id, { x: r.x, y: r.y, width: r.width, height: r.height })
          api.browser.setVisible(id, true)
        } else api.browser.setVisible(id, false)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      api.browser.setVisible(id, false)
    }
  }, [id])

  const btn = 'inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:text-foreground disabled:opacity-35'
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <button type="button" className={btn} disabled={!state?.canGoBack} onClick={() => api.browser.back(id)} title="Indietro">
          <ArrowLeft size={14} />
        </button>
        <button type="button" className={btn} disabled={!state?.canGoForward} onClick={() => api.browser.forward(id)} title="Avanti">
          <ArrowRight size={14} />
        </button>
        <button type="button" className={btn} onClick={() => api.browser.reload(id)} title="Ricarica">
          {state?.loading ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
        </button>
        <input
          value={address}
          spellCheck={false}
          onFocus={() => (editing.current = true)}
          onBlur={() => {
            editing.current = false
            if (state) setAddress(state.url)
          }}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              api.browser.go(id, address)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          aria-label="Indirizzo"
          className="mx-1 h-6 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:border-brand/60"
        />
        {state?.debugging && <span className="shrink-0 rounded-md bg-brand/15 px-1.5 py-0.5 text-[10px] text-foreground">debug</span>}
      </header>
      <div ref={holder} className="min-h-0 flex-1" data-browser-view={id} />
    </div>
  )
}
