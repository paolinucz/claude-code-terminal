import { existsSync, mkdirSync, readFileSync, unwatchFile, watchFile, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  mergeScope,
  renderSettings,
  type Decision,
  type ExternalChange,
  type PermissionRule,
  type PermissionScope,
  type PermissionsState,
  type RuleOrigin,
  type SaveResult,
  type ScopeData,
  type ScopeState
} from '@shared/permissions'
import type { AppDb } from '../db'

const DECISIONS: Decision[] = ['allow', 'ask', 'deny']

/** Percorsi dei tre file di impostazioni di Claude Code (P1). */
export function scopePaths(cwd: string): Record<PermissionScope, string> {
  return {
    local: join(cwd, '.claude', 'settings.local.json'),
    project: join(cwd, '.claude', 'settings.json'),
    user: join(homedir(), '.claude', 'settings.json')
  }
}

interface Parsed {
  exists: boolean
  raw: string
  json: Record<string, unknown> | null
  error?: string
}

function readFile(path: string): Parsed {
  if (!existsSync(path)) return { exists: false, raw: '', json: {} }
  let raw = ''
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    return { exists: true, raw: '', json: null, error: (err as Error).message }
  }
  if (!raw.trim()) return { exists: true, raw, json: {} }
  try {
    const json = JSON.parse(raw.replace(/^﻿/, '')) as unknown
    if (!json || typeof json !== 'object' || Array.isArray(json)) return { exists: true, raw, json: null, error: 'Il file non contiene un oggetto JSON.' }
    return { exists: true, raw, json: json as Record<string, unknown> }
  } catch (err) {
    return { exists: true, raw, json: null, error: `JSON non valido: ${(err as Error).message}` }
  }
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function dataOf(json: Record<string, unknown> | null): ScopeData {
  const p = (json?.permissions ?? {}) as Record<string, unknown>
  return { allow: strings(p.allow), ask: strings(p.ask), deny: strings(p.deny), additionalDirectories: strings(p.additionalDirectories) }
}

/**
 * Legge e scrive i file di impostazioni di Claude Code (P1–P5) e li osserva per accorgersi delle
 * modifiche fatte fuori dall'app, per esempio un «Sì, e ricorda» nel terminale (P3, P6).
 */
export class PermissionsService {
  private watched: (() => void)[] = []
  private watchedCwd: string | null = null
  /** Ultimo contenuto noto di ogni file: serve a capire cosa è cambiato. */
  private known = new Map<string, string>()
  /** Contenuti scritti dall'app: le notifiche del watcher che li riguardano si ignorano. */
  private selfWrites = new Map<string, string>()
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly db: AppDb,
    /** Una sessione di Claude dell'app è aperta in questa cartella (per attribuire l'origine «terminale»). */
    private readonly claudeActiveIn: (cwd: string) => boolean,
    private readonly onExternalChange: (change: ExternalChange) => void
  ) {}

  read(cwd: string): PermissionsState {
    const paths = scopePaths(cwd)
    const scopes = (['local', 'project', 'user'] as PermissionScope[]).map((scope) => this.readScope(scope, paths[scope]))
    return { cwd, scopes }
  }

  private readScope(scope: PermissionScope, path: string): ScopeState {
    const parsed = readFile(path)
    this.known.set(path, parsed.raw)
    const data = dataOf(parsed.json)
    const meta = this.db.permissionMeta(path)
    const rules: PermissionRule[] = []
    for (const decision of DECISIONS) {
      for (const rule of data[decision]) {
        let m = meta.get(`${decision}\u0000${rule}`)
        if (!m) {
          // Prima volta che l'app vede questa regola: era già nel file.
          m = { origin: 'existing', addedAt: null }
          this.db.setPermissionMeta(path, rule, decision, 'existing', null)
        }
        rules.push({ rule, decision, origin: m.origin as RuleOrigin, addedAt: m.addedAt ?? undefined })
      }
    }
    return {
      scope,
      path,
      exists: parsed.exists,
      rules,
      additionalDirectories: data.additionalDirectories,
      raw: parsed.raw,
      parseError: parsed.error
    }
  }

  /** P5: salva un ambito. Le regole nuove vengono segnate «aggiunte a mano». */
  save(cwd: string, scope: PermissionScope, data: ScopeData): SaveResult {
    const path = scopePaths(cwd)[scope]
    const parsed = readFile(path)
    if (!parsed.json) return { ok: false, error: `Impossibile salvare: ${parsed.error ?? 'file non leggibile'}. Correggi il file a mano.` }
    const clean: ScopeData = {
      allow: unique(data.allow),
      ask: unique(data.ask),
      deny: unique(data.deny),
      additionalDirectories: unique(data.additionalDirectories)
    }
    const text = renderSettings(mergeScope(parsed.json, clean))
    try {
      mkdirSync(dirname(path), { recursive: true })
      this.selfWrites.set(path, text)
      writeFileSync(path, text, 'utf8')
    } catch (err) {
      this.selfWrites.delete(path)
      return { ok: false, error: `Impossibile scrivere ${path}: ${(err as Error).message}` }
    }
    const before = dataOf(parsed.json)
    const now = new Date().toISOString()
    for (const d of DECISIONS) {
      for (const rule of clean[d]) if (!before[d].includes(rule)) this.db.setPermissionMeta(path, rule, d, 'manual', now)
    }
    this.known.set(path, text)
    return { ok: true }
  }

  /**
   * Osserva i file di una cartella di progetto (e quello dell'utente). Una cartella alla volta.
   * Si usa il controllo periodico (ogni secondo) invece di fs.watch: funziona anche se il file o la
   * cartella .claude non esistono ancora, senza doverli creare nel progetto.
   */
  watch(cwd: string): void {
    if (this.watchedCwd === cwd) return
    this.unwatch()
    this.watchedCwd = cwd
    const paths = scopePaths(cwd)
    for (const [scope, p] of Object.entries(paths) as [PermissionScope, string][]) {
      if (!this.known.has(p)) this.known.set(p, readFile(p).raw)
      const listener = () => this.schedule(cwd, scope, p)
      watchFile(p, { interval: 1000 }, listener)
      this.watched.push(() => unwatchFile(p, listener))
    }
  }

  unwatch(): void {
    for (const stop of this.watched) stop()
    this.watched = []
    this.watchedCwd = null
  }

  private schedule(cwd: string, scope: PermissionScope, path: string): void {
    clearTimeout(this.timers.get(path))
    this.timers.set(
      path,
      setTimeout(() => this.check(cwd, scope, path), 200)
    )
  }

  /** P6: il file è cambiato. Se non l'ha scritto l'app, si calcolano le differenze e si avvisa. */
  private check(cwd: string, scope: PermissionScope, path: string): void {
    const parsed = readFile(path)
    const previous = this.known.get(path) ?? ''
    if (parsed.raw === previous) return
    if (this.selfWrites.get(path) === parsed.raw) {
      this.selfWrites.delete(path)
      this.known.set(path, parsed.raw)
      return
    }
    this.known.set(path, parsed.raw)
    const before = dataOf(safeParse(previous))
    const after = dataOf(parsed.json)
    const added: ExternalChange['added'] = []
    const removed: ExternalChange['removed'] = []
    for (const d of DECISIONS) {
      for (const r of after[d]) if (!before[d].includes(r)) added.push({ rule: r, decision: d })
      for (const r of before[d]) if (!after[d].includes(r)) removed.push({ rule: r, decision: d })
    }
    // P3: una regola nuova mentre una sessione di Claude dell'app lavora qui è quasi certamente un «Sì, e ricorda».
    const fromTerminal = added.length > 0 && this.claudeActiveIn(cwd)
    const now = new Date().toISOString()
    for (const a of added) this.db.setPermissionMeta(path, a.rule, a.decision, fromTerminal ? 'terminal' : 'external', now)
    this.onExternalChange({
      cwd,
      scope,
      path,
      added,
      removed,
      directoriesAdded: after.additionalDirectories.filter((d) => !before.additionalDirectories.includes(d)),
      directoriesRemoved: before.additionalDirectories.filter((d) => !after.additionalDirectories.includes(d)),
      fromTerminal
    })
  }
}

function safeParse(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw.replace(/^﻿/, '')) as Record<string, unknown>
  } catch {
    return null
  }
}

function unique(list: string[]): string[] {
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))]
}
