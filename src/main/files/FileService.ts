import { execFile } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { DirEntry, FileContent, FileIndex, GitMark, GitStatus, SaveFileResult } from '@shared/files'
import { normPath } from '@shared/files'
import { compileMatcher, matchesInclude, parseInclude, searchText, SEARCH_LIMITS, type SearchFileResult, type SearchOptions, type SearchResult } from '@shared/search'

const run = promisify(execFile)
const MAX_TEXT = 5 * 1024 * 1024
/** Cartelle nascoste nell'albero (rumore). */
const HIDDEN = new Set(['.git'])
/** Cartelle saltate dall'indice della palette quando la cartella non è un repository git. */
const INDEX_SKIP = new Set(['.git', 'node_modules', 'dist', 'out', 'build', 'target', '.gradle', '.idea', '.vscode', '.venv', 'venv', '__pycache__', '.next', '.angular', 'coverage'])
const INDEX_MAX = 20000
const INDEX_TTL_MS = 15000

/**
 * File del workspace per l'esplora file e l'editor (F1, F2): elenco delle cartelle, lettura e
 * scrittura, stato git (M/A/D) e osservazione delle modifiche.
 */
export class FileService {
  private watchers = new Map<string, { w: FSWatcher; refs: number }>()
  private pending = new Map<string, Set<string>>()
  private timers = new Map<string, NodeJS.Timeout>()
  private indexCache = new Map<string, { at: number; value: Promise<FileIndex> }>()

  constructor(private readonly onChange: (root: string, paths: string[]) => void) {}

  async list(dir: string): Promise<DirEntry[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => !HIDDEN.has(e.name))
      .map((e) => ({ name: e.name, path: join(dir, e.name), dir: e.isDirectory() }))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }) : a.dir ? -1 : 1))
  }

  async read(path: string): Promise<FileContent> {
    const s = await stat(path)
    if (s.size > MAX_TEXT) return { path, text: '', mtime: s.mtimeMs, binary: false, tooLarge: true }
    const buf = await readFile(path)
    const binary = buf.subarray(0, 8000).includes(0)
    return { path, text: binary ? '' : buf.toString('utf8').replace(/^﻿/, ''), mtime: s.mtimeMs, binary, tooLarge: false }
  }

  /** Salva. Se il file è cambiato su disco dopo `expectedMtime` serve `force` (F2: niente sovrascritture a sorpresa). */
  async write(path: string, text: string, expectedMtime?: number, force = false): Promise<SaveFileResult> {
    try {
      if (expectedMtime !== undefined && !force) {
        const s = await stat(path).catch(() => null)
        if (s && Math.abs(s.mtimeMs - expectedMtime) > 1) return { ok: false, conflict: true }
      }
      await writeFile(path, text, 'utf8')
      return { ok: true, mtime: (await stat(path)).mtimeMs }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  /**
   * L7: elenco dei file per la palette comandi. In un repository git usa `git ls-files` (rispetta
   * .gitignore e include i file nuovi); altrimenti visita le cartelle saltando quelle generate.
   * Il risultato resta in memoria per qualche secondo: la palette lo chiede a ogni apertura.
   */
  index(root: string): Promise<FileIndex> {
    const key = normPath(root)
    const cached = this.indexCache.get(key)
    if (cached && Date.now() - cached.at < INDEX_TTL_MS) return cached.value
    const value = this.buildIndex(root).catch((): FileIndex => ({ root, files: [], truncated: false }))
    this.indexCache.set(key, { at: Date.now(), value })
    return value
  }

  /** Ricerca del testo: una ricerca nuova ferma la precedente. */
  private searchSeq = 0

  async search(root: string, query: string, opts: SearchOptions): Promise<SearchResult> {
    const empty = (error?: string): SearchResult => ({ ok: !error, error, root, files: [], total: 0, truncated: false, searched: 0 })
    if (!query) return empty()
    const seq = ++this.searchSeq
    let re: RegExp
    try {
      re = compileMatcher(query, opts)
    } catch (e) {
      return empty((e as Error).message)
    }
    const include = parseInclude(opts.include)
    const index = await this.index(root)
    const files: SearchFileResult[] = []
    let total = 0
    let searched = 0
    let truncated = index.truncated
    for (const rel of index.files) {
      if (seq !== this.searchSeq) return empty('cancelled')
      if (!matchesInclude(rel, include)) continue
      let data: Buffer
      try {
        const full = join(root, rel)
        const st = await stat(full)
        if (!st.isFile() || st.size > SEARCH_LIMITS.fileBytes) continue
        data = await readFile(full)
      } catch {
        continue
      }
      searched++
      // Binario: un byte nullo nei primi 8000 (i file UTF-16 contano come binari, come nell'editor).
      if (data.subarray(0, 8000).includes(0)) continue
      const matches = searchText(data.toString('utf8'), re)
      if (matches.length) {
        files.push({ file: rel, matches })
        total += matches.length
        if (total >= SEARCH_LIMITS.matches) {
          truncated = true
          break
        }
      }
      // Lascia respirare il processo principale.
      if (searched % 40 === 0) await new Promise((r) => setImmediate(r))
    }
    files.sort((a, b) => a.file.localeCompare(b.file, 'it'))
    return { ok: true, root, files, total, truncated, searched }
  }

  private async buildIndex(root: string): Promise<FileIndex> {
    try {
      const { stdout } = await run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 64 * 1024 * 1024
      })
      const all = [...new Set(stdout.split('\0').filter(Boolean))].map((p) => p.replace(/\//g, '\\'))
      return { root, files: all.slice(0, INDEX_MAX), truncated: all.length > INDEX_MAX }
    } catch {
      // Non è un repository git (o git manca): visita a mano.
    }
    const files: string[] = []
    const queue = ['']
    while (queue.length && files.length < INDEX_MAX) {
      const rel = queue.shift()!
      const entries = await readdir(join(root, rel), { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        const child = rel ? `${rel}\\${e.name}` : e.name
        if (e.isDirectory()) {
          if (!INDEX_SKIP.has(e.name)) queue.push(child)
        } else if (files.push(child) >= INDEX_MAX) break
      }
    }
    return { root, files, truncated: files.length >= INDEX_MAX }
  }

  /** F1: stato git dei file (M, A, D, R, U) per la cartella indicata. */
  async gitStatus(dir: string): Promise<GitStatus> {
    let root: string
    try {
      root = (await run('git', ['rev-parse', '--show-toplevel'], { cwd: dir, windowsHide: true, timeout: 5000 })).stdout.trim()
    } catch {
      return { root: null, branch: null, files: {} }
    }
    root = resolve(root)
    const files: Record<string, GitMark> = {}
    let branch: string | null = null
    try {
      const { stdout } = await run('git', ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'], {
        cwd: root,
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 32 * 1024 * 1024
      })
      const parts = stdout.split('\0')
      for (let i = 0; i < parts.length; i++) {
        const entry = parts[i]
        if (!entry) continue
        if (entry.startsWith('## ')) {
          branch = entry.slice(3).split('...')[0].replace(/^No commits yet on /, '') || null
          continue
        }
        const xy = entry.slice(0, 2)
        const file = entry.slice(3)
        let mark: GitMark = 'M'
        if (xy === '??' || xy.includes('A')) mark = 'A'
        else if (xy.includes('D')) mark = 'D'
        else if (xy.includes('R')) {
          mark = 'R'
          i++ // il percorso di origine della rinomina è il pezzo successivo
        } else if (xy.includes('U')) mark = 'U'
        files[normPath(isAbsolute(file) ? file : join(root, file))] = mark
      }
    } catch {
      // stato non leggibile: niente segni
    }
    return { root, branch, files }
  }

  /** Osserva una cartella (anche le sottocartelle). Più pannelli possono osservare la stessa cartella. */
  watch(root: string): void {
    const key = normPath(root)
    const existing = this.watchers.get(key)
    if (existing) {
      existing.refs++
      return
    }
    try {
      const w = watch(root, { recursive: true }, (_event, name) => {
        if (!name) return
        const rel = name.toString()
        // Dentro .git interessano solo i file che cambiano lo stato (index, HEAD).
        if (/^\.git[\\/]/.test(rel) && !/^\.git[\\/](index|HEAD)$/.test(rel)) return
        const set = this.pending.get(key) ?? new Set<string>()
        set.add(join(root, rel))
        this.pending.set(key, set)
        clearTimeout(this.timers.get(key))
        this.timers.set(
          key,
          setTimeout(() => {
            const paths = [...(this.pending.get(key) ?? [])]
            this.pending.delete(key)
            // L'elenco in memoria (palette, ricerca, vista Package) non è più valido.
            this.indexCache.delete(key)
            this.onChange(root, paths)
          }, 300)
        )
      })
      w.on('error', () => this.unwatch(root, true))
      this.watchers.set(key, { w, refs: 1 })
    } catch {
      // cartella non osservabile
    }
  }

  unwatch(root: string, force = false): void {
    const key = normPath(root)
    const entry = this.watchers.get(key)
    if (!entry) return
    entry.refs--
    if (entry.refs <= 0 || force) {
      entry.w.close()
      this.watchers.delete(key)
    }
  }

  dispose(): void {
    for (const { w } of this.watchers.values()) w.close()
    this.watchers.clear()
  }
}
