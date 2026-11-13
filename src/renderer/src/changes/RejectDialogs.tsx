import { ConfirmDialog } from '@/components/ConfirmDialog'
import { splitPath } from '@/state/changes'
import type { ReviewApi } from './useReview'

/**
 * Conferme di «Rifiuta» (un file) e «Respingi tutte», con il secondo passo per i file cambiati dopo Claude: non si sovrascrive
 * in silenzio il lavoro dell'utente. Le usano il cassetto e la panoramica.
 */
export function RejectDialogs({ review }: { review: ReviewApi }) {
  const { rejecting, setRejecting, bulk, setBulk, reject, runRejectMany } = review
  return (
    <>
      <ConfirmDialog
        open={rejecting !== null}
        title={
          rejecting?.force
            ? `«${rejecting ? splitPath(rejecting.change).name : ''}» è cambiato dopo la modifica di Claude`
            : `Rifiutare la modifica a «${rejecting ? splitPath(rejecting.change).name : ''}»?`
        }
        description={
          rejecting?.force
            ? 'Il file su disco non è più quello scritto da Claude (lo hai modificato tu, o è cambiato dopo). Ripristinando la versione precedente perdi anche quei cambiamenti.'
            : rejecting?.change.created
              ? 'Il file è stato creato da Claude: verrà cancellato. Claude ne sarà informato al prossimo messaggio della sessione.'
              : 'Il file torna alla versione precedente alla modifica di Claude. Claude ne sarà informato al prossimo messaggio della sessione.'
        }
        confirmLabel={rejecting?.force ? 'Ripristina comunque' : rejecting?.change.created ? 'Rifiuta e cancella' : 'Rifiuta e ripristina'}
        destructive
        onCancel={() => setRejecting(null)}
        onConfirm={() => rejecting && void reject(rejecting.change, rejecting.force)}
      />

      <ConfirmDialog
        open={bulk !== null}
        title={
          bulk?.stage === 'force'
            ? `${bulk.forceIds?.length ?? 0} ${bulk.forceIds?.length === 1 ? 'file è cambiato' : 'file sono cambiati'} dopo la modifica di Claude`
            : `Respingere ${bulk?.ids.length ?? 0} ${bulk?.ids.length === 1 ? 'modifica' : 'modifiche'}${bulk?.label ? ` ${bulk.label}` : ''}?`
        }
        description={
          bulk?.stage === 'force'
            ? 'Questi file non sono più quelli scritti da Claude (li hai modificati tu, o sono cambiati dopo). Ripristinandoli perdi anche quei cambiamenti. Gli altri sono già stati ripristinati.'
            : `I file tornano alla versione precedente${bulk && bulk.created > 0 ? `; ${bulk.created} ${bulk.created === 1 ? 'file creato' : 'file creati'} da Claude ${bulk.created === 1 ? 'viene cancellato' : 'vengono cancellati'}` : ''}. I file cambiati dopo Claude non si toccano senza una seconda conferma. Claude lo saprà al prossimo messaggio della sessione.`
        }
        confirmLabel={bulk?.stage === 'force' ? 'Ripristina comunque' : 'Respingi tutte'}
        destructive
        onCancel={() => setBulk(null)}
        onConfirm={() => void runRejectMany(bulk?.stage === 'force')}
      />
    </>
  )
}
