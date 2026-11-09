import { useEffect, useRef } from 'react'
import { ClipboardPaste, Copy, Eraser, TextSelect } from 'lucide-react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { api } from '@/lib/api'
import { TERMINAL_FONT_FAMILY, useTerminalSettings } from '@/state/terminalSettings'
import { useContextPopup, type PopupItem } from '@/components/ContextPopup'
import { sessionHub } from './hub'

/** Colori del terminale, dal tema dell'app (mockup). */
const THEME: ITheme = {
  background: '#09090b',
  foreground: '#e4e4e7',
  cursor: '#e8875f',
  cursorAccent: '#09090b',
  selectionBackground: 'rgba(232, 135, 95, 0.30)',
  black: '#27272a',
  red: '#ff8a8a',
  green: '#6fd39b',
  yellow: '#f5c46b',
  blue: '#6ea8fe',
  magenta: '#c792ea',
  cyan: '#7fd4e6',
  white: '#d4d4d8',
  brightBlack: '#71717a',
  brightRed: '#ffb3b3',
  brightGreen: '#a8f0c6',
  brightYellow: '#f8d898',
  brightBlue: '#9cc4ff',
  brightMagenta: '#ddb8f5',
  brightCyan: '#a9e6f2',
  brightWhite: '#fafafa'
}

/**
 * Aspetta che JetBrains Mono sia caricato in tutte le varianti usate dal terminale
 * (normale, grassetto, corsivo), nel documento giusto: le finestre staccate hanno un documento proprio.
 * Dopo 2 secondi si procede comunque, con il font di ripiego.
 */
function waitForTerminalFont(doc: Document): Promise<unknown> {
  const family = '"JetBrains Mono Variable"'
  const loads = ['400', '700', 'italic 400', 'italic 700'].map((v) => doc.fonts.load(`${v} 14px ${family}`).catch(() => []))
  return Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 2000))])
}

interface Props {
  sessionId: string
  /** Id univoco della vista (un pannello = una vista). */
  viewId: string
  /** La sessione non esiste più (per esempio dopo un riavvio dell'app). */
  onMissing(): void
  onExit(code: number): void
  /** Il pannello è attivo nel suo gruppo: la vista prende il focus. */
  active: boolean
}

/**
 * Vista di una sessione (S3): più viste possono mostrare la stessa sessione e scriverci tutte.
 * La dimensione del processo la decide la vista con il focus; le altre si adeguano.
 */
export function TerminalView({ sessionId, viewId, onMissing, onExit, active }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const callbacks = useRef({ onMissing, onExit })
  callbacks.current = { onMissing, onExit }
  const { show, popup } = useContextPopup()
  const showRef = useRef(show)
  showRef.current = show

  /** Crea il terminale nel contenitore e lo collega alla sessione. Restituisce la funzione di chiusura. */
  function start(host: HTMLDivElement): () => void {
    const win = host.ownerDocument.defaultView ?? window
    let disposed = false

    const term = new Terminal({
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: useTerminalSettings.getState().fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: THEME,
      windowsPty: window.api ? { backend: 'conpty' } : undefined
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, '_blank')))
    term.open(host)
    // Renderer DOM (predefinito di xterm). L'addon WebGL disegnava i caratteri con un font di ripiego
    // proporzionale invece di JetBrains Mono, con lettere distanziate: per questo non si usa.

    // Output: finché non arriva l'istantanea si tiene da parte, poi si applicano solo i blocchi successivi.
    let snapshotSeq = -1
    const buffered: [number, string][] = []
    const offData = sessionHub.onData(sessionId, (seq, data) => {
      if (snapshotSeq < 0) buffered.push([seq, data])
      else if (seq > snapshotSeq) term.write(data)
    })
    const offResize = sessionHub.onResize(sessionId, (cols, rows) => {
      if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows)
    })
    const offExit = sessionHub.onExit(sessionId, (code) => {
      term.write(`\r\n\x1b[2m[sessione terminata · codice ${code}]\x1b[0m\r\n`)
      callbacks.current.onExit(code)
    })

    const isFocused = () => host.ownerDocument.activeElement === term.textarea
    const sendSize = (claim: boolean) => {
      const dims = fit.proposeDimensions()
      if (!dims || !Number.isFinite(dims.cols) || dims.cols < 2) return
      api.sessions.resize(sessionId, viewId, dims.cols, dims.rows, claim)
    }

    void api.sessions.attach(sessionId, viewId).then((snap) => {
      if (disposed) return
      if (!snap) {
        callbacks.current.onMissing()
        return
      }
      term.resize(snap.info.cols, snap.info.rows)
      term.write(snap.data)
      snapshotSeq = snap.seq
      for (const [seq, data] of buffered) if (seq > snap.seq) term.write(data)
      buffered.length = 0
      if (snap.info.status === 'exited') term.write(`\r\n\x1b[2m[sessione terminata · codice ${snap.info.exitCode ?? '?'}]\x1b[0m\r\n`)
      sendSize(false)
    })

    const inputSub = term.onData((data) => api.sessions.input(sessionId, viewId, data))
    // Prendere il focus vuol dire prendere il comando della dimensione.
    const onFocus = () => sendSize(true)
    term.textarea?.addEventListener('focus', onFocus)

    let raf = 0
    const ResizeObs = (win as typeof window).ResizeObserver ?? ResizeObserver
    const observer = new ResizeObs(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => sendSize(isFocused()))
    })
    observer.observe(host)

    // Dimensione del carattere: Ctrl + / Ctrl - / Ctrl 0 e Ctrl + rotellina, come nei terminali più comuni.
    const settings = useTerminalSettings.getState()
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return true
      if (e.key === '+' || e.key === '=') settings.bigger()
      else if (e.key === '-') settings.smaller()
      else if (e.key === '0') settings.reset()
      else return true
      e.preventDefault()
      return false
    })
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      if (e.deltaY < 0) settings.bigger()
      else if (e.deltaY > 0) settings.smaller()
    }
    host.addEventListener('wheel', onWheel, { passive: false, capture: true })

    // Tasto destro: menu con Copia / Incolla / Seleziona tutto / Pulisci (xterm di suo non ne ha).
    const onContext = (e: MouseEvent) => {
      e.stopPropagation()
      const text = term.getSelection()
      const items: PopupItem[] = [
        { label: 'Copia', icon: <Copy size={13} />, disabled: !text, onSelect: () => void navigator.clipboard.writeText(text) },
        {
          label: 'Incolla',
          icon: <ClipboardPaste size={13} />,
          onSelect: () => void navigator.clipboard.readText().then((t) => t && term.paste(t)).catch(() => undefined)
        },
        { separator: true },
        { label: 'Seleziona tutto', icon: <TextSelect size={13} />, onSelect: () => term.selectAll() },
        { label: 'Pulisci lo schermo', icon: <Eraser size={13} />, onSelect: () => term.clear() }
      ]
      showRef.current(e, items)
    }
    host.addEventListener('contextmenu', onContext)

    const applyFont = () => {
      term.clearTextureAtlas()
      sendSize(isFocused())
    }
    const offSettings = useTerminalSettings.subscribe((s, prev) => {
      if (s.fontSize === prev.fontSize) return
      term.options.fontSize = s.fontSize
      applyFont()
    })
    return () => {
      disposed = true
      offSettings()
      host.removeEventListener('wheel', onWheel, { capture: true })
      host.removeEventListener('contextmenu', onContext)
      cancelAnimationFrame(raf)
      observer.disconnect()
      term.textarea?.removeEventListener('focus', onFocus)
      inputSub.dispose()
      offData()
      offResize()
      offExit()
      api.sessions.detach(sessionId, viewId)
      term.dispose()
      termRef.current = null
    }
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // xterm misura la larghezza delle celle quando si apre: se il font non è ancora caricato la misura
    // viene fatta con un font di ripiego più largo e le lettere risultano distanziate. Quindi si aspetta il font.
    let cancelled = false
    let stop: (() => void) | null = null
    void waitForTerminalFont(host.ownerDocument).then(() => {
      if (!cancelled) stop = start(host)
    })
    return () => {
      cancelled = true
      stop?.()
    }
    // start dipende solo da sessionId e viewId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, viewId])

  useEffect(() => {
    if (active) termRef.current?.focus()
  }, [active])

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
      <div ref={hostRef} className="absolute inset-0 py-1 pl-2" />
      {popup}
    </div>
  )
}
