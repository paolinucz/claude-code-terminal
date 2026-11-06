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

// ---- Language server (F2, F3) ----

export type LspLanguage = 'java' | 'typescript' | 'python' | 'yaml'

/** Stato di un language server, per la barra dell'editor. */
export interface LspStatus {
  language: LspLanguage
  root: string
  state: 'starting' | 'ready' | 'error' | 'stopped' | 'needs-install'
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

export interface FileDiagnostics {
  path: string
  language: LspLanguage
  diagnostics: Diagnostic[]
}

/** Avanzamento dell'installazione del supporto Java (JRE + jdtls, scaricati al primo uso). */
export interface JavaInstallProgress {
  step: 'jre' | 'jdtls' | 'done' | 'error'
  /** 0–1 */
  progress: number
  message: string
}

/** Linguaggio LSP in base all'estensione del file (null = solo colorazione della sintassi). */
export function lspLanguageOf(path: string): LspLanguage | null {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  if (ext === 'java') return 'java'
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext)) return 'typescript'
  if (ext === 'py' || ext === 'pyi') return 'python'
  if (ext === 'yml' || ext === 'yaml') return 'yaml'
  return null
}

export const normPath = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
