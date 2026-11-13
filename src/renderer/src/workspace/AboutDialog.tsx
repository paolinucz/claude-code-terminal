import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import icon from '@/assets/icon-detailed.svg'
import { APP_AUTHOR, APP_DEDICATION, APP_LICENSE } from '@shared/about'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui-kit'
import { useAbout } from '@/state/about'
import { describeUpdate, useUpdates } from '@/state/updates'

/**
 * Informazioni su Magnolia: nome, versione, autore, licenza e la dedica. La versione viene dall'app (quella del pacchetto), così
 * non si dimentica di aggiornarla qui.
 */
export function AboutDialog() {
  const open = useAbout((s) => s.open)
  const info = useUpdates((s) => s.info)
  const status = useUpdates((s) => s.status)
  useEffect(() => useUpdates.getState().init(), [])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && useAbout.getState().hide()}>
      <DialogContent className="max-w-sm items-center text-center">
        <div className="flex flex-col items-center gap-1">
          <img src={icon} alt="" draggable={false} className="size-24 select-none" />
          <DialogTitle className="mt-2 text-[22px] font-semibold tracking-tight">Magnolia</DialogTitle>
          <DialogDescription className="text-[13px]">Terminali di Claude Code, file e revisione in un solo posto.</DialogDescription>
        </div>

        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-left text-[13px]">
          <dt className="text-text-faint">Versione</dt>
          <dd className="font-mono text-foreground">{info ? `${info.version}${info.packaged ? '' : ' (sviluppo)'}` : '…'}</dd>
          <dt className="text-text-faint">Autore</dt>
          <dd className="text-foreground">{APP_AUTHOR}</dd>
          <dt className="text-text-faint">Licenza</dt>
          <dd className="text-foreground">{APP_LICENSE}</dd>
        </dl>

        <button
          type="button"
          onClick={() => void useUpdates.getState().check()}
          className="mt-3 inline-flex h-8 items-center justify-center gap-1.5 self-center rounded-lg border border-border px-3 text-[13px] text-text-muted transition-colors hover:bg-border hover:text-foreground"
        >
          <RefreshCw size={13} /> Controlla gli aggiornamenti
        </button>
        <p className="mt-1.5 min-h-4 text-[11px] text-text-faint" aria-live="polite">
          {status.state === 'idle' ? '' : describeUpdate(status)}
        </p>

        <figure className="mt-4 w-full border-t border-border pt-4">
          <blockquote className="text-[14px] leading-relaxed text-foreground">«{APP_DEDICATION.text}»</blockquote>
          <figcaption className="mt-2 text-[22px] leading-none" aria-label="un cuore azzurro e un funghetto">
            {APP_DEDICATION.emoji}
          </figcaption>
        </figure>
      </DialogContent>
    </Dialog>
  )
}
