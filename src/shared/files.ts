// File del workspace (requisiti F1–F3), condivisi tra processo principale e interfaccia.

export interface DirEntry {
  name: string
  path: string
  dir: boolean
}

/** Stato git di un file: M modificato, A aggiunto/nuovo, D cancellato, R rinominato, U in conflitto. */
export type GitMark = 'M' | 'A' | 'D' | 'R' | 'U'

export interface GitStatus {
  /** Cartella radice del repository (null se la cartella non è in un repository). */
  root: string | null
  branch: string | null
  /** Percorso assoluto (minuscolo su Windows) → stato. */
  files: Record<string, GitMark>
}

export interface FileContent {
  path: string
  text: string
  /** Data dell'ultima modifica su disco (ms), per accorgersi delle modifiche esterne. */
  mtime: number
  binary: boolean
  tooLarge: boolean
}

export interface SaveFileResult {
  ok: boolean
  mtime?: number
  error?: string
  /** Il file su disco è cambiato da quando l'hai aperto: serve conferma per sovrascriverlo. */
  conflict?: boolean
}

// ---- Language server (F2, F3), forniti dai plugin (X1–X9) ----

/** Stato di un language server, per la barra dell'editor e la schermata dei plugin. */
export interface LspStatus {
  /** Chiave del server: plugin/server|radice. */
  key: string
  pluginId: string
  /** Nome del server, es. «Eclipse JDT Language Server». */
  name: string
  /** Linguaggi gestiti (id dei linguaggi dei plugin). */
  languages: string[]
  root: string
  state: 'starting' | 'ready' | 'error' | 'stopped'
  message?: string
}

/** Diagnostica di un file (errori e avvisi), per l'editor e il pannello Problemi. */
export interface Diagnostic {
  severity: 1 | 2 | 3 | 4
  message: string
  source?: string
  code?: string | number
  range: { startLine: number; startColumn: number; endLine: number; endColumn: number }
}

/** Diagnostica di un file da un server. Più server sullo stesso file mandano diagnostiche separate. */
export interface FileDiagnostics {
  path: string
  /** Chiave del server che la invia. */
  server: string
  diagnostics: Diagnostic[]
}

/** Elenco dei file di una cartella per la palette comandi (L7). */
export interface FileIndex {
  root: string
  /** Percorsi relativi alla cartella, con \ come separatore. */
  files: string[]
  /** true se l'elenco è stato tagliato al massimo consentito. */
  truncated: boolean
}

export const normPath = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()