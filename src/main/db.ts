import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { NamedLayout, SerializedLayout, Sheet, WorkspaceState } from '@shared/types'

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

  removeLayout(id: string): void {
    this.db.prepare('DELETE FROM named_layouts WHERE id = ?').run(id)
  }

  close(): void {
    this.db.close()
  }
}
