import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import type { Bot } from '@shared/bots'
import type { SessionInfo } from '@shared/sessions'
import { BotAvatar } from '@/components/BotAvatar'
import { useBots, type BotDock } from '@/state/bots'
import { useChanges } from '@/state/changes'
import { useReviewUi } from '@/state/review'
import { STATUS_LABELS, useSessions } from '@/state/sessions'
import { ConversationView } from './ConversationView'
import { PromptBox } from './PromptBox'

/** Mini-chat di un bot: la sua vista grafica e la casella di input, in un pop-up accanto alle bolle. */
export function BotPopup() {
  const id = useBots((s) => s.popup)
  const session = useSessions((s) => (id ? s.sessions[id] : undefined))
  const bot = useBots((s) => (id ? s.bots[id] : undefined))
  const dock = useBots((s) => s.dock)
  if (!id || !session || !bot) return null
  return <Popup key={id} session={session} bot={bot} dock={dock} />
}

function Popup({ session, bot, dock }: { session: SessionInfo; bot: Bot; dock: BotDock }) {
  const renameOnOpen = useBots((s) => s.renameOnOpen)
  const [renaming, setRenaming] = useState(renameOnOpen)
  const [name, setName] = useState(bot.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const changes = useChanges((s) => s.changes)
  const pending = useMemo(() => changes.filter((c) => c.sessionId === session.id && c.status === 'pending').length, [changes, session.id])
  const reviewUser = useReviewUi((s) => Boolean(s.sessions[session.id]?.open && !s.sessions[session.id]?.autoOpened))

  /** Amplia la bolla a tutta l'area di lavoro (lì c'è anche il cassetto di revisione). */
  const expand = () => useBots.getState().expand(session.id)

  // La revisione si fa nella vista ampliata: se la apri da qui (banner «Apri la revisione»), la bolla si amplia.
  useEffect(() => {
    if (reviewUser) expand()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewUser])

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renaming])

  const width = Math.min(460, window.innerWidth - 110)
  const height = Math.min(680, window.innerHeight - 100)
  const top = Math.max(56, Math.min(dock.y - 24, window.innerHeight - height - 12))
  const commit = () => {
    useBots.getState().rename(session.id, name)
    setRenaming(false)
  }

  return (
    <div
      role="dialog"
      aria-label={`Chat con ${bot.name}`}
      onKeyDown={(e) => {
        const t = e.target as HTMLElement
        if (e.key === 'Escape' && !renaming && t.tagName !== 'TEXTAREA' && t.tagName !== 'INPUT') useBots.getState().close()
      }}
      className="mg-glass-sheet fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
      style={{ top, [dock.side]: 76, width, height }}
    >
      <header className="mg-bar flex shrink-0 items-center gap-2.5 border-b border-border px-3 py-2">
        <BotAvatar bot={bot} status={session.status} size={30} />
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
                if (e.key === 'Escape') {
                  setName(bot.name)
                  setRenaming(false)
                }
              }}
              className="w-full rounded border border-brand bg-background px-1.5 py-0.5 text-[13px] font-semibold text-foreground outline-none"
            />
          ) : (
            <button type="button" onDoubleClick={() => (setName(bot.name), setRenaming(true))} title="Doppio clic per rinominare" className="block max-w-full truncate text-left text-[14px] font-semibold text-foreground">
              {bot.name}
            </button>
          )}
          <p className="truncate text-[11px] text-text-subtle">
            {STATUS_LABELS[session.status]} · {session.cwd.split(/[\\/]/).filter(Boolean).pop()}
          </p>
        </div>
        <button type="button" onClick={expand} title="Amplia a tutta l'area di lavoro" aria-label="Amplia" className="inline-flex size-7 items-center justify-center rounded-md text-text-subtle hover:bg-border hover:text-foreground">
          <Maximize2 size={15} />
        </button>
        <button type="button" onClick={() => useBots.getState().close()} title="Chiudi (Esc)" aria-label="Chiudi la chat" className="inline-flex size-7 items-center justify-center rounded-md text-text-subtle hover:bg-border hover:text-foreground">
          <X size={15} />
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        <ConversationView session={session} onShowTerminal={expand} />
      </div>

      {pending > 0 && (
        <div className="mg-bar flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-[12px]">
          <span className="rounded-full bg-warn px-1.5 font-mono font-semibold text-on-brand">{pending}</span>
          <span className="min-w-0 flex-1 truncate text-text-muted">{pending === 1 ? 'file da rivedere' : 'file da rivedere'}</span>
          <button type="button" onClick={() => (expand(), useReviewUi.getState().openReview(session.id))} className="h-6 rounded-md border border-warn/50 px-2 text-foreground hover:bg-warn/10">
            Apri la revisione
          </button>
        </div>
      )}

      <PromptBox session={session} viewKey={`bot-${session.id}`} focusTerminal={expand} graphic />
    </div>
  )
}
