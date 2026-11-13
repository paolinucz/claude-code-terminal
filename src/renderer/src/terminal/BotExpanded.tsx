import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Minimize2, X } from 'lucide-react'
import { BotAvatar } from '@/components/BotAvatar'
import { useBots } from '@/state/bots'
import { STATUS_LABELS, useSessions } from '@/state/sessions'
import { SessionView } from './TerminalPanel'

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** Segue il rettangolo dell'area dei pannelli: la bolla ampliata la ricopre (non è una scheda). */
function useWorkspaceRect(): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)
  useEffect(() => {
    const el = document.querySelector('main[aria-label="Pannelli dello spazio"]')
    if (!el) return
    const read = () => {
      const r = el.getBoundingClientRect()
      setRect((p) => (p && p.left === r.left && p.top === r.top && p.width === r.width && p.height === r.height ? p : { left: r.left, top: r.top, width: r.width, height: r.height }))
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    window.addEventListener('resize', read)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', read)
    }
  }, [])
  return rect
}

/** La bolla ampliata a tutta l'area di lavoro: la vista completa della sessione (terminale, vista grafica, revisione). */
export function BotExpanded() {
  const id = useBots((s) => s.expanded)
  const session = useSessions((s) => (id ? s.sessions[id] : undefined))
  const bot = useBots((s) => (id ? s.bots[id] : undefined))
  const rect = useWorkspaceRect()
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renaming])
  if (!id || !session || !bot || !rect) return null
  const commit = () => {
    useBots.getState().rename(id, name)
    setRenaming(false)
  }
  return createPortal(
    <section
      aria-label={`${bot.name} ampliato`}
      onKeyDown={(e) => {
        const t = e.target as HTMLElement
        if (e.key === 'Escape' && !renaming && !t.closest('.xterm') && t.tagName !== 'TEXTAREA' && t.tagName !== 'INPUT') useBots.getState().collapse()
      }}
      className="mg-glass-content fixed z-30 flex flex-col overflow-hidden"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <header className="mg-bar flex shrink-0 items-center gap-2.5 border-b border-border px-3 py-1.5">
        <BotAvatar bot={bot} status={session.status} size={28} />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              ref={inputRef}
              aria-label="Nome del bot"
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setRenaming(false)
              }}
              className="w-56 rounded border border-brand bg-background px-1.5 py-0.5 text-[13px] font-semibold text-foreground outline-none"
            />
          ) : (
            <button type="button" onDoubleClick={() => (setName(bot.name), setRenaming(true))} title="Doppio clic per rinominare" className="block max-w-full truncate text-left text-[14px] font-semibold text-foreground">
              {bot.name}
            </button>
          )}
          <p className="truncate text-[11px] text-text-subtle">
            {STATUS_LABELS[session.status]} · {session.cwd}
          </p>
        </div>
        <button type="button" onClick={() => useBots.getState().collapse()} title="Riduci a mini-chat (Esc)" aria-label="Riduci" className="inline-flex size-7 items-center justify-center rounded-md text-text-subtle hover:bg-border hover:text-foreground">
          <Minimize2 size={15} />
        </button>
        <button type="button" onClick={() => useBots.getState().close()} title="Chiudi la vista (la sessione resta viva)" aria-label="Chiudi" className="inline-flex size-7 items-center justify-center rounded-md text-text-subtle hover:bg-border hover:text-foreground">
          <X size={15} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <SessionView
          key={id}
          sessionId={id}
          viewKey={`bot-expand-${id}`}
          viewId={`bot-expand-${id}`}
          active
          onMissing={() => useBots.getState().close()}
          onClose={() => useBots.getState().close()}
          onRestarted={(s) => useBots.getState().expand(s.id)}
        />
      </div>
    </section>,
    document.body
  )
}
