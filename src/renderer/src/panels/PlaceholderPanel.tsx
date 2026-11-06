import type { IDockviewPanelProps } from 'dockview-react'
import { PANEL_KINDS, type PanelParams } from './kinds'

/**
 * Contenuto provvisorio dei pannelli nella fase 1: dice cosa conterrà il pannello e in quale fase.
 * Serve a provare aggancio, schede, fluttuanti, finestre staccate e salvataggio del layout.
 */
export function PlaceholderPanel(props: IDockviewPanelProps<PanelParams>) {
  const info = PANEL_KINDS[props.params.kind] ?? PANEL_KINDS.terminal
  const isTerminal = info.kind === 'terminal'

  return (
    <div className="flex h-full flex-col overflow-auto bg-surface p-4 text-text-muted">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-foreground">{info.title}</span>
        <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-text-subtle">
          fase {info.phase}
        </span>
        <span className="font-mono text-[11px] text-text-faint">{info.requirements}</span>
      </div>
      <p className="mt-2 max-w-[60ch] leading-relaxed text-text-subtle">{info.description}</p>

      {isTerminal && (
        <div className="mt-4 rounded-lg border border-border bg-background p-3 font-mono text-[12px] leading-relaxed">
          <div className="text-text-faint">{props.api.title}</div>
          <div className="mt-1">
            <span className="text-brand">&gt;</span> <span className="inline-block h-[14px] w-[7px] translate-y-[2px] animate-pulse bg-text-muted" />
          </div>
        </div>
      )}

      <p className="mt-auto pt-4 text-[11px] text-text-faint">
        Trascina la scheda per spostare il pannello, oppure usa i pulsanti in alto a destra per renderlo fluttuante o staccarlo
        in una finestra.
      </p>
    </div>
  )
}
