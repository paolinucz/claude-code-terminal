import type { AppApi, NamedLayout, Sheet, WorkspaceState } from '@shared/types'
import type { SessionInfo } from '@shared/sessions'

/**
 * In Electron usa `window.api` (SQLite nel processo principale).
 * Nel browser (npm run web) usa localStorage, così l'interfaccia si può provare anche senza Electron.
 */
function createLocalStorageApi(): AppApi {
  const KEY = 'cct.workspace.v1'
  const LAYOUTS = 'cct.layouts.v1'
  const read = <T>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  }
  const write = (key: string, value: unknown): void => localStorage.setItem(key, JSON.stringify(value))

  return {
    backend: 'localStorage',
    workspace: {
      async load() {
        return read<WorkspaceState>(KEY, { sheets: [], activeSheetId: null })
      },
      async saveSheets(sheets, activeSheetId) {
        const current = read<WorkspaceState>(KEY, { sheets: [], activeSheetId: null })
        const byId = new Map(current.sheets.map((s) => [s.id, s]))
        const next: Sheet[] = sheets.map((s) => ({ id: s.id, name: s.name, layout: byId.get(s.id)?.layout ?? null }))
        write(KEY, { sheets: next, activeSheetId })
      },
      async saveSheetLayout(sheetId, layout) {
        const current = read<WorkspaceState>(KEY, { sheets: [], activeSheetId: null })
        write(KEY, { ...current, sheets: current.sheets.map((s) => (s.id === sheetId ? { ...s, layout } : s)) })
      }
    },
    layouts: {
      async list() {
        return read<NamedLayout[]>(LAYOUTS, []).sort((a, b) => a.name.localeCompare(b.name))
      },
      async save(name, layout) {
        const all = read<NamedLayout[]>(LAYOUTS, [])
        const existing = all.find((l) => l.name.toLowerCase() === name.toLowerCase())
        const item: NamedLayout = { id: existing?.id ?? crypto.randomUUID(), name, layout, createdAt: new Date().toISOString() }
        write(LAYOUTS, [...all.filter((l) => l.id !== item.id), item])
        return item
      },
      async remove(id) {
        write(LAYOUTS, read<NamedLayout[]>(LAYOUTS, []).filter((l) => l.id !== id))
      }
    },
    settings: {
      async get(key) {
        return read<unknown>(`cct.setting.${key}`, undefined)
      },
      async set(key, value) {
        write(`cct.setting.${key}`, value)
      }
    },
    ...createDemoSessions()
  }
}

/**
 * Sessioni finte per il browser: ogni sessione rimanda indietro ciò che si scrive.
 * Servono solo a provare l'interfaccia dei terminali senza Electron.
 */
function createDemoSessions(): Pick<AppApi, 'sessions' | 'env'> {
  const sessions = new Map<string, { info: SessionInfo; screen: string; seq: number; views: Set<string> }>()
  const changed = new Set<(s: SessionInfo[]) => void>()
  const data = new Set<(id: string, seq: number, d: string) => void>()
  const resized = new Set<(id: string, c: number, r: number) => void>()
  const exited = new Set<(id: string, code: number) => void>()
  const list = () => [...sessions.values()].map((s) => ({ ...s.info, views: s.views.size }))
  const notify = () => setTimeout(() => changed.forEach((cb) => cb(list())), 0)
  const prompt = (s: SessionInfo) => (s.kind === 'claude' ? '\r\n\x1b[38;2;232;135;95m>\x1b[0m ' : `\r\n\x1b[32m${s.cwd}\x1b[0m $ `)
  const emit = (id: string, chunk: string) => {
    const s = sessions.get(id)
    if (!s) return
    s.seq++
    s.screen += chunk
    data.forEach((cb) => cb(id, s.seq, chunk))
  }
  let idleTimer: number | undefined

  return {
    sessions: {
      async list() {
        return list()
      },
      async create(req) {
        const id = crypto.randomUUID()
        const cwd = req.kind === 'claude' ? req.claude.cwd : req.cwd
        const info: SessionInfo = {
          id,
          kind: req.kind,
          title: req.kind === 'claude' ? req.claude.title || req.claude.name || cwd.split(/[\\/]/).pop() || cwd : req.shell === 'git-bash' ? 'Git Bash' : 'PowerShell',
          cwd,
          status: 'idle',
          startedAt: new Date().toISOString(),
          command: req.kind === 'claude' ? `claude --model ${req.claude.model}` : req.shell,
          shell: req.kind === 'shell' ? req.shell : undefined,
          claudeSessionId: req.kind === 'claude' ? (req.claude.resumeId ?? crypto.randomUUID()) : undefined,
          model: req.kind === 'claude' ? req.claude.model : undefined,
          effort: req.kind === 'claude' ? req.claude.effort : undefined,
          addDirs: req.kind === 'claude' ? req.claude.addDirs : undefined,
          gitBranch: 'main',
          views: 0,
          cols: 100,
          rows: 30
        }
        const banner =
          req.kind === 'claude'
            ? `\x1b[1mClaude Code\x1b[0m \x1b[2m(demo nel browser: rimanda indietro ciò che scrivi)\x1b[0m\r\n${info.command}`
            : `\x1b[2mShell di prova nel browser\x1b[0m`
        sessions.set(id, { info, screen: banner + prompt(info), seq: 0, views: new Set() })
        notify()
        return { ...info }
      },
      async attach(id, viewId) {
        const s = sessions.get(id)
        if (!s) return null
        s.views.add(viewId)
        notify()
        return { info: { ...s.info, views: s.views.size }, data: s.screen, seq: s.seq }
      },
      detach(id, viewId) {
        sessions.get(id)?.views.delete(viewId)
        notify()
      },
      input(id, _viewId, d) {
        const s = sessions.get(id)
        if (!s || s.info.status === 'exited') return
        if (d === '\r') {
          s.info.status = 'working'
          notify()
          emit(id, '\r\n\x1b[2m(eco)\x1b[0m' + prompt(s.info))
          window.clearTimeout(idleTimer)
          idleTimer = window.setTimeout(() => {
            s.info.status = 'idle'
            notify()
          }, 1200)
        } else if (d === '\x7f') emit(id, '\b \b')
        else emit(id, d)
      },
      resize(id, _viewId, cols, rows, claim) {
        const s = sessions.get(id)
        if (!s || !claim) return
        s.info.cols = cols
        s.info.rows = rows
        resized.forEach((cb) => cb(id, cols, rows))
      },
      async setModel(id, model, effort) {
        const s = sessions.get(id)
        if (!s) return
        s.info.model = model
        s.info.effort = effort
        emit(id, `/model ${model}\r\n/effort ${effort}` + prompt(s.info))
        notify()
      },
      async kill(id) {
        const s = sessions.get(id)
        if (!s) return
        s.info.status = 'exited'
        s.info.exitCode = 0
        exited.forEach((cb) => cb(id, 0))
        if (s.views.size === 0) sessions.delete(id)
        notify()
      },
      onChanged: (cb) => (changed.add(cb), () => changed.delete(cb)),
      onData: (cb) => (data.add(cb), () => data.delete(cb)),
      onResize: (cb) => (resized.add(cb), () => resized.delete(cb)),
      onExit: (cb) => (exited.add(cb), () => exited.delete(cb))
    },
    env: {
      async claudeCli() {
        return { path: '(demo)', version: 'demo', source: 'path' }
      },
      async shells() {
        return [
          { id: 'git-bash', label: 'Git Bash' },
          { id: 'powershell', label: 'Windows PowerShell' }
        ]
      },
      async resumable(cwd) {
        const now = Date.now()
        return [
          { id: 'demo-1', title: 'Refactor middleware auth', cwd, updatedAt: new Date(now - 86400000).toISOString(), gitBranch: 'main' },
          { id: 'demo-2', title: 'Migrazione schema utenti', cwd, updatedAt: new Date(now - 3 * 86400000).toISOString() }
        ]
      },
      async projectPrefs() {
        return null
      },
      async recentProjects() {
        return []
      },
      async saveProjectPrefs() {},
      async pickFolder() {
        return window.prompt('Cartella (demo nel browser)', 'C:\\progetti\\api-server')
      },
      async homeDir() {
        return 'C:\\Users\\demo'
      }
    }
  }
}

export const api: AppApi = window.api ?? createLocalStorageApi()
