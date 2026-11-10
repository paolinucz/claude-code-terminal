import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import { openMarkdownFind } from '@/docs/MarkdownView'
import { SIDEBAR_MAX, SIDEBAR_MIN, useSidebar } from '@/state/sidebar'
import { useSidebarViews } from './sidebarViews'

/** Barra delle icone, fissa a sinistra (stile VS Code): una icona per vista, clic su quella aperta richiude il pannello. */
export function ActivityBar() {
  const views = useSidebarViews()
  const active = useSidebar((s) => s.active)
  return (
    <nav aria-label="Barra laterale" className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-1.5">
      {views.map((v) => {
        const on = v.id === active
        return (
          <button
            key={v.id}
            type="button"
            aria-label={v.title}
            aria-pressed={on}
            title={v.shortcut ? `${v.title} (${v.shortcut})` : v.title}
            onClick={() => useSidebar.getState().toggle(v.id)}
            className={cn(
              'relative inline-flex size-10 items-center justify-center rounded-md transition-colors',
              on ? 'text-foreground' : 'text-text-faint hover:text-foreground [&_svg[data-icon]]:opacity-65 hover:[&_svg[data-icon]]:opacity-100'
            )}
          >
            {on && <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-r bg-brand" aria-hidden="true" />}
            {v.icon}
          </button>
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
    <aside aria-label={view.title} style={{ width }} className="relative flex shrink-0 flex-col border-r border-border bg-surface">
      <header className="flex h-9 shrink-0 items-center px-3 text-[11px] font-semibold tracking-wide text-text-subtle uppercase">{view.title}</header>
      <div className="min-h-0 flex-1">{view.render()}</div>
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
