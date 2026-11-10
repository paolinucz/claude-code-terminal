import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { AlertTriangle, Check, Info, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui-kit'
import { usePluginUi, type PluginDialogRequest, type PluginNotice } from '@/state/pluginUi'

const ICONS = {
  info: { icon: Info, color: 'var(--cct-info)' },
  ok: { icon: Check, color: 'var(--cct-ok)' },
  warn: { icon: AlertTriangle, color: 'var(--cct-warn)' },
  error: { icon: AlertTriangle, color: 'var(--cct-danger)' }
} as const

/** Avvisi e dialoghi richiesti dai plugin (docs/PLUGIN_API_DOCS.md §4). */
export function PluginUi() {
  const notices = usePluginUi((s) => s.notices)
  const dialogs = usePluginUi((s) => s.dialogs)
  return (
    <>
      <div className="pointer-events-none fixed bottom-14 left-14 z-40 flex w-[340px] flex-col gap-2" aria-live="polite">
        <AnimatePresence initial={false}>
          {notices.map((n) => (
            <NoticeCard key={n.id} notice={n} />
          ))}
        </AnimatePresence>
      </div>
      {/* Una finestra alla volta: le altre aspettano il loro turno. */}
      {dialogs[0] && <RequestDialog key={dialogs[0].id} req={dialogs[0]} />}
    </>
  )
}

function NoticeCard({ notice }: { notice: PluginNotice }) {
  const dismiss = usePluginUi((s) => s.dismissNotice)
  const { icon: Icon, color } = ICONS[notice.kind]
  useEffect(() => {
    const t = window.setTimeout(() => dismiss(notice.id), notice.kind === 'error' ? 15000 : 7000)
    return () => window.clearTimeout(t)
  }, [notice.id, notice.kind, dismiss])
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -40, transition: { duration: 0.15 } }}
      role="status"
      className="pointer-events-auto flex gap-3 rounded-xl border border-strong bg-surface p-3 shadow-2xl"
    >
      <Icon size={18} style={{ color }} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold text-text-faint">{notice.pluginName}</p>
        <p className="mt-0.5 line-clamp-4 text-[12px] leading-snug text-foreground">{notice.message}</p>
      </div>
      <button type="button" aria-label="Chiudi" onClick={() => dismiss(notice.id)} className="h-6 shrink-0 text-text-faint hover:text-foreground">
        <X size={14} />
      </button>
    </motion.div>
  )
}

function RequestDialog({ req }: { req: PluginDialogRequest }) {
  const settle = usePluginUi((s) => s.settle)
  const [text, setText] = useState(req.value)
  const cancel = () => settle(req.id, req.type === 'confirm' ? false : null)
  const ok = () => settle(req.id, req.type === 'confirm' ? true : text)
  return (
    <Dialog open onOpenChange={(o) => !o && cancel()}>
      {/* Un cambio di focus (per esempio una finestra che si chiude) non deve annullare la richiesta: si chiude con Esc o «Annulla». */}
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{req.title}</DialogTitle>
          <DialogDescription>Richiesta del plugin «{req.pluginName}»</DialogDescription>
        </DialogHeader>
        {req.message && <p className="cct-selectable whitespace-pre-wrap text-[13px] leading-relaxed text-text-muted">{req.message}</p>}
        {req.type === 'prompt' && (
          <input
            autoFocus
            value={text}
            placeholder={req.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ok()}
            className="cct-selectable h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] text-foreground outline-none focus:border-brand"
          />
        )}
        <DialogFooter>
          <button type="button" onClick={cancel} className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-muted hover:bg-border">
            Annulla
          </button>
          <button
            type="button"
            onClick={ok}
            className={`h-8 rounded-lg px-3 text-[12px] font-semibold ${req.danger ? 'bg-danger text-white' : 'bg-brand text-on-brand'}`}
          >
            {req.okLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
