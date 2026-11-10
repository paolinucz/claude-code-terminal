import { useEffect, useRef, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { openMarkdownFind } from '@/docs/MarkdownView'
import { SIDEBAR_MAX, SIDEBAR_MIN, useSidebar } from '@/state/sidebar'
import { useSidebarViews } from './sidebarViews'

/**
 * Colori delle tessere del dock: ottanio (il colore di Magnolia) per i file, poi tinte sobrie e ben distinte. Le viste dei plugin
 * prendono un colore dal loro id, sempre lo stesso, così non cambiano da un avvio all'altro.
 */
const TILE_COLORS = ['#168294', '#6d5bd0', '#d9822b', '#3c9d5b', '#c44f7a', '#4a78d6', '#8a6f2d']
const KNOWN_TILE: Record<string, number> = { explorer: 0, search: 1 }
function tileColor(id: string): string {
  if (id in KNOWN_TILE) return TILE_COLORS[KNOWN_TILE[id]]
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TILE_COLORS[2 + (h % (TILE_COLORS.length - 2))]
}

/** Quanto si ingrandisce un'icona in base alla distanza del puntatore (come il Dock di macOS) e quanto è «larga» l'onda. */
const MAGNIFY = 0.36
const WAVE = 58
/** Raggio dei raccordi concavi tra il blocco della vista aperta e il pannello (a scheda: angoli da 10 px, spazio --cct-gap come Dockview). */
const EAR = 16

/**
 * Raccordo concavo: un quadrato con un quarto di cerchio «scavato», dello stesso colore del pannello, che fa curvare il blocco
 * della vista aperta verso il pannello (sopra e sotto), come una linguetta di cartella.
 */
const earStyle = (corner: 'top' | 'bottom'): CSSProperties => ({
  width: EAR,
  height: EAR,
  background: `radial-gradient(circle at ${corner === 'top' ? '0 0' : '0 100%'}, transparent ${EAR - 0.5}px, var(--cct-surface) ${EAR}px)`
})

/**
 * Sidebar a tessere (stile macOS) a tutta altezza, a sinistra: una tessera colorata per ogni vista, che si ingrandisce
 * avvicinando il puntatore, con il nome in un'etichetta. La vista aperta forma un blocco unico con il suo pannello: un «fondo»
 * dello stesso colore del pannello avvolge la tessera, la unisce al pannello con raccordi concavi e scivola da una vista
 * all'altra. Un clic sulla vista aperta richiude il pannello.
 */
export function ActivityBar() {
  const views = useSidebarViews()
  const active = useSidebar((s) => s.active)
  const nav = useRef<HTMLElement>(null)
  const tiles = useRef<(HTMLButtonElement | null)[]>([])
  const frame = useRef(0)

  // Ingrandimento: la scala di ogni tessera dipende dalla distanza verticale tra il puntatore e il suo centro.
  const magnify = (y: number | null) => {
    const top = nav.current?.getBoundingClientRect().top ?? 0
    for (const el of tiles.current) {
      if (!el) continue
      const row = el.parentElement as HTMLElement
      const center = top + row.offsetTop + row.offsetHeight / 2
      el.style.transform = `scale(${(y === null ? 1 : 1 + MAGNIFY * Math.exp(-(((y - center) / WAVE) ** 2))).toFixed(3)})`
    }
  }

  return (
    <nav
      ref={nav}
      aria-label="Barra laterale"
      onMouseMove={(e) => {
        const y = e.clientY
        cancelAnimationFrame(frame.current)
        frame.current = requestAnimationFrame(() => magnify(y))
      }}
      onMouseLeave={() => {
        cancelAnimationFrame(frame.current)
        magnify(null)
      }}
      className="relative z-20 flex w-[68px] shrink-0 flex-col items-stretch gap-1 bg-background pt-[calc(var(--cct-gap)+30px)] pb-3"
    >
      {views.map((v, i) => {
        const on = v.id === active
        const color = tileColor(v.id)
        return (
          <div key={v.id} className="group relative flex h-[54px] items-center justify-center">
            <AnimatePresence>
              {on && (
                <motion.div
                  layoutId="dock-block"
                  initial={{ opacity: 0, scaleX: 0.5 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  exit={{ opacity: 0, scaleX: 0.5, transition: { duration: 0.12 } }}
                  transition={{ type: 'spring', stiffness: 460, damping: 36, mass: 0.8 }}
                  style={{ originX: 1 }}
                  className="pointer-events-none absolute inset-y-0 right-[-1px] left-1.5 rounded-l-[20px] bg-surface"
                  aria-hidden="true"
                >
                  <span className="absolute right-0 bottom-full" style={earStyle('top')} />
                  <span className="absolute top-full right-0" style={earStyle('bottom')} />
                </motion.div>
              )}
            </AnimatePresence>
            <button
              ref={(el) => {
                tiles.current[i] = el
              }}
              type="button"
              aria-label={v.shortcut ? `${v.title} (${v.shortcut})` : v.title}
              aria-pressed={on}
              onClick={() => useSidebar.getState().toggle(v.id)}
              style={{
                backgroundColor: color,
                backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${color} 74%, white), ${color} 60%, color-mix(in srgb, ${color} 88%, black))`,
                transformOrigin: 'left center'
              }}
              className={cn(
                'relative z-10 ml-0.5 inline-flex size-10 items-center justify-center rounded-[13px] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_1px_2px_rgb(0_0_0/0.45),0_6px_12px_-6px_rgb(0_0_0/0.6)] transition-[transform,filter] duration-100 ease-out active:brightness-90',
                // Glifo bianco di misura uguale per tutti: i simboli dei plugin sono immagini SVG (anche di altri colori) e diventano bianchi.
                '[&_img]:size-5 [&_img]:brightness-0 [&_img]:invert [&_svg]:size-5',
                !on && 'saturate-[0.9] hover:saturate-100'
              )}
            >
              {v.icon}
            </button>
            <span
              role="tooltip"
              className="pointer-events-none absolute top-1/2 left-full z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-surface-2/95 px-2.5 py-1 text-[12px] font-medium text-foreground opacity-0 shadow-lg backdrop-blur transition-opacity duration-100 group-hover:opacity-100"
            >
              {v.title}
              {v.shortcut && <span className="ml-2 text-text-faint">{v.shortcut}</span>}
            </span>
          </div>
        )
      })}
    </nav>
  )
}

/** Pannello della vista scelta, con il bordo da trascinare per cambiare la larghezza. */
export function SideBarPanel() {
  const views = useSidebarViews()
  const active = useSidebar((s) => s.active)
  const width = useSidebar((s) => s.width)
  const dragging = useRef(false)
  const view = views.find((v) => v.id === active)
  const viewsRef = useRef(views)
  viewsRef.current = views

  // Scorciatoie: Ctrl+Maiusc+E mostra o nasconde l'Esplora file (Ctrl+B resterebbe al terminale), Ctrl+Maiusc+F la ricerca.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyE') {
        e.preventDefault()
        e.stopPropagation()
        useSidebar.getState().toggle('explorer')
      }
      // Ctrl+F: ricerca nel Markdown impaginato. Monaco ha la sua, i campi di testo la tengono, nel terminale è della shell.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyF') {
        const t = e.target as Element | null
        if (!t?.closest?.('.monaco-editor, .xterm, input, textarea, [contenteditable=true]') && openMarkdownFind()) {
          e.preventDefault()
          e.stopPropagation()
        }
      }
      // Scorciatoie dichiarate dai plugin per le loro viste (es. «Ctrl+Maiusc+D»): Ctrl/Maiusc/Alt + una lettera o cifra.
      for (const v of viewsRef.current) {
        const m = v.shortcut && /^((?:ctrl|maiusc|alt)\+)+([a-z0-9])$/i.exec(v.shortcut.trim())
        if (!m) continue
        const parts = v.shortcut!.toLowerCase().split('+')
        const want = { ctrl: parts.includes('ctrl'), shift: parts.includes('maiusc'), alt: parts.includes('alt') }
        const key = parts[parts.length - 1]
        if (v.id.includes(':') && e.ctrlKey === want.ctrl && e.shiftKey === want.shift && e.altKey === want.alt && e.key.toLowerCase() === key) {
          e.preventDefault()
          e.stopPropagation()
          useSidebar.getState().toggle(v.id)
          return
        }
      }
      // Ctrl+Maiusc+F: ricerca nei file (anche dal terminale: non è un tasto della shell). Il testo selezionato diventa la ricerca.
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyF') {
        e.preventDefault()
        e.stopPropagation()
        // Testo selezionato: in Monaco quello dell'editor col focus (caricato solo se serve), altrimenti quello della pagina.
        const propose = (raw: string) => useSidebar.getState().focusSearch(raw.includes('\n') ? '' : raw.trim().slice(0, 200))
        if ((document.activeElement as Element | null)?.closest?.('.monaco-editor')) {
          void import('@/lib/monaco').then(({ monaco }) => {
            const ed = monaco.editor.getEditors().find((x) => x.hasTextFocus())
            const sel = ed?.getSelection()
            propose(ed && sel ? (ed.getModel()?.getValueInRange(sel) ?? '') : '')
          })
        } else propose(document.getSelection()?.toString() ?? '')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!view) return null
  return (
    <aside aria-label={view.title} style={{ width }} className="relative my-(--cct-gap) flex shrink-0 flex-col rounded-[10px] border border-border bg-surface">
      <header className="flex h-9 shrink-0 items-center px-3 text-[11px] font-semibold tracking-wide text-text-subtle uppercase">{view.title}</header>
      <div className="min-h-0 flex-1 overflow-hidden rounded-b-[10px]">{view.render()}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Larghezza della barra laterale"
        tabIndex={0}
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return
          const left = e.currentTarget.parentElement!.getBoundingClientRect().left
          useSidebar.setState({ width: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(e.clientX - left))) })
        }}
        onPointerUp={(e) => {
          dragging.current = false
          e.currentTarget.releasePointerCapture(e.pointerId)
          useSidebar.getState().setWidth(useSidebar.getState().width)
        }}
        onKeyDown={(e) => {
          const s = useSidebar.getState()
          if (e.key === 'ArrowLeft') s.setWidth(s.width - 16)
          if (e.key === 'ArrowRight') s.setWidth(s.width + 16)
        }}
        className="absolute top-0 right-[-3px] bottom-0 z-10 w-1.5 cursor-col-resize hover:bg-brand/40 focus-visible:bg-brand/40"
      />
    </aside>
  )
}
