import { useMemo } from 'react'
import type { IWatermarkPanelProps } from 'dockview-react'
import { PANEL_KIND_LIST } from '@/panels/kinds'
import { useAppearance } from '@/state/appearance'
import { useBots } from '@/state/bots'
import { useSessions } from '@/state/sessions'
import { addPanel } from './panels'

/**
 * Filigrana di uno spazio senza pannelli: una card di vetro (Magnolia Prism) sopra lo sfondo wireframe, che propone i pannelli
 * da aprire (L2). In modalità Bolle, con almeno un bot vivo, lo spazio non è «vuoto»: la card parla delle bolle.
 */
export function EmptySpace({ containerApi }: IWatermarkPanelProps) {
  const bubbles = useAppearance((s) => s.claudeMode === 'bubbles')
  const sessions = useSessions((s) => s.sessions)
  const bots = useBots((s) => s.bots)
  const live = useMemo(() => Object.values(sessions).filter((x) => x.kind === 'claude' && x.status !== 'exited' && bots[x.id]).length, [sessions, bots])
  const withBots = bubbles && live > 0
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="mg-glass-1 max-w-md rounded-2xl border border-white/10 px-6 py-5 text-center shadow-xl">
        <p className="text-[14px] font-semibold text-foreground">{withBots ? (live === 1 ? 'Claude è nella sua bolla' : `Claude è nelle bolle (${live})`) : 'Spazio vuoto'}</p>
        <p className="mt-1 text-text-subtle">
          {withBots
            ? 'Apri una bolla per chattare, amplia la chat a tutta l\'area oppure aggiungi un pannello: lo spazio resta libero per quello che ti serve.'
            : 'Aggiungi un pannello per iniziare. Potrai trascinarlo, ridimensionarlo e raggrupparlo in schede.'}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {PANEL_KIND_LIST.map((k) => (
            <button
              key={k.kind}
              type="button"
              onClick={() => addPanel(containerApi, k.kind)}
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
