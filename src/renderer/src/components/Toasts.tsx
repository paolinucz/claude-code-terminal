import { useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { AlertTriangle, Check, HelpCircle, ShieldQuestion, X } from 'lucide-react'
import { ATTENTION_LABELS, revealSession, useSessions, type Toast } from '@/state/sessions'
import { useMessages } from '@/state/messages'
import { useBot } from '@/state/bots'

const ICONS = {
  finished: { icon: Check, color: 'var(--cct-ok)' },
  permission: { icon: ShieldQuestion, color: 'var(--cct-info)' },
  input: { icon: HelpCircle, color: 'var(--cct-info)' },
  error: { icon: AlertTriangle, color: 'var(--cct-danger)' }
} as const

/** Quanto resta visibile un avviso: le richieste di permesso restano finché non le guardi. */
const DURATION: Record<Toast['kind'], number | null> = { finished: 8000, error: 15000, input: null, permission: null }

/** Avvisi nell'app (S7, requisiti §8: Toast): una sessione ha finito o chiede qualcosa. */
export function Toasts() {
  const toasts = useSessions((s) => s.toasts)
  const messages = useMessages((s) => s.messages)
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-[360px] flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {messages.map((m) => (
          <motion.div
            key={`m${m.id}`}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, transition: { duration: 0.15 } }}
            role="status"
            className="pointer-events-auto rounded-xl border border-strong bg-surface px-3 py-2 text-[13px] text-text-muted shadow-2xl"
          >
            {m.text}
          </motion.div>
        ))}
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useSessions((s) => s.dismissToast)
  const bot = useBot(toast.sessionId)
  const { icon: Icon, color } = ICONS[toast.kind]

  useEffect(() => {
    const ms = DURATION[toast.kind]
    if (!ms) return
    const t = window.setTimeout(() => dismiss(toast.id), ms)
    return () => window.clearTimeout(t)
  }, [toast.id, toast.kind, dismiss])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.15 } }}
      role="status"
      className="pointer-events-auto flex gap-3 rounded-xl border border-strong bg-surface p-3 shadow-2xl"
    >
      <Icon size={18} style={{ color }} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-foreground">
          «{bot?.name ?? toast.title}» {ATTENTION_LABELS[toast.kind]}
        </p>
        {toast.message && <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-text-subtle">{toast.message}</p>}
        <button
          type="button"
          onClick={() => revealSession(toast.sessionId)}
          className="mt-2 h-7 rounded-md bg-border px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-strong"
        >
          Mostra
        </button>
      </div>
      <button
        type="button"
        aria-label="Chiudi l'avviso"
        onClick={() => dismiss(toast.id)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-text-faint hover:bg-border hover:text-foreground"
      >
        <X size={13} />
      </button>
    </motion.div>
  )
}
