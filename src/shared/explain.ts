/** Risultato di «Spiega» (O1–O8): la spiegazione smart di una modifica di Claude. */
export type ExplainResult =
  /** Pagina HTML pronta: si mostra in un iframe isolato all'indirizzo `app://explain/<token>`. */
  | { ok: true; kind: 'html'; token: string; cached: boolean; costUsd?: number }
  /** Riepilogo in testo semplice, quando la generazione fallisce o l'HTML non è valido (O6). */
  | { ok: true; kind: 'text'; text: string; warning?: string }
  | { ok: false; error: string; cancelled?: boolean }

/** Indirizzo a cui l'iframe carica la pagina generata. */
export const EXPLAIN_HOST = 'explain'
export const explainUrl = (token: string) => `app://${EXPLAIN_HOST}/${token}`

/** Modello economico usato per le spiegazioni (O8): è un alias di Claude Code. */
export const EXPLAIN_MODEL = 'haiku'

/** «Spiega con Haiku» su righe selezionate: il file così come si vede e l'intervallo scelto (righe da 1). */
export interface SnippetRequest {
  filePath: string
  /** Cartella di lavoro per mostrare il percorso relativo (facoltativa). */
  cwd?: string
  /** Testo intero del file. */
  text: string
  start: number
  end: number
}
