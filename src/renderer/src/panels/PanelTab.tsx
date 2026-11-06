import { useEffect, useState } from 'react'
import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { X } from 'lucide-react'
import { ATTENTION_LABELS, STATUS_COLORS, STATUS_LABELS, useSessions } from '@/state/sessions'
import { useWorkspace } from '@/state/workspace'
import { pendingCount, useChanges } from '@/state/changes'
import type { PanelParams } from './kinds'

/**
 * Scheda di un pannello. Per i terminali mostra lo stato della sessione (S6):
 * al lavoro, in attesa di input, inattiva, terminata.
 */
export function PanelTab(props: IDockviewPanelHeaderProps<PanelParams>) {
  const [title, setTitle] = useState(props.api.title ?? '')
  const sessionId = props.params.kind === 'terminal' ? props.params.sessionId : undefined
  const session = useSessions((s) => (sessionId ? s.sessions[sessionId] : undefined))
  const attention = useSessions((s) => (sessionId ? s.attention[sessionId] : undefined))
  const pending = useChanges((s) => (props.params.kind === 'changes' ? pendingCount(s.changes) : 0))
  const attentionColor =
    attention?.kind === 'finished' ? 'var(--cct-ok)' : attention?.kind === 'error' ? 'var(--cct-danger)' : 'var(--cct-info)'

  useEffect(() => {
    const sub = props.api.onDidTitleChange((e) => setTitle(e.title))
    return () => sub.dispose()
  }, [props.api])

  const close = () => {
    // Chiudere la vista non interrompe la sessione (requisiti §3).
    if (session && session.status !== 'exited' && session.views <= 1) {
      useWorkspace.getState().setStatus(`«${session.title}» continua in background: la trovi in «Collega a sessione attiva»`)
    }
    props.api.close()
  }

  return (
    <div
      className="flex h-full items-center gap-1.5 pr-1 pl-2.5"
      onMouseDown={(e) => {
        // Clic centrale: chiude la scheda, come nei browser.
        if (e.button === 1) {
          e.preventDefault()
          close()
        }
      }}
    >
      {props.params.kind === 'terminal' && (
        <span className="relative inline-flex size-2 shrink-0">
          {attention && (
            <span className="absolute inset-0 animate-ping rounded-full" style={{ background: attentionColor }} aria-hidden="true" />
          )}
          <span
            className="relative size-2 rounded-full"
            style={{ background: attention ? attentionColor : session ? STATUS_COLORS[session.status] : 'var(--cct-border-strong)' }}
            title={attention ? `${ATTENTION_LABELS[attention.kind]}: ${attention.message}` : session ? STATUS_LABELS[session.status] : 'nessuna sessione'}
            aria-label={attention ? ATTENTION_LABELS[attention.kind] : session ? `Stato: ${STATUS_LABELS[session.status]}` : undefined}
          />
        </span>
      )}
      {props.params.kind === 'terminal' && session?.kind && (
        <span className="text-[11px] text-text-faint">{session.kind === 'claude' ? 'Claude' : 'Shell'}</span>
      )}
      <span className="truncate">{title}</span>
      {props.params.kind === 'changes' && pending > 0 && (
        <span className="rounded-full bg-warn px-1.5 font-mono text-[10px] leading-4 font-semibold text-on-brand" title={`${pending} da rivedere`}>
          {pending}
        </span>
      )}
      <button
        type="button"
        aria-label={`Chiudi ${title}`}
        title="Chiudi la vista"
        onClick={(e) => {
          e.stopPropagation()
          close()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="ml-0.5 inline-flex size-5 items-center justify-center rounded text-text-faint opacity-70 hover:bg-border hover:text-foreground hover:opacity-100"
      >
        <X size={12} />
      </button>
    </div>
  )
}
