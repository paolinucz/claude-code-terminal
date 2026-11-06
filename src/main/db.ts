import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { NamedLayout, SerializedLayout, Sheet, WorkspaceState } from '@shared/types'
import type { ClaudeEffort, ClaudeModel, ProjectPrefs } from '@shared/sessions'

export interface RequestRow {
  id: string
  change_id: string
  notes_json: string
  base_hash: string | null
  created_at: string
}

export interface ChangeRow {
  id: string
  session_id: string
  session_title: string
  cwd: string
  file_path: string
  tools_json: string
  before_hash: string | null
  after_hash: string | null
  status: string
  added: number
  removed: number
  created_at: string
  updated_at: string
  decided_at: string | null
}

function toPrefs(row: { cwd: string; model: string; effort: string; add_dirs_json: string; updated_at: string }): ProjectPrefs {
  let addDirs: string[] = []
  try {
    addDirs = JSON.parse(row.add_dirs_json) as string[]
  } catch {
    // valore corrotto: si riparte senza cartelle aggiuntive
  }
  return {
    cwd: row.cwd,
    model: row.model as ClaudeModel,
    effort: row.effort as ClaudeEffort,
    addDirs,
    updatedAt: row.updated_at
  }
}

/**
 * Database SQLite dell'app, con il modulo `node:sqlite` integrato in Electron
 * (niente moduli nativi da compilare). Per ora contiene fogli e layout (L1, L5);
 * nelle fasi successive ospiterà preferenze di progetto (W4), modifiche (F5) e widget (I6).
 */
export class AppDb {
  private db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  private migrate(): void {
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version < 1) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE sheets (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            position    INTEGER NOT NULL,
            layout_json TEXT,
            updated_at  TEXT NOT NULL
          );
          CREATE TABLE named_layouts (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            layout_json TEXT NOT NULL,
            created_at  TEXT NOT NULL
          );
          CREATE TABLE app_state (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
          );
          PRAGMA user_version = 1;
        `)
      })
    }
    if (version < 2) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE project_prefs (
            cwd            TEXT PRIMARY KEY COLLATE NOCASE,
            model          TEXT NOT NULL,
            effort         TEXT NOT NULL,
            add_dirs_json  TEXT NOT NULL,
            updated_at     TEXT NOT NULL
          );
          PRAGMA user_version = 2;
        `)
      })
    }
    if (version < 3) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE changes (
            id             TEXT PRIMARY KEY,
            session_id     TEXT NOT NULL,
            session_title  TEXT NOT NULL,
            cwd            TEXT NOT NULL,
            file_path      TEXT NOT NULL,
            tools_json     TEXT NOT NULL,
            before_hash    TEXT,
            after_hash     TEXT,
            status         TEXT NOT NULL,
            added          INTEGER NOT NULL,
            removed        INTEGER NOT NULL,
            created_at     TEXT NOT NULL,
            updated_at     TEXT NOT NULL,
            decided_at     TEXT
          );
          CREATE INDEX changes_status ON changes (status, updated_at);
          PRAGMA user_version = 3;
        `)
      })
    }
    if (version < 4) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE change_requests (
            id          TEXT PRIMARY KEY,
            change_id   TEXT NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
            notes_json  TEXT NOT NULL,
            base_hash   TEXT,
            created_at  TEXT NOT NULL
          );
          CREATE INDEX change_requests_change ON change_requests (change_id, created_at);
          PRAGMA user_version = 4;
        `)
      })
    }
  }

  // ---- Richieste di modifiche (F8) ----

  insertRequest(r: RequestRow): void {
    this.db
      .prepare('INSERT INTO change_requests (id, change_id, notes_json, base_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(r.id, r.change_id, r.notes_json, r.base_hash, r.created_at)
  }

  requestsFor(changeId: string): RequestRow[] {
    return this.db
      .prepare('SELECT * FROM change_requests WHERE change_id = ? ORDER BY created_at')
      .all(changeId) as unknown as RequestRow[]
  }

  requestCounts(): Map<string, number> {
    const rows = this.db.prepare('SELECT change_id, COUNT(*) AS n FROM change_requests GROUP BY change_id').all() as {
      change_id: string
      n: number
    }[]
    return new Map(rows.map((r) => [r.change_id, Number(r.n)]))
  }

  // ---- Modifiche di Claude (F4–F7) ----

  insertChange(c: ChangeRow): void {
    this.db
      .prepare(
        `INSERT INTO changes (id, session_id, session_title, cwd, file_path, tools_json, before_hash, after_hash, status,
           added, removed, created_at, updated_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        c.id, c.session_id, c.session_title, c.cwd, c.file_path, c.tools_json, c.before_hash, c.after_hash, c.status,
        c.added, c.removed, c.created_at, c.updated_at, c.decided_at
      )
  }

  updateChange(c: ChangeRow): void {
    this.db
      .prepare(
        `UPDATE changes SET session_title = ?, tools_json = ?, after_hash = ?, status = ?, added = ?, removed = ?,
           updated_at = ?, decided_at = ? WHERE id = ?`
      )
      .run(c.session_title, c.tools_json, c.after_hash, c.status, c.added, c.removed, c.updated_at, c.decided_at, c.id)
  }

  getChange(id: string): ChangeRow | null {
    return (this.db.prepare('SELECT * FROM changes WHERE id = ?').get(id) as unknown as ChangeRow | undefined) ?? null
  }

  /** Modifica in attesa per quel file di quella sessione (le modifiche successive si sommano a questa). */
  pendingChangeFor(sessionId: string, filePath: string): ChangeRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM changes WHERE session_id = ? AND file_path = ? COLLATE NOCASE AND status IN ('pending', 'revision')")
        .get(sessionId, filePath) as unknown as ChangeRow | undefined) ?? null
    )
  }

  /** Tutte le modifiche in attesa più le ultime decise. */
  listChanges(decidedLimit = 100): ChangeRow[] {
    const pending = this.db
      .prepare("SELECT * FROM changes WHERE status IN ('pending', 'revision') ORDER BY updated_at DESC")
      .all() as unknown as ChangeRow[]
    const decided = this.db
      .prepare("SELECT * FROM changes WHERE status NOT IN ('pending', 'revision') ORDER BY decided_at DESC LIMIT ?")
      .all(decidedLimit) as unknown as ChangeRow[]
    return [...pending, ...decided]
  }

  /** Hash ancora usati da qualche modifica (per ripulire gli snapshot non più necessari). */
  usedSnapshotHashes(): Set<string> {
    const rows = this.db.prepare('SELECT before_hash, after_hash FROM changes').all() as { before_hash: string | null; after_hash: string | null }[]
    const out = new Set<string>()
    for (const r of rows) {
      if (r.before_hash) out.add(r.before_hash)
      if (r.after_hash) out.add(r.after_hash)
    }
    const reqs = this.db.prepare('SELECT base_hash FROM change_requests WHERE base_hash IS NOT NULL').all() as { base_hash: string }[]
    for (const r of reqs) out.add(r.base_hash)
    return out
  }

  /** Dimentica le modifiche decise più vecchie di N giorni (con le loro richieste). */
  pruneChanges(days: number): void {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString()
    this.db
      .prepare("DELETE FROM change_requests WHERE change_id IN (SELECT id FROM changes WHERE status NOT IN ('pending', 'revision') AND decided_at < ?)")
      .run(cutoff)
    this.db.prepare("DELETE FROM changes WHERE status NOT IN ('pending', 'revision') AND decided_at < ?").run(cutoff)
  }

  /** Ultimi valori usati per un progetto (W4), o null se il progetto è nuovo. */
  getProjectPrefs(cwd: string): ProjectPrefs | null {
    const row = this.db.prepare('SELECT cwd, model, effort, add_dirs_json, updated_at FROM project_prefs WHERE cwd = ?').get(cwd) as
      | { cwd: string; model: string; effort: string; add_dirs_json: string; updated_at: string }
      | undefined
    return row ? toPrefs(row) : null
  }

  /** Progetti usati di recente, per la scelta rapida della cartella. */
  recentProjects(limit = 12): ProjectPrefs[] {
    const rows = this.db
      .prepare('SELECT cwd, model, effort, add_dirs_json, updated_at FROM project_prefs ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as { cwd: string; model: string; effort: string; add_dirs_json: string; updated_at: string }[]
    return rows.map(toPrefs)
  }

  saveProjectPrefs(p: Omit<ProjectPrefs, 'updatedAt'>): void {
    this.db
      .prepare(
        `INSERT INTO project_prefs (cwd, model, effort, add_dirs_json, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(cwd) DO UPDATE SET model = excluded.model, effort = excluded.effort,
           add_dirs_json = excluded.add_dirs_json, updated_at = excluded.updated_at`
      )
      .run(p.cwd, p.model, p.effort, JSON.stringify(p.addDirs), new Date().toISOString())
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN')
    try {
      fn()
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  loadWorkspace(): WorkspaceState {
    const rows = this.db.prepare('SELECT id, name, layout_json FROM sheets ORDER BY position').all() as {
      id: string
      name: string
      layout_json: string | null
    }[]
    const sheets: Sheet[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      layout: r.layout_json ? (JSON.parse(r.layout_json) as SerializedLayout) : null
    }))
    const active = this.db.prepare("SELECT value FROM app_state WHERE key = 'activeSheetId'").get() as
      | { value: string }
      | undefined
    return { sheets, activeSheetId: active?.value ?? null }
  }

  saveSheets(sheets: Pick<Sheet, 'id' | 'name'>[], activeSheetId: string | null): void {
    const now = new Date().toISOString()
    this.transaction(() => {
      const ids = sheets.map((s) => s.id)
      if (ids.length === 0) {
        this.db.prepare('DELETE FROM sheets').run()
      } else {
        this.db.prepare(`DELETE FROM sheets WHERE id NOT IN (${ids.map(() => '?').join(',')})`).run(...ids)
      }
      const upsert = this.db.prepare(`
        INSERT INTO sheets (id, name, position, layout_json, updated_at)
        VALUES (?, ?, ?, NULL, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, position = excluded.position, updated_at = excluded.updated_at
      `)
      sheets.forEach((s, position) => upsert.run(s.id, s.name, position, now))
      if (activeSheetId) {
        this.db
          .prepare(
            "INSERT INTO app_state (key, value) VALUES ('activeSheetId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
          )
          .run(activeSheetId)
      }
    })
  }

  saveSheetLayout(sheetId: string, layout: SerializedLayout | null): void {
    this.db
      .prepare('UPDATE sheets SET layout_json = ?, updated_at = ? WHERE id = ?')
      .run(layout ? JSON.stringify(layout) : null, new Date().toISOString(), sheetId)
  }

  listLayouts(): NamedLayout[] {
    const rows = this.db
      .prepare('SELECT id, name, layout_json, created_at FROM named_layouts ORDER BY name COLLATE NOCASE')
      .all() as { id: string; name: string; layout_json: string; created_at: string }[]
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      layout: JSON.parse(r.layout_json) as SerializedLayout,
      createdAt: r.created_at
    }))
  }

  /** Salva un layout con nome. Se esiste già un layout con lo stesso nome, lo sovrascrive. */
  saveLayout(name: string, layout: SerializedLayout): NamedLayout {
    const existing = this.db.prepare('SELECT id FROM named_layouts WHERE name = ? COLLATE NOCASE').get(name) as
      | { id: string }
      | undefined
    const item: NamedLayout = {
      id: existing?.id ?? randomUUID(),
      name,
      layout,
      createdAt: new Date().toISOString()
    }
    this.db
      .prepare(
        `INSERT INTO named_layouts (id, name, layout_json, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, layout_json = excluded.layout_json, created_at = excluded.created_at`
      )
      .run(item.id, item.name, JSON.stringify(layout), item.createdAt)
    return item
  }

  /** Impostazioni dell'app (valori JSON nella tabella app_state). */
  getSetting(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM app_state WHERE key = ?').get(`setting:${key}`) as { value: string } | undefined
    if (!row) return undefined
    try {
      return JSON.parse(row.value)
    } catch {
      return undefined
    }
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(`setting:${key}`, JSON.stringify(value))
  }

  removeLayout(id: string): void {
    this.db.prepare('DELETE FROM named_layouts WHERE id = ?').run(id)
  }

  close(): void {
    this.db.close()
  }
}
