import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GripVertical } from 'lucide-react'
import { isOpen } from '@shared/changes'
import { SPACE_COLORS } from '@shared/spaces'
import { cn } from '@/lib/cn'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui-kit'
import { BotAvatar } from '@/components/BotAvatar'
import { useAppearance } from '@/state/appearance'
import { useBots } from '@/state/bots'
import { useChanges } from '@/state/changes'
import { STATUS_LABELS, useSessions } from '@/state/sessions'
import { BotPopup } from '@/terminal/BotPopup'
import { BotExpanded } from '@/terminal/BotExpanded'
import type { SessionInfo } from '@shared/sessions'
import type { Bot } from '@shared/bots'

function Bubble({ session, bot }: { session: SessionInfo; bot: Bot }) {
  const changes = useChanges((s) => s.changes)
  const pending = useMemo(() => changes.filter((c) => c.sessionId === session.id && c.status === 'pending').length, [changes, session.id])
  const openCount = useMemo(() => changes.filter((c) => c.sessionId === session.id && isOpen(c)).length, [changes, session.id])
  const attention = useSessions((s) => Boolean(s.attention[session.id]))
  const popup = useBots((s) => s.popup)
  const expanded = useBots((s) => s.expanded)
  const folder = session.cwd.split(/[\\/]/).filter(Boolean).pop() ?? session.cwd
  const active = popup === session.id || expanded === session.id
  const status = STATUS_LABELS[session.status]
  return (
    <ContextMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${bot.name}, ${status}${pending ? `, ${pending} file da rivedere` : ''}`}
              aria-pressed={active}
              onClick={() => (active ? useBots.getState().close() : useBots.getState().open(session.id))}
              className={cn('rounded-full p-1 outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring', active && 'bg-white/15')}
            >
              <BotAvatar bot={bot} status={session.status} pending={pending} attention={attention} />
            </button>
          </ContextMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p className="font-semibold">{bot.name}</p>
          <p className="mt-0.5 text-text-subtle">
            {folder} · {status}
          </p>
          {openCount > 0 && <p className="mt-0.5 text-warn">{pending > 0 ? `${pending} file da rivedere` : `${openCount} in attesa di Claude`}</p>}
        </TooltipContent>
      </Tooltip>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => useBots.getState().open(session.id)}>Apri la chat</ContextMenuItem>
        <ContextMenuItem onSelect={() => useBots.getState().expand(session.id)}>Amplia a tutta l'area</ContextMenuItem>
        <ContextMenuItem onSelect={() => useBots.getState().open(session.id, { rename: true })}>Rinomina…</ContextMenuItem>
        <ContextMenuSeparator />
        <div className="px-2 pt-1 pb-1.5" role="group" aria-label="Colore del bot">
          <p className="mb-1.5 text-[11px] font-medium text-text-faint">Colore</p>
          <div className="flex gap-1.5">
            {SPACE_COLORS.map((c, i) => (
              <button
                key={c}
                type="button"
                aria-label={`Colore ${i + 1}`}
                aria-pressed={c.toLowerCase() === bot.color.toLowerCase()}
                onClick={() => useBots.getState().style(session.id, { color: c })}
                style={{ background: c }}
                className={cn('size-5 rounded-full transition-transform hover:scale-110', c.toLowerCase() === bot.color.toLowerCase() && 'ring-2 ring-white/70 ring-offset-1 ring-offset-surface')}
              />
            ))}
          </div>
        </div>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * Bolle dei bot (come le «chat heads» di Android): una per ogni sessione di Claude viva, sul bordo della finestra, uguali in
 * tutti gli spazi. L'anello dice cosa fa il bot (giallo attende te, blu lavora); un clic apre la sua mini-chat (`BotPopup`).
 * Il blocco si trascina dalla maniglia e si ancora al bordo più vicino.
 */
export function BotBubbles() {
  const enabled = useAppearance((s) => s.claudeMode === 'bubbles')
  const sessions = useSessions((s) => s.sessions)
  const bots = useBots((s) => s.bots)
  const dock = useBots((s) => s.dock)
  const popup = useBots((s) => s.popup)
  const expanded = useBots((s) => s.expanded)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const live = useMemo(
    () => Object.values(sessions).filter((s) => s.kind === 'claude' && s.status !== 'exited').sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [sessions]
  )

  // Se la sessione della mini-chat finisce, la mini-chat si chiude.
  useEffect(() => {
    const cur = popup ?? expanded
    if (cur && !live.some((s) => s.id === cur)) useBots.getState().close()
  }, [popup, expanded, live])

  if (!enabled || live.length === 0) return null

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const dx = e.clientX - box.left
    const dy = e.clientY - box.top
    const move = (ev: PointerEvent) => setDrag({ x: ev.clientX - dx, y: Math.max(56, Math.min(window.innerHeight - box.height - 8, ev.clientY - dy)) })
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
      setDrag(null)
    }
    const up = (ev: PointerEvent) => {
      const y = Math.max(56, Math.min(window.innerHeight - box.height - 8, ev.clientY - dy))
      useBots.getState().setDock({ side: ev.clientX < window.innerWidth / 2 ? 'left' : 'right', y })
      stop()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    // Se il rilascio non arriva (finestra che perde il focus, annullamento), il trascinamento non resta attaccato al mouse.
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
  }

  const style = drag ? { left: drag.x, top: drag.y } : { top: dock.y, [dock.side]: 10 }
  return createPortal(
    <TooltipProvider delayDuration={300}>
      <div ref={ref} role="toolbar" aria-label="Bot di Claude" aria-orientation="vertical" className={cn('fixed z-40 flex flex-col items-center gap-1 rounded-full border border-white/10 bg-black/35 px-1 pt-0.5 pb-1.5 shadow-xl backdrop-blur-md', drag && 'opacity-90')} style={style}>
        <button type="button" aria-label="Sposta le bolle" title="Trascina per spostare le bolle" onPointerDown={startDrag} className="inline-flex h-5 w-8 cursor-grab touch-none items-center justify-center text-text-faint hover:text-foreground active:cursor-grabbing">
          <GripVertical size={14} className="rotate-90" />
        </button>
        {live.map((s) => (bots[s.id] ? <Bubble key={s.id} session={s} bot={bots[s.id]} /> : null))}
      </div>
      <BotPopup />
      <BotExpanded />
    </TooltipProvider>,
    document.body
  )
}
