// Spostamento, rinomina e copia di file e cartelle (Esplora file, vista Package). Solo operazioni sul disco: il refactoring
// (le modifiche al codice) lo chiede il chiamante agli adapter dei plugin. Senza dipendenze dall'app, così si prova da solo
// con `node --experimental-strip-types`.
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

export interface MoveItem {
  from: string
  to: string
}

export interface TextEditLike {
  range: { start: { line: number; column: number }; end: { line: number; column: number } }
  newText: string
}

export interface FileEditLike {
  path: string
  edits: TextEditLike[]
}

const norm = (p: string): string => resolve(p).replace(/[\\/]+$/, '').toLowerCase()

export function isInsidePath(child: string, parent: string): boolean {
  const c = norm(child)
  const p = norm(parent)
  return c === p || c.startsWith(p + sep) || c.startsWith(p + '/')
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

export interface ValidateResult {
  ok: boolean
  error?: string
  /** Destinazioni che esistono già (da confermare prima di sostituire). */
  conflicts: string[]
}

/**
 * Controlla le operazioni prima di eseguirle: tutto dentro la cartella del progetto, l'origine esiste, non si sposta una
 * cartella dentro se stessa, nessuna destinazione doppia. Le destinazioni già esistenti si segnalano come conflitti.
 */
export async function validate(root: string, items: MoveItem[], copy: boolean): Promise<ValidateResult> {
  const fail = (error: string): ValidateResult => ({ ok: false, error, conflicts: [] })
  if (!items.length) return fail('Niente da spostare.')
  const seen = new Set<string>()
  const conflicts: string[] = []
  for (const it of items) {
    if (typeof it.from !== 'string' || typeof it.to !== 'string' || !it.from || !it.to) return fail('Richiesta non valida.')
    if (!isInsidePath(it.from, root) || !isInsidePath(it.to, root)) return fail('Si può lavorare solo dentro la cartella del progetto.')
    if (norm(it.from) === norm(root)) return fail('La cartella del progetto non si può spostare.')
    if (!(await exists(it.from))) return fail(`Non esiste più: ${it.from}`)
    const k = norm(it.to)
    if (seen.has(k)) return fail(`Due elementi finirebbero nello stesso posto: ${it.to}`)
    seen.add(k)
    if (k === norm(it.from)) {
      // Rinomina che cambia solo le maiuscole (Windows non le distingue): non è un conflitto.
      if (copy || resolve(it.from) === resolve(it.to)) return fail('Origine e destinazione coincidono.')
      continue
    }
    if (isInsidePath(it.to, it.from)) return fail(`Una cartella non si può spostare dentro se stessa: ${it.from}`)
    if (await exists(it.to)) conflicts.push(it.to)
  }
  return { ok: true, conflicts }
}

/** Un solo `fs.rename`, con ripiego su copia + cancellazione se i due percorsi stanno su dischi diversi. */
async function moveOne(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true })
  try {
    await rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await cp(from, to, { recursive: true, errorOnExist: true, force: false })
    await rm(from, { recursive: true, force: true })
  }
}

export interface PerformResult {
  ok: boolean
  error?: string
  /** Quante modifiche di testo sono state applicate. */
  edited: number
}

/**
 * Esegue: prima le modifiche al codice (ai percorsi di prima), poi lo spostamento o la copia. Se lo spostamento fallisce, i
 * testi tornano come prima. `replace`: le destinazioni esistenti vengono sostituite (finiscono nel cestino solo se il
 * chiamante lo ha già deciso: qui si cancellano).
 */
export async function perform(
  root: string,
  items: MoveItem[],
  copy: boolean,
  replace: boolean,
  edits: FileEditLike[],
  applyTextEdits: (text: string, edits: TextEditLike[]) => string
): Promise<PerformResult> {
  const v = await validate(root, items, copy)
  if (!v.ok) return { ok: false, error: v.error, edited: 0 }
  if (v.conflicts.length && !replace) return { ok: false, error: `Esiste già: ${v.conflicts[0]}`, edited: 0 }
  // Una cartella non si può sostituire con un file (né il contrario) e non si fonde: meglio fermarsi che perdere dati.
  for (const it of items) {
    if (!v.conflicts.includes(it.to)) continue
    const [a, b] = await Promise.all([stat(it.from), stat(it.to)])
    if (a.isDirectory() !== b.isDirectory()) return { ok: false, error: `Non si può sostituire un file con una cartella (o il contrario): ${it.to}`, edited: 0 }
  }

  // 1. Modifiche al codice (solo file dentro il progetto), con i testi originali per tornare indietro.
  const backups: { path: string; text: string }[] = []
  let edited = 0
  try {
    if (!copy) {
      for (const f of edits) {
        if (!isInsidePath(f.path, root) || !f.edits.length) continue
        const text = await readFile(f.path, 'utf8')
        const next = applyTextEdits(text, f.edits)
        if (next === text) continue
        backups.push({ path: f.path, text })
        await writeFile(f.path, next, 'utf8')
        edited++
      }
    }
    // 2. Spostamento o copia.
    const done: MoveItem[] = []
    try {
      for (const it of items) {
        if (v.conflicts.includes(it.to) && norm(it.from) !== norm(it.to)) await rm(it.to, { recursive: true, force: true })
        if (copy) {
          await mkdir(dirname(it.to), { recursive: true })
          await cp(it.from, it.to, { recursive: true, errorOnExist: true, force: false })
        } else {
          await moveOne(it.from, it.to)
        }
        done.push(it)
      }
    } catch (err) {
      // Ciò che si è già spostato torna al suo posto.
      for (const it of done.reverse()) {
        try {
          if (copy) await rm(it.to, { recursive: true, force: true })
          else await moveOne(it.to, it.from)
        } catch {
          /* il ripristino è best effort */
        }
      }
      throw err
    }
  } catch (err) {
    for (const b of backups.reverse()) await writeFile(b.path, b.text, 'utf8').catch(() => {})
    return { ok: false, error: (err as Error).message, edited: 0 }
  }
  return { ok: true, edited }
}
