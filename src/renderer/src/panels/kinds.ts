import type { ClaudeEffort, ClaudeModel, SessionKind, ShellId } from '@shared/sessions'

/** Tipi di pannello (L2). Nella fase 1 sono segnaposto: i contenuti veri arrivano nelle fasi indicate. */
export type PanelKind = 'terminal' | 'explorer' | 'editor' | 'changes' | 'problems' | 'widgets' | 'permissions' | 'plugins'

export interface PanelKindInfo {
  kind: PanelKind
  title: string
  description: string
  /** Fase dello sviluppo in cui il pannello diventa funzionante (stack-tecnico.md §5). */
  phase: number
  requirements: string
  /** Pannello non ancora disponibile: non compare nei menu e si toglie dai layout salvati. */
  hidden?: boolean
}

export const PANEL_KINDS: Record<PanelKind, PanelKindInfo> = {
  terminal: {
    kind: 'terminal',
    title: 'Terminale',
    description: 'Sessione Claude Code o shell (Git Bash, PowerShell, WSL). La sessione vive nel processo principale: il pannello è solo una vista.',
    phase: 0,
    requirements: 'S1–S9, W1–W5'
  },
  explorer: {
    kind: 'explorer',
    title: 'Esplora file',
    description: 'Albero del workspace e delle cartelle aggiuntive, con i file modificati segnati M, A o D.',
    phase: 0,
    requirements: 'F1'
  },
  editor: {
    kind: 'editor',
    title: 'Editor',
    description: 'Monaco con language server: Java, TypeScript/JavaScript, Python, XML, YAML e SQL.',
    phase: 0,
    requirements: 'F2'
  },
  changes: {
    kind: 'changes',
    title: 'Modifiche',
    description: 'Ogni Edit o Write di Claude, con diff affiancato e i pulsanti Approva e Rifiuta.',
    phase: 0,
    requirements: 'F4–F7'
  },
  problems: {
    kind: 'problems',
    title: 'Problemi',
    description: 'Errori e avvisi di tutti i language server attivi.',
    phase: 0,
    requirements: 'F3'
  },
  permissions: {
    kind: 'permissions',
    title: 'Permessi',
    description: 'Regole di Claude Code nei file Locale, Progetto e Utente, con anteprima prima di salvare.',
    phase: 0,
    requirements: 'P1–P6'
  },
  plugins: {
    kind: 'plugins',
    title: 'Plugin',
    description: 'Plugin di linguaggio: importa, attiva, aggiorna e disinstalla i language server.',
    phase: 0,
    requirements: 'X1–X9'
  },
  widgets: {
    kind: 'widgets',
    title: 'Widget',
    description: 'Zona widget: griglia con celle da 150 px e colonne che si adattano alla larghezza.',
    phase: 7,
    requirements: 'G1–G4',
    // La fase 7 (widget) è rimandata a dopo la 1.0.
    hidden: true
  }
}

/** Pannelli che si possono aggiungere (senza quelli nascosti). */
export const PANEL_KIND_LIST: PanelKindInfo[] = Object.values(PANEL_KINDS).filter((k) => !k.hidden)

/** Quanto serve per riaprire una sessione quando il processo non c'è più (per esempio dopo un riavvio). */
export interface SessionHint {
  kind: SessionKind
  title: string
  cwd: string
  claudeSessionId?: string
  shell?: ShellId
  model?: ClaudeModel
  effort?: ClaudeEffort
  addDirs?: string[]
}

export interface PanelParams {
  kind: PanelKind
  /** Solo terminali: la sessione mostrata dal pannello. */
  sessionId?: string
  /** Solo terminali: dati dell'ultima sessione mostrata, per «Riprendi». */
  hint?: SessionHint
  /** Permessi, esplora file, editor: cartella del progetto. */
  cwd?: string
  /** Solo editor: file aperto. */
  filePath?: string
}
