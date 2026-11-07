import { CLAUDE_EFFORTS, CLAUDE_MODELS, type ClaudeEffort, type ClaudeModel } from './sessions'

/** Estensione del file di progetto (J1). */
export const PROJECT_FILE_EXT = '.cctproj'
/** Versione dello schema scritta nel file. Sale quando il formato cambia in modo incompatibile. */
export const PROJECT_FILE_VERSION = 1

/** Impostazioni predefinite del progetto (J2). */
export interface ProjectDefaults {
  model?: ClaudeModel
  effort?: ClaudeEffort
  /** Id della shell predefinita (come in `ShellInfo`). */
  shell?: string
}

/** Contesto del progetto (J5): un'area di lavoro con il suo ambito e i suoi documenti. */
export interface ProjectContextDef {
  id: string
  name: string
  /** Ambito: sottocartelle della radice (relative). Vuoto = tutta la radice. La prima è la cartella di lavoro. */
  dirs: string[]
  /** Documentazione contestuale (J6): file Markdown relativi alla radice, in più di quella globale. */
  docs: string[]
}

/** Nome del file che Claude Code legge da solo nella cartella di lavoro. */
export const CLAUDE_MD = 'CLAUDE.md'

/**
 * Unisce la radice e un percorso relativo del file di progetto (con `/` o `\`, anche con `..`).
 * Il risultato usa le barre di Windows.
 */
export function joinRel(root: string, rel: string): string {
  const drive = /^[a-zA-Z]:/.test(root) ? root.slice(0, 2) : ''
  const parts = (drive ? root.slice(2) : root).split(/[\\/]+/).filter(Boolean)
  for (const seg of rel.split(/[\\/]+/)) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return (drive ? drive + '\\' : '\\') + parts.join('\\')
}

/** Cartella di lavoro di un contesto: la sua prima cartella d'ambito, altrimenti la radice. */
export function contextWorkdir(root: string, ctx: ProjectContextDef | undefined): string {
  return ctx?.dirs[0] ? joinRel(root, ctx.dirs[0]) : root
}

/** Cartelle d'ambito di un contesto in percorsi assoluti (la radice se non ne ha). */
export function contextRoots(root: string, ctx: ProjectContextDef | undefined): string[] {
  return ctx && ctx.dirs.length > 0 ? ctx.dirs.map((d) => joinRel(root, d)) : [root]
}

/**
 * Contenuto del file `.cctproj` (J2). La radice è la cartella che contiene il file.
 * Niente percorsi assoluti né dati personali (J10): i percorsi sono relativi alla radice.
 */
export interface ProjectFile {
  schema: number
  name: string
  /** Cartelle di contesto aggiuntive (W2), relative alla radice (es. `../libreria`). */
  contextDirs: string[]
  docs: {
    /** Riferimenti globali scelti a mano (J4), relativi alla radice. `CLAUDE.md` non sta qui: si rileva da solo (J3). */
    global: string[]
  }
  contexts: ProjectContextDef[]
  defaults: ProjectDefaults
}

/** Un progetto aperto: il file letto più i dati per usarlo. */
export interface ProjectInfo {
  /** Cartella radice (dove sta il `.cctproj`, o la cartella usata nella 1.0). */
  root: string
  /** Percorso del `.cctproj`, o `null` se il progetto viene dalla 1.0 e il file non esiste ancora (J9). */
  file: string | null
  data: ProjectFile
}

/** Voce dell'elenco dei progetti recenti. */
export interface ProjectRef {
  root: string
  name: string
  file: string | null
  openedAt: string
}

export type ProjectResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Contenuto di un progetto nuovo. */
export function emptyProjectFile(name: string): ProjectFile {
  return { schema: PROJECT_FILE_VERSION, name, contextDirs: [], docs: { global: [] }, contexts: [], defaults: {} }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))]
}

/** Un percorso del file di progetto deve essere relativo (J10). */
const isRelativePath = (p: string) => !/^([a-zA-Z]:|[\\/])/.test(p)

/**
 * Legge e valida il contenuto di un `.cctproj`. Tollerante sui campi mancanti (li riempie),
 * severa sulla versione: un file di una versione più nuova non si apre per non perdere dati.
 */
export function parseProjectFile(text: string, fallbackName: string): ProjectResult<ProjectFile> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Il file di progetto non è un JSON valido.' }
  }
  if (!isRecord(raw)) return { ok: false, error: 'Il file di progetto è vuoto o ha un formato inatteso.' }
  const schema = typeof raw.schema === 'number' ? raw.schema : PROJECT_FILE_VERSION
  if (schema > PROJECT_FILE_VERSION) {
    return { ok: false, error: `Il progetto è stato salvato da una versione più nuova dell'app (schema ${schema}). Aggiorna l'app per aprirlo.` }
  }
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : fallbackName
  const docs = isRecord(raw.docs) ? raw.docs : {}
  const defaults = isRecord(raw.defaults) ? raw.defaults : {}
  const contexts: ProjectContextDef[] = Array.isArray(raw.contexts)
    ? raw.contexts
        .filter((c): c is Record<string, unknown> => isRecord(c) && typeof c.id === 'string' && typeof c.name === 'string')
        .map((c) => ({
          id: String(c.id),
          name: String(c.name),
          dirs: stringList(c.dirs).filter(isRelativePath),
          docs: stringList(c.docs).filter(isRelativePath)
        }))
    : []
  const model = CLAUDE_MODELS.find((m) => m.id === defaults.model)?.id
  const effort = CLAUDE_EFFORTS.find((e) => e.id === defaults.effort)?.id
  return {
    ok: true,
    value: {
      schema: PROJECT_FILE_VERSION,
      name,
      contextDirs: stringList(raw.contextDirs).filter(isRelativePath),
      docs: { global: stringList(docs.global).filter(isRelativePath) },
      contexts,
      defaults: {
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(typeof defaults.shell === 'string' && defaults.shell ? { shell: defaults.shell } : {})
      }
    }
  }
}
