import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { diffLines } from 'diff'
import { isOpen, type ChangeContents, type FileChange, type RejectResult, type ReviewNote } from '@shared/changes'
import type { AppDb, ChangeRow } from '../db'
import type { HookEvent } from '../sessions/HookServer'

/** Strumenti di Claude Code che scrivono file (F4). */
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
/** Oltre questa dimensione non si conserva lo snapshot (il file resta comunque elencato). */
const MAX_SNAPSHOT = 8 * 1024 * 1024

interface SessionRef {
  title: string
  cwd: string
}

/**
 * Registra ogni Edit/Write di Claude con la versione precedente del file (F4), li elenca per sessione (F5),
 * e permette di approvarli o rifiutarli (F6). Rifiutare ripristina il file e avvisa la sessione (F7).
 *
 * Funziona con gli hook PreToolUse/PostToolUse: il PreToolUse arriva prima che Claude scriva
 * (Claude aspetta la risposta dell'hook), quindi la copia «prima» è quella vera.
 */
export class ChangeTracker {
  /** Contenuto letto in PreToolUse, in attesa del PostToolUse corrispondente. */
  private readonly before = new Map<string, { filePath: string; hash: string | null; at: number }>()
  /** F7: avvisi per Claude da consegnare al prossimo prompt della sessione. */
  private readonly notices = new Map<string, string[]>()

  constructor(
    private readonly db: AppDb,
    private readonly snapshotDir: string,
    private readonly changed: () => void
  ) {
    mkdirSync(snapshotDir, { recursive: true })
  }

  /**
   * Evento di un hook. Per UserPromptSubmit può restituire il testo da aggiungere al contesto
   * di Claude (le modifiche rifiutate, F7).
   */
  onHook(sessionId: string, session: SessionRef | undefined, e: HookEvent): string | null {
    const tool = typeof e.tool_name === 'string' ? e.tool_name : ''
    switch (e.hook_event_name) {
      case 'PreToolUse':
        if (WRITE_TOOLS.has(tool)) this.preTool(sessionId, session, e)
        return null
      case 'PostToolUse':
        if (WRITE_TOOLS.has(tool)) this.postTool(sessionId, session, e)
        return null
      case 'PostToolUseFailure':
        this.before.delete(this.key(sessionId, e))
        return null
      case 'UserPromptSubmit':
        return this.consumeNotices(sessionId)
      default:
        return null
    }
  }

  private key(sessionId: string, e: HookEvent): string {
    return `${sessionId}:${typeof e.tool_use_id === 'string' ? e.tool_use_id : this.filePathOf(e, '') ?? ''}`
  }

  private filePathOf(e: HookEvent, cwd: string): string | null {
    const input = (e.tool_input ?? {}) as { file_path?: unknown; notebook_path?: unknown }
    const p = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null
    if (!p) return null
    const base = typeof e.cwd === 'string' && e.cwd ? e.cwd : cwd
    return isAbsolute(p) ? resolve(p) : resolve(base, p)
  }

  private preTool(sessionId: string, session: SessionRef | undefined, e: HookEvent): void {
    const filePath = this.filePathOf(e, session?.cwd ?? '')
    if (!filePath) return
    // Se il file ha già una modifica in attesa, la versione «prima» resta quella originale.
    this.before.set(this.key(sessionId, e), { filePath, hash: this.snapshot(filePath), at: Date.now() })
    // Pulizia di eventuali PreToolUse rimasti senza risposta (strumento negato o interrotto).
    const old = Date.now() - 30 * 60 * 1000
    for (const [k, v] of this.before) if (v.at < old) this.before.delete(k)
  }

  private postTool(sessionId: string, session: SessionRef | undefined, e: HookEvent): void {
    const key = this.key(sessionId, e)
    const pre = this.before.get(key)
    this.before.delete(key)
    const filePath = pre?.filePath ?? this.filePathOf(e, session?.cwd ?? '')
    if (!filePath) return
    const afterHash = this.snapshot(filePath)
    const tool = String(e.tool_name)
    const now = new Date().toISOString()
    const existing = this.db.pendingChangeFor(sessionId, filePath)

    if (existing) {
      const tools = [...(JSON.parse(existing.tools_json) as string[]), tool]
      const { added, removed } = this.count(existing.before_hash, afterHash)
      // F8: dopo una richiesta di modifiche, la nuova versione torna da rivedere.
      this.db.updateChange({
        ...existing,
        status: 'pending',
        session_title: session?.title ?? existing.session_title,
        tools_json: JSON.stringify(tools),
        after_hash: afterHash,
        added,
        removed,
        updated_at: now
      })
    } else {
      const beforeHash = pre ? pre.hash : null
      if (beforeHash === afterHash) return // nessun cambiamento effettivo
      const { added, removed } = this.count(beforeHash, afterHash)
      this.db.insertChange({
        id: randomUUID(),
        session_id: sessionId,
        session_title: session?.title ?? 'Sessione',
        cwd: session?.cwd ?? '',
        file_path: filePath,
        tools_json: JSON.stringify([tool]),
        before_hash: beforeHash,
        after_hash: afterHash,
        status: 'pending',
        added,
        removed,
        created_at: now,
        updated_at: now,
        decided_at: null
      })
    }
    this.changed()
  }

  /** Copia il contenuto attuale del file nell'archivio degli snapshot. `null` se il file non esiste. */
  private snapshot(filePath: string): string | null {
    let data: Buffer
    try {
      if (!statSync(filePath).isFile()) return null
      if (statSync(filePath).size > MAX_SNAPSHOT) return `toolarge:${statSync(filePath).size}`
      data = readFileSync(filePath)
    } catch {
      return null
    }
    const hash = createHash('sha256').update(data).digest('hex')
    const target = join(this.snapshotDir, hash)
    if (!existsSync(target)) writeFileSync(target, data)
    return hash
  }

  private read(hash: string | null): Buffer | null {
    if (!hash || hash.startsWith('toolarge:')) return null
    try {
      return readFileSync(join(this.snapshotDir, hash))
    } catch {
      return null
    }
  }

  private count(beforeHash: string | null, afterHash: string | null): { added: number; removed: number } {
    const a = this.read(beforeHash)
    const b = this.read(afterHash)
    if ((a && isBinary(a)) || (b && isBinary(b))) return { added: 0, removed: 0 }
    let added = 0
    let removed = 0
    for (const part of diffLines(a?.toString('utf8') ?? '', b?.toString('utf8') ?? '')) {
      if (part.added) added += part.count ?? 0
      if (part.removed) removed += part.count ?? 0
    }
    return { added, removed }
  }

  list(): FileChange[] {
    const counts = this.db.requestCounts()
    return this.db.listChanges().map((r) => toChange(r, counts.get(r.id) ?? 0))
  }

  contents(id: string): ChangeContents | null {
    const row = this.db.getChange(id)
    if (!row) return null
    const before = this.read(row.before_hash)
    const after = this.read(row.after_hash)
    const binary = Boolean((before && isBinary(before)) || (after && isBinary(after)))
    const requests = this.db.requestsFor(id)
    const last = requests.at(-1)
    const base = last ? this.read(last.base_hash) : null
    return {
      change: toChange(row, requests.length),
      before: binary ? null : (before?.toString('utf8') ?? (row.before_hash ? null : '')),
      after: binary ? null : (after?.toString('utf8') ?? (row.after_hash ? null : '')),
      lastRequestBase: binary || !last ? null : (base?.toString('utf8') ?? (last.base_hash ? null : '')),
      requests: requests.map((r) => ({ id: r.id, changeId: r.change_id, notes: JSON.parse(r.notes_json) as ReviewNote[], createdAt: r.created_at })),
      modifiedSince: isOpen(row as { status: FileChange['status'] }) && this.currentHash(row.file_path) !== row.after_hash,
      binary
    }
  }

  /**
   * F8: registra una richiesta di modifiche su un file e prepara il messaggio per Claude.
   * La modifica passa in «modifiche richieste» finché Claude non riscrive il file.
   */
  requestRevision(id: string, notes: ReviewNote[]): { ok: true; sessionId: string; message: string } | { ok: false; error: string } {
    const row = this.db.getChange(id)
    if (!row || !isOpen(row as { status: FileChange['status'] })) return { ok: false, error: 'La modifica non è più aperta.' }
    const clean = notes.map((n) => ({ ...n, text: n.text.trim() })).filter((n) => n.text)
    if (!clean.length) return { ok: false, error: 'Scrivi almeno una indicazione.' }
    const now = new Date().toISOString()
    this.db.insertRequest({ id: randomUUID(), change_id: id, notes_json: JSON.stringify(clean), base_hash: row.after_hash, created_at: now })
    this.db.updateChange({ ...row, status: 'revision', updated_at: now })
    this.changed()
    return { ok: true, sessionId: row.session_id, message: revisionMessage(row.file_path, row.before_hash === null, clean) }
  }

  private currentHash(filePath: string): string | null {
    try {
      if (!statSync(filePath).isFile()) return null
      return createHash('sha256').update(readFileSync(filePath)).digest('hex')
    } catch {
      return null
    }
  }

  approve(id: string): void {
    const row = this.db.getChange(id)
    if (!row || !isOpen(row as { status: FileChange['status'] })) return
    const now = new Date().toISOString()
    this.db.updateChange({ ...row, status: 'approved', decided_at: now, updated_at: now })
    this.changed()
  }

  /** Approva tutte le modifiche in attesa (di una sessione, o di tutte). */
  approveAll(sessionId?: string): number {
    const rows = this.db.listChanges(0).filter((r) => r.status === 'pending' && (!sessionId || r.session_id === sessionId))
    const now = new Date().toISOString()
    for (const r of rows) this.db.updateChange({ ...r, status: 'approved', decided_at: now, updated_at: now })
    if (rows.length) this.changed()
    return rows.length
  }

  /**
   * F7: ripristina la versione precedente (o cancella il file se l'aveva creato Claude) e prepara
   * l'avviso per la sessione. Se il file è cambiato dopo la modifica di Claude serve `force`.
   */
  reject(id: string, force = false): RejectResult {
    const row = this.db.getChange(id)
    if (!row || !isOpen(row as { status: FileChange['status'] })) return { ok: false, error: 'La modifica non è più aperta.' }
    if (!force && this.currentHash(row.file_path) !== row.after_hash) return { ok: false, needsForce: true }
    try {
      if (row.before_hash === null) {
        if (existsSync(row.file_path)) unlinkSync(row.file_path)
      } else {
        const data = this.read(row.before_hash)
        if (!data) return { ok: false, error: 'La versione precedente non è disponibile (file troppo grande o archivio mancante).' }
        writeFileSync(row.file_path, data)
      }
    } catch (err) {
      return { ok: false, error: `Impossibile ripristinare il file: ${(err as Error).message}` }
    }
    const now = new Date().toISOString()
    this.db.updateChange({ ...row, status: 'rejected', decided_at: now, updated_at: now })
    const what = row.before_hash === null ? 'il file è stato cancellato' : 'il file è stato riportato alla versione precedente'
    const list = this.notices.get(row.session_id) ?? []
    list.push(`- ${row.file_path}: ${what}`)
    this.notices.set(row.session_id, list)
    this.changed()
    return { ok: true }
  }

  /** Testo per Claude con le modifiche rifiutate dall'ultimo prompt (consegnato una volta sola). */
  private consumeNotices(sessionId: string): string | null {
    const list = this.notices.get(sessionId)
    if (!list?.length) return null
    this.notices.delete(sessionId)
    return [
      "L'utente ha esaminato e RIFIUTATO alcune tue modifiche nel pannello di revisione di Claude Code Terminal:",
      ...list,
      'Considera questi file come sono ora su disco. Non riapplicare quelle modifiche senza chiedere prima.'
    ].join('\n')
  }

  /** Avvisi in attesa per una sessione (per mostrarli nell'interfaccia). */
  hasNotices(sessionId: string): boolean {
    return (this.notices.get(sessionId)?.length ?? 0) > 0
  }

  /** Toglie snapshot non più usati e modifiche decise da più di 30 giorni. */
  cleanup(): void {
    this.db.pruneChanges(30)
    const used = this.db.usedSnapshotHashes()
    try {
      for (const name of readdirSync(this.snapshotDir)) if (!used.has(name)) rmSync(join(this.snapshotDir, name), { force: true })
    } catch {
      // archivio non leggibile: si riprova al prossimo avvio
    }
  }
}

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

/**
 * Messaggio per Claude con le indicazioni del revisore (F8). Va scritto nella sessione come un normale
 * messaggio dell'utente: Claude deve correggere il file e la nuova versione torna in revisione.
 */
function revisionMessage(filePath: string, created: boolean, notes: ReviewNote[]): string {
  const lines = notes.map((n) => {
    const where = n.lines ? (n.lines.start === n.lines.end ? `riga ${n.lines.start}` : `righe ${n.lines.start}–${n.lines.end}`) : ''
    const label = n.kind === 'forbid' ? 'DIVIETO' : 'ACCORTEZZA'
    const excerpt = n.excerpt ? `\n    (${where}: ${n.excerpt.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' ⏎ ').slice(0, 160)})` : where ? ` (${where})` : ''
    return `- ${label}: ${n.text}${excerpt}`
  })
  return [
    `Revisione di ${filePath}${created ? ' (file creato da te)' : ''}: ho guardato la tua modifica nel pannello di revisione e chiedo dei cambiamenti.`,
    ...lines,
    'Correggi questo file seguendo le indicazioni (le ACCORTEZZE vanno rispettate, i DIVIETI non vanno violati). Non toccare altri file se non serve. La nuova versione tornerà in revisione.'
  ].join('\n')
}

function toChange(r: ChangeRow, requests = 0): FileChange {
  return {
    requests,
    id: r.id,
    sessionId: r.session_id,
    sessionTitle: r.session_title,
    cwd: r.cwd,
    filePath: r.file_path,
    tools: JSON.parse(r.tools_json) as string[],
    created: r.before_hash === null,
    status: r.status as FileChange['status'],
    added: r.added,
    removed: r.removed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    decidedAt: r.decided_at ?? undefined
  }
}
