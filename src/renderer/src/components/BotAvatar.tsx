import type { Bot } from '@shared/bots'
import type { SessionInfo } from '@shared/sessions'
import { cn } from '@/lib/cn'

/** Lato predefinito della bolla di un bot. */
export const BOT_SIZE = 44

/** Cerchio di un bot, con l'anello di stato (giallo = attende te, blu = lavora) e il numero di file da rivedere. */
export function BotAvatar({ bot, status, size = BOT_SIZE, pending = 0, attention = false }: { bot: Bot; status?: SessionInfo['status']; size?: number; pending?: number; attention?: boolean }) {
  return (
    <span className={cn('mg-bot relative inline-flex shrink-0 items-center justify-center rounded-full font-bold text-black/80 select-none', status && `mg-bot-${status}`)} style={{ width: size, height: size, background: bot.color, fontSize: size * 0.42 }}>
      <span className="mg-bot-ring" aria-hidden="true" />
      <span aria-hidden="true">{bot.icon}</span>
      {pending > 0 && (
        <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-warn px-1 text-center font-mono text-[10px] leading-4 font-semibold text-on-brand" aria-label={`${pending} file da rivedere`}>
          {pending}
        </span>
      )}
      {attention && status !== 'waiting' && <span className="absolute -bottom-0.5 -left-0.5 size-3 rounded-full border-2 border-black bg-ok" aria-label="Ha finito" />}
    </span>
  )
}
