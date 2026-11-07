/** Aggiornamenti automatici dell'app (fase 8): stato mostrato nell'interfaccia. */
export type UpdateStatus =
  /** Aggiornamenti non attivi: app avviata dai sorgenti (sviluppo) o senza configurazione. */
  | { state: 'disabled'; reason: string }
  | { state: 'idle' }
  | { state: 'checking' }
  /** Nessuna versione nuova. */
  | { state: 'none'; checkedAt: string }
  | { state: 'downloading'; version: string; percent: number }
  /** Scaricata: si installa alla chiusura dell'app, oppure subito con «Riavvia e aggiorna». */
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

export interface AppInfo {
  version: string
  /** true se l'app gira dall'installer (non dai sorgenti). */
  packaged: boolean
}
