// Tipi delle sessioni di terminale (requisiti §3 e §4), condivisi tra processo principale e interfaccia.

export type SessionKind = 'claude' | 'shell'

/** Stato mostrato su ogni scheda (S6). 'waiting' arriva con gli hook nella fase 3. */
export type SessionStatus = 'working' | 'waiting' | 'idle' | 'exited'

export type ShellId = 'git-bash' | 'pwsh' | 'powershell' | 'cmd' | `wsl:${string}`

export interface ShellInfo {
  id: ShellId
  label: string
}

export const CLAUDE_MODELS = [
  { id: 'default', label: 'Predefinito' },
  { id: 'fable', label: 'Fable' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' }
] as const
export type ClaudeModel = (typeof CLAUDE_MODELS)[number]['id']

export const CLAUDE_EFFORTS = [
  { id: 'default', label: 'Predefinito' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'XHigh' },
  { id: 'max', label: 'Max' }
] as const
export type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number]['id']

export interface ClaudeLaunchOptions {
  cwd: string
  model: ClaudeModel
  effort: ClaudeEffort
  /** Cartelle di contesto, passate con --add-dir (W2). */
  addDirs: string[]
  /** Se presente riprende questa sessione di Claude Code (--resume), altrimenti ne crea una nuova. */
  resumeId?: string
  /** Nome visualizzato, passato a Claude Code con --name (solo per le sessioni nuove). */
  name?: string
  /** Titolo da mostrare nella scheda quando si riprende una sessione (non viene passato a Claude Code). */
  title?: string
}

export type CreateSessionRequest =
  | { kind: 'claude'; claude: ClaudeLaunchOptions }
  | { kind: 'shell'; shell: ShellId; cwd: string }

export interface SessionInfo {
  id: string
  kind: SessionKind
  title: string
  cwd: string
  status: SessionStatus
  startedAt: string
  /** Riga di comando, per la barra di stato e i suggerimenti. */
  command: string
  shell?: ShellId
  /** Id della sessione di Claude Code (per «Riprendi»). */
  claudeSessionId?: string
  model?: ClaudeModel
  effort?: ClaudeEffort
  addDirs?: string[]
  gitBranch?: string | null
  exitCode?: number
  /** Numero di viste collegate (pannelli aperti) in questo momento. */
  views: number
  /** Dalla status line di Claude Code (W5): percentuale di contesto usata. */
  contextPercent?: number
  /** Nome del modello come lo mostra Claude Code (es. «Opus»): segue anche i cambi fatti con /model. */
  modelLabel?: string
  /** Effort attuale riportato da Claude Code. */
  effortLevel?: string
  costUsd?: number
  /** Gli hook di Claude Code stanno inviando eventi: lo stato viene da lì e non dall'attività del terminale. */
  hooks?: boolean
  cols: number
  rows: number
}

/** Una sessione chiede attenzione (S7): ha finito, chiede un permesso, aspetta input o si è fermata per un errore. */
export interface SessionAttention {
  sessionId: string
  kind: 'finished' | 'permission' | 'input' | 'error'
  title: string
  message: string
}

/** Sessione di Claude Code salvata su disco, per l'elenco «Riprendi» (S8). */
export interface ResumableSession {
  id: string
  title: string
  cwd: string
  updatedAt: string
  gitBranch?: string
}

/** Ultimi valori usati per un progetto (W4). */
export interface ProjectPrefs {
  cwd: string
  model: ClaudeModel
  effort: ClaudeEffort
  addDirs: string[]
  updatedAt: string
}

export interface ClaudeCliInfo {
  path: string | null
  version: string | null
  /** Da dove è stato preso: PATH, ~/.local/bin, o la copia dell'app desktop di Claude. */
  source: 'path' | 'local-bin' | 'desktop-app' | null
}

/** Istantanea dello schermo di una sessione, per una vista che si collega (S3). */
export interface SessionSnapshot {
  info: SessionInfo
  /** Contenuto serializzato (sequenze ANSI) di schermo e cronologia. */
  data: string
  /** Numero dell'ultimo blocco di output incluso nell'istantanea. */
  seq: number
}

/** Dati che una vista invia quando prende il controllo della dimensione del terminale. */
export interface ViewSize {
  cols: number
  rows: number
}
