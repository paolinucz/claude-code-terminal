// CCT Plugin API v1: il contratto tra l'app e l'adapter di ogni plugin (docs/plugin-api.md).
// Formati dell'app, non di LSP: percorsi Windows, righe e colonne da 1.

export const PLUGIN_API_VERSION = 1

export interface ApiPosition {
  line: number
  column: number
}

export interface ApiRange {
  start: ApiPosition
  end: ApiPosition
}

export interface ApiLocation {
  path: string
  range: ApiRange
}

export type ApiCompletionKind =
  | 'text' | 'method' | 'function' | 'constructor' | 'field' | 'variable' | 'class' | 'interface' | 'module'
  | 'property' | 'unit' | 'value' | 'enum' | 'keyword' | 'snippet' | 'color' | 'file' | 'reference' | 'folder'
  | 'enumMember' | 'constant' | 'struct' | 'event' | 'operator' | 'typeParameter'

export interface ApiCompletionItem {
  label: string
  kind: ApiCompletionKind
  detail?: string
  /** Markdown. */
  documentation?: string
  insertText: string
  /** insertText usa la sintassi degli snippet ($1, ${1:nome}). */
  snippet?: boolean
  /** Testo da sostituire; se assente, la parola sotto il cursore. */
  range?: ApiRange
  sortText?: string
  filterText?: string
}

export interface ApiCompletionList {
  items: ApiCompletionItem[]
  incomplete: boolean
}

export interface ApiHover {
  /** Blocchi Markdown. */
  contents: string[]
  range?: ApiRange
}

export interface ApiDiagnostic {
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  code?: string
  source?: string
  range: ApiRange
}

export interface ApiCapabilities {
  completion: boolean
  hover: boolean
  definition: boolean
  diagnostics: boolean
  /** Refactoring allo spostamento/rinomina di file e cartelle (`refactor/willRename`). Facoltativa. */
  willRename?: boolean
}

// ---- Refactoring allo spostamento e alla rinomina (Esplora file, vista Package) ----

/** Una modifica di testo (righe e colonne da 1). */
export interface ApiTextEdit {
  range: ApiRange
  newText: string
}

/** Le modifiche a un file, con i percorsi del file PRIMA della rinomina. */
export interface ApiFileEdit {
  path: string
  edits: ApiTextEdit[]
}

export interface ApiRename {
  from: string
  to: string
}

/** Risposta di `refactor/willRename`: le modifiche ai file che rimangono coerenti dopo lo spostamento. */
export interface WillRenameResult {
  files: ApiFileEdit[]
}

export interface ApiRefactorPreview {
  files: ApiFileEdit[]
}

// ---- Messaggi ----

export interface InitializeParams {
  apiVersion: number
  plugin: { id: string; dir: string; downloadsDir: string; dataDir: string }
  /** Runtime dei plugin richiesti (es. «java»), con i percorsi già risolti. */
  runtimes: Record<string, { command: string; args: string[] }>
  locale: string
}

export interface InitializeResult {
  capabilities: ApiCapabilities
}

export interface PositionParams {
  path: string
  position: ApiPosition
}

export interface DocumentOpenParams {
  path: string
  languageId: string
  text: string
  /** Cartella di progetto aperta nell'app: un suggerimento per trovare la radice. */
  workspace?: string
}

/** adapter → app */
export interface DiagnosticsNotification {
  path: string
  source: string
  items: ApiDiagnostic[]
}

/** adapter → app: un id per ogni server gestito dall'adapter. */
export interface StatusNotification {
  id: string
  name: string
  root?: string
  state: 'starting' | 'ready' | 'error' | 'stopped'
  message?: string
}

export interface LogNotification {
  level: 'info' | 'warn' | 'error'
  message: string
}
