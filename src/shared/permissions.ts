// Permessi di Claude Code (requisiti P1–P6), condivisi tra processo principale e interfaccia.

/** I tre file di impostazioni di Claude Code (P1). */
export type PermissionScope = 'local' | 'project' | 'user'

export type Decision = 'allow' | 'ask' | 'deny'

export const SCOPES: { id: PermissionScope; label: string; file: string; description: string }[] = [
  { id: 'local', label: 'Locale', file: '.claude\\settings.local.json', description: 'Solo tu, solo questo progetto. Non finisce su git.' },
  { id: 'project', label: 'Progetto', file: '.claude\\settings.json', description: 'Condiviso con il team tramite git.' },
  { id: 'user', label: 'Utente', file: '~\\.claude\\settings.json', description: 'Tutti i tuoi progetti.' }
]

export const DECISIONS: { id: Decision; label: string }[] = [
  { id: 'allow', label: 'Consenti' },
  { id: 'ask', label: 'Chiedi' },
  { id: 'deny', label: 'Nega' }
]

/** Da dove viene una regola (P3). */
export type RuleOrigin = 'terminal' | 'manual' | 'external' | 'existing'

export interface PermissionRule {
  /** Es. «Bash(npm run test:*)», «Read(.env*)», «WebFetch(domain:docs.github.com)». */
  rule: string
  decision: Decision
  origin: RuleOrigin
  /** Quando l'app ha visto la regola per la prima volta (assente per le regole già presenti). */
  addedAt?: string
}

/** Contenuto di un ambito: i campi che l'app modifica. Il resto del file resta com'è. */
export interface ScopeData {
  allow: string[]
  ask: string[]
  deny: string[]
  additionalDirectories: string[]
}

export interface ScopeState {
  scope: PermissionScope
  /** Percorso completo del file. */
  path: string
  exists: boolean
  rules: PermissionRule[]
  additionalDirectories: string[]
  /** Testo del file su disco (per l'anteprima). */
  raw: string
  /** Il file esiste ma non è JSON valido: l'ambito è in sola lettura finché non lo correggi. */
  parseError?: string
}

export interface PermissionsState {
  cwd: string
  scopes: ScopeState[]
}

/** Differenze trovate quando un file cambia fuori dall'app (P6). */
export interface ExternalChange {
  cwd: string
  scope: PermissionScope
  path: string
  added: { rule: string; decision: Decision }[]
  removed: { rule: string; decision: Decision }[]
  directoriesAdded: string[]
  directoriesRemoved: string[]
  /** Probabilmente un «Sì, e ricorda» da un terminale di Claude aperto qui. */
  fromTerminal: boolean
}

export interface SaveResult {
  ok: boolean
  error?: string
}

/**
 * Nuovo contenuto di un file di impostazioni (P5): cambiano solo allow/ask/deny/additionalDirectories
 * dentro «permissions»; tutte le altre chiavi del file restano com'erano.
 */
export function mergeScope(json: Record<string, unknown>, data: ScopeData): Record<string, unknown> {
  const permissions = { ...((json.permissions as Record<string, unknown>) ?? {}) }
  for (const key of ['allow', 'ask', 'deny', 'additionalDirectories'] as const) {
    if (data[key].length) permissions[key] = data[key]
    else delete permissions[key]
  }
  const out = { ...json }
  if (Object.keys(permissions).length) out.permissions = permissions
  else delete out.permissions
  return out
}

/** Testo che verrà scritto nel file (stessa formattazione usata dal processo principale). */
export function renderSettings(json: Record<string, unknown>): string {
  return JSON.stringify(json, null, 2) + '\n'
}

/** Strumento della regola: «Bash(npm test)» → «Bash». */
export function toolOf(rule: string): string {
  const i = rule.indexOf('(')
  return (i < 0 ? rule : rule.slice(0, i)).trim()
}

/** Una regola valida: «Strumento» oppure «Strumento(specificatore)». */
export function isValidRule(rule: string): boolean {
  return /^[A-Za-z_][\w-]*(\(.+\))?$/.test(rule.trim())
}
