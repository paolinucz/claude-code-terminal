import { useEffect, useState } from 'react'
import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { X } from 'lucide-react'
import { STATUS_COLORS, STATUS_LABELS, useSessions } from '@/state/sessions'
import { useWorkspace } from '@/state/workspace'
import type { PanelParams } from './kinds'

/**
 * Scheda di un pannello. Per i terminali mostra lo stato della sessione (S6):
 * al lavoro, in attesa di input, inattiva, terminata.
 */
export function PanelTab(props: IDockviewPanelHeaderProps<PanelParams>) {
  const [title, setTitle] = useState(props.api.title ?? '')
  const sessionId = props.params.kind === 'terminal' ? props.params.sessionId : undefined
  const session = useSessions((s) => (sessionId ? s.sessions[sessionId] : undefined))

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
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: session ? STATUS_COLORS[session.status] : 'var(--cct-border-strong)' }}
          title={session ? STATUS_LABELS[session.status] : 'nessuna sessione'}
          aria-label={session ? `Stato: ${STATUS_LABELS[session.status]}` : undefined}
        />
      )}
      {props.params.kind === 'terminal' && session?.kind && (
        <span className="text-[11px] text-text-faint">{session.kind === 'claude' ? 'Claude' : 'Shell'}</span>
      )}
      <span className="truncate">{title}</span>
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
