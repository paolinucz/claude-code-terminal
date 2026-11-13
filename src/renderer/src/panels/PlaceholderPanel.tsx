import type { IDockviewPanelProps } from 'dockview-react'
import { PANEL_KINDS, type PanelParams } from './kinds'

/**
 * Contenuto provvisorio dei pannelli non ancora realizzati: dice cosa conterrà il pannello e in quale fase.
 */
export function PlaceholderPanel(props: IDockviewPanelProps<PanelParams>) {
  const info = PANEL_KINDS[props.params.kind] ?? PANEL_KINDS.explorer

  return (
    <div className="flex h-full flex-col overflow-auto p-4 text-text-muted">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-foreground">{info.title}</span>
        <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-text-subtle">fase {info.phase}</span>
        <span className="font-mono text-[11px] text-text-faint">{info.requirements}</span>
      </div>
      <p className="mt-2 max-w-[60ch] leading-relaxed text-text-subtle">{info.description}</p>
      <p className="mt-auto pt-4 text-[11px] text-text-faint">
        Trascina la scheda per spostare il pannello, oppure usa i pulsanti in alto a destra per renderlo fluttuante o staccarlo
        in una finestra.
      </p>
    </div>
  )
}
