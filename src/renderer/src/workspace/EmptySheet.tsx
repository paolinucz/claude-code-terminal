import type { IWatermarkPanelProps } from 'dockview-react'
import { PANEL_KIND_LIST } from '@/panels/kinds'
import { addPanel, nextTerminalTitle } from './panels'

/** Filigrana di un foglio senza pannelli: propone i pannelli da aggiungere (L2). */
export function EmptySheet({ containerApi }: IWatermarkPanelProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md text-center">
        <p className="text-[14px] font-semibold text-foreground">Foglio vuoto</p>
        <p className="mt-1 text-text-subtle">Aggiungi un pannello per iniziare. Potrai trascinarlo, ridimensionarlo e raggrupparlo in schede.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {PANEL_KIND_LIST.map((k) => (
            <button
              key={k.kind}
              type="button"
              onClick={() =>
                addPanel(containerApi, k.kind, k.kind === 'terminal' ? { title: nextTerminalTitle(containerApi) } : {})
              }
              className="min-h-8 rounded-lg border border-border px-3 text-text-muted transition-colors hover:border-brand hover:text-foreground"
            >
              + {k.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
