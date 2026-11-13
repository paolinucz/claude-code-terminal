import { AppWindow } from 'lucide-react'
import type { Space } from '@shared/types'
import { api } from '@/lib/api'
import { SpaceIcon } from './SpaceChips'

/**
 * Segnaposto di uno spazio aperto in un'altra finestra. Qui il suo Dockview non si monta: due finestre non devono tenere lo
 * stesso layout. Le sessioni continuano a girare; si torna a vederlo qui chiudendo l'altra finestra.
 */
export function ExternalSpace({ space, active }: { space: Space; active: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-(--cct-gap)" style={{ display: active ? 'flex' : 'none' }} aria-hidden={!active}>
      <div className="mg-glass-3 flex max-w-sm flex-col items-center gap-3 rounded-2xl p-8 text-center">
        <SpaceIcon space={space} size={36} />
        <h2 className="text-[15px] font-semibold text-foreground">«{space.name}» è aperto in un'altra finestra</h2>
        <p className="text-[13px] text-text-subtle">Le sue sessioni continuano a girare. Chiudendo l'altra finestra lo spazio torna qui con la sua disposizione.</p>
        <div className="mt-1 flex gap-2">
          <button type="button" onClick={() => void api.windows.openSpace(space.id)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-text-muted hover:bg-border hover:text-foreground">
            <AppWindow size={14} /> Vai alla finestra
          </button>
          <button type="button" onClick={() => void api.windows.closeSpace(space.id)} className="h-8 rounded-lg bg-brand px-3 text-[13px] font-semibold text-on-brand hover:opacity-90">
            Riporta qui
          </button>
        </div>
      </div>
    </div>
  )
}
