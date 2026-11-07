import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import {
  emptyProjectFile,
  parseProjectFile,
  PROJECT_FILE_EXT,
  type ProjectFile,
  type ProjectInfo,
  type ProjectRef,
  type ProjectResult
} from '@shared/project'
import type { AppDb } from '../db'

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

/**
 * Progetti (J1, J2, J9, J10): legge e scrive il file `.cctproj` nella radice del progetto.
 * Il file si può versionare nel repository, quindi contiene solo percorsi relativi e nessun dato personale.
 * Dati personali (recenti, preferenze) restano nel database dell'app.
 */
export class ProjectService {
  constructor(private readonly db: AppDb) {}

  /** Percorso standard del file per una radice: `<radice>\<nome cartella>.cctproj`. */
  fileFor(root: string): string {
    return join(root, basename(root) + PROJECT_FILE_EXT)
  }

  /** Cerca un `.cctproj` direttamente nella radice (il primo in ordine alfabetico). */
  async findFile(root: string): Promise<string | null> {
    try {
      const names = (await readdir(root)).filter((n) => extname(n).toLowerCase() === PROJECT_FILE_EXT).sort()
      return names[0] ? join(root, names[0]) : null
    } catch {
      return null
    }
  }

  /**
   * Apre un progetto da un `.cctproj` o da una cartella. Una cartella senza file (per esempio una usata nella 1.0)
   * si apre come progetto «senza file»: il file non si crea finché l'utente non lo chiede (J9).
   */
  async open(path: string): Promise<ProjectResult<ProjectInfo>> {
    let s
    try {
      s = await stat(path)
    } catch {
      return fail('Il percorso non esiste.')
    }
    let root: string
    let file: string | null
    if (s.isDirectory()) {
      root = resolve(path)
      file = await this.findFile(root)
    } else if (extname(path).toLowerCase() === PROJECT_FILE_EXT) {
      file = resolve(path)
      root = dirname(file)
    } else {
      return fail(`Scegli una cartella o un file ${PROJECT_FILE_EXT}.`)
    }

    const fallbackName = basename(root) || root
    let data: ProjectFile
    if (file) {
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch (err) {
        return fail(`Impossibile leggere il file di progetto: ${(err as Error).message}`)
      }
      const parsed = parseProjectFile(text.replace(/^\uFEFF/, ''), fallbackName)
      if (!parsed.ok) return parsed
      data = parsed.value
    } else {
      data = emptyProjectFile(fallbackName)
    }
    this.db.rememberProject(root, data.name, file)
    return { ok: true, value: { root, file, data } }
  }

  /** Crea il `.cctproj` per una cartella (nuova o già in uso) e apre il progetto. Non sovrascrive un file esistente. */
  async create(root: string, name?: string): Promise<ProjectResult<ProjectInfo>> {
    root = resolve(root)
    try {
      await mkdir(root, { recursive: true })
    } catch (err) {
      return fail(`Impossibile creare la cartella: ${(err as Error).message}`)
    }
    if (await this.findFile(root)) return fail('In questa cartella c’è già un progetto: aprilo invece di crearlo.')
    const file = this.fileFor(root)
    const data = emptyProjectFile(name?.trim() || basename(root) || root)
    const written = await this.writeFile(file, data)
    if (!written.ok) return written
    this.db.rememberProject(root, data.name, file)
    return { ok: true, value: { root, file, data } }
  }

  /** Salva le modifiche al progetto. Se il file non c'era (progetto della 1.0) lo crea. */
  async save(root: string, data: ProjectFile): Promise<ProjectResult<ProjectInfo>> {
    root = resolve(root)
    const file = (await this.findFile(root)) ?? this.fileFor(root)
    const written = await this.writeFile(file, data)
    if (!written.ok) return written
    this.db.rememberProject(root, data.name, file)
    return { ok: true, value: { root, file, data } }
  }

  /** Percorso relativo alla radice, con barre `/` così il file è uguale su ogni computer (J10). */
  toRelative(root: string, path: string): string {
    return relative(root, path).split('\\').join('/')
  }

  /** Progetti recenti: quelli aperti con l'app 2 più le cartelle usate nella 1.0 (J9), dal più recente. */
  recents(): ProjectRef[] {
    const out = new Map<string, ProjectRef>()
    for (const p of this.db.listProjects()) {
      out.set(p.root.toLowerCase(), { root: p.root, name: p.name, file: p.file, openedAt: p.opened_at })
    }
    for (const p of this.db.recentProjects(30)) {
      const key = p.cwd.toLowerCase()
      if (!out.has(key)) out.set(key, { root: p.cwd, name: basename(p.cwd) || p.cwd, file: null, openedAt: p.updatedAt })
    }
    return [...out.values()].sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, 30)
  }

  /** Toglie un progetto dai recenti. Non cancella né il file né la cartella. */
  forget(root: string): void {
    this.db.forgetProject(root)
  }

  private async writeFile(file: string, data: ProjectFile): Promise<ProjectResult<true>> {
    try {
      if (!existsSync(dirname(file))) await mkdir(dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
      return { ok: true, value: true }
    } catch (err) {
      return fail(`Impossibile scrivere il file di progetto: ${(err as Error).message}`)
    }
  }
}
