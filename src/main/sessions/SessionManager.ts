import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { WebContents } from 'electron'
import * as pty from 'node-pty'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import type { CreateSessionRequest, SessionInfo, SessionSnapshot } from '@shared/sessions'
import { childPath, detectShells, findClaudeCli, gitBranch, shellCommand } from './environment'

const DEFAULT_COLS = 120
const DEFAULT_ROWS = 32
const SCROLLBACK = 5000
const FLUSH_MS = 6
/** Dopo quanto tempo senza output una sessione passa da «al lavoro» a «inattiva». */
const IDLE_AFTER_MS = 1500
/** L'output che arriva subito dopo un tasto è l'eco di ciò che si scrive, non lavoro. */
const ECHO_WINDOW_MS = 250
const BRANCH_POLL_MS = 5000

type Listener = (sessions: SessionInfo[]) => void

/**
 * Una sessione: il processo (PTY) vive qui, nel processo principale. I pannelli sono solo viste:
 * si possono spostare, staccare o chiudere senza interrompere il processo (requisiti §3).
 */
class Session {
  readonly info: SessionInfo
  private readonly proc: pty.IPty
  private readonly screen: HeadlessTerminal
  private readonly serializer = new SerializeAddon()
  private seq = 0
  private pending = ''
  private flushTimer: NodeJS.Timeout | null = null
  private readonly views = new Map<string, WebContents>()
  private readonly viewSizes = new Map<string, { cols: number; rows: number }>()
  /** La vista che comanda la dimensione del PTY: quella con il focus o che ha scritto per ultima. */
  private owner: string | null = null
  private lastOutputAt = 0
  private lastInputAt = 0
  private statusTimer: NodeJS.Timeout
  private branchTimer: NodeJS.Timeout | null = null

  constructor(
    info: Omit<SessionInfo, 'status' | 'views' | 'cols' | 'rows' | 'startedAt'>,
    file: string,
    args: string[],
    private readonly changed: () => void,
    private readonly ended: (id: string) => void
  ) {
    this.info = { ...info, status: 'idle', views: 0, cols: DEFAULT_COLS, rows: DEFAULT_ROWS, startedAt: new Date().toISOString() }
    this.screen = new HeadlessTerminal({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS, scrollback: SCROLLBACK, allowProposedApi: true })
    this.screen.loadAddon(this.serializer)

    this.proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: info.cwd,
      env: childEnv(),
      useConpty: true
    })
    this.proc.onData((data) => this.onOutput(data))
    this.proc.onExit(({ exitCode }) => this.onExit(exitCode))

    this.statusTimer = setInterval(() => {
      if (this.info.status === 'working' && Date.now() - this.lastOutputAt > IDLE_AFTER_MS) this.setStatus('idle')
    }, 400)

    void this.refreshBranch()
    this.branchTimer = setInterval(() => void this.refreshBranch(), BRANCH_POLL_MS)
  }

  private onOutput(data: string): void {
    const now = Date.now()
    this.lastOutputAt = now
    if (now - this.lastInputAt > ECHO_WINDOW_MS && this.info.status === 'idle') this.setStatus('working')
    this.pending += data
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS)
  }

  /** Raggruppa l'output in blocchi numerati: ogni blocco va allo schermo headless e alle finestre con viste. */
  private flush(): void {
    this.flushTimer = null
    if (!this.pending) return
    const chunk = this.pending
    this.pending = ''
    const seq = ++this.seq
    this.screen.write(chunk)
    for (const wc of this.targets()) wc.send('session:data', this.info.id, seq, chunk)
  }

  private targets(): Set<WebContents> {
    const set = new Set<WebContents>()
    for (const wc of this.views.values()) if (!wc.isDestroyed()) set.add(wc)
    return set
  }

  private onExit(exitCode: number): void {
    this.flush()
    this.info.exitCode = exitCode
    this.setStatus('exited')
    for (const wc of this.targets()) wc.send('session:exit', this.info.id, exitCode)
    this.dispose()
    if (this.views.size === 0) this.ended(this.info.id)
  }

  private setStatus(status: SessionInfo['status']): void {
    if (this.info.status === status || this.info.status === 'exited') return
    this.info.status = status
    this.changed()
  }

  private async refreshBranch(): Promise<void> {
    const branch = await gitBranch(this.info.cwd)
    if (branch !== this.info.gitBranch) {
      this.info.gitBranch = branch
      this.changed()
    }
  }

  /**
   * Collega una vista. L'istantanea comprende tutti i blocchi fino a `seq`: la vista scrive
   * l'istantanea e poi applica solo i blocchi con numero maggiore, così non perde né duplica output.
   */
  attach(viewId: string, wc: WebContents): Promise<SessionSnapshot> {
    this.views.set(viewId, wc)
    this.owner ??= viewId
    this.info.views = this.views.size
    this.changed()
    const seq = this.seq
    return new Promise((resolve) => {
      this.screen.write('', () => resolve({ info: { ...this.info }, data: this.serializer.serialize({ scrollback: SCROLLBACK }), seq }))
    })
  }

  detach(viewId: string): void {
    this.views.delete(viewId)
    this.viewSizes.delete(viewId)
    if (this.owner === viewId) {
      this.owner = this.views.keys().next().value ?? null
      if (this.owner) this.applySize(this.owner)
    }
    this.info.views = this.views.size
    this.changed()
    if (this.views.size === 0 && this.info.status === 'exited') this.ended(this.info.id)
  }

  input(viewId: string, data: string): void {
    if (this.info.status === 'exited') return
    this.lastInputAt = Date.now()
    if (this.owner !== viewId) {
      this.owner = viewId
      this.applySize(viewId)
    }
    this.proc.write(data)
  }

  /** Una vista comunica la sua dimensione. Se `claim` (ha il focus) diventa la vista che comanda. */
  resize(viewId: string, cols: number, rows: number, claim: boolean): void {
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return
    this.viewSizes.set(viewId, { cols: Math.max(20, Math.floor(cols)), rows: Math.max(5, Math.floor(rows)) })
    if (claim || this.owner === null) this.owner = viewId
    if (this.owner === viewId) this.applySize(viewId)
  }

  private applySize(viewId: string): void {
    const size = this.viewSizes.get(viewId)
    if (!size || this.info.status === 'exited') return
    if (size.cols === this.info.cols && size.rows === this.info.rows) return
    this.info.cols = size.cols
    this.info.rows = size.rows
    try {
      this.proc.resize(size.cols, size.rows)
    } catch {
      // il processo può essere appena terminato
    }
    this.screen.resize(size.cols, size.rows)
    for (const wc of this.targets()) wc.send('session:resize', this.info.id, size.cols, size.rows)
  }

  kill(): void {
    if (this.info.status === 'exited') return
    try {
      this.proc.kill()
    } catch {
      // già terminato
    }
  }

  /** Scrive direttamente nel processo (per esempio `/model sonnet` per cambiare modello, W3). */
  write(data: string): void {
    if (this.info.status !== 'exited') this.proc.write(data)
  }

  dispose(): void {
    clearInterval(this.statusTimer)
    if (this.branchTimer) clearInterval(this.branchTimer)
    this.branchTimer = null
    if (this.flushTimer) clearTimeout(this.flushTimer)
  }

  hasView(wc: WebContents): boolean {
    for (const v of this.views.values()) if (v === wc) return true
    return false
  }

  dropViewsOf(wc: WebContents): void {
    for (const [viewId, v] of [...this.views]) if (v === wc) this.detach(viewId)
  }
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    // Variabili di Electron e di sviluppo non devono arrivare a Claude Code o alle shell.
    if (/^ELECTRON_|^VITE_|^NODE_OPTIONS$/i.test(k)) continue
    if (/^path$/i.test(k)) continue
    env[k] = v
  }
  env.Path = childPath()
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'claude-code-terminal'
  return env
}

function quote(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>()
  private readonly listeners = new Set<Listener>()
  private notifyQueued = false

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }))
  }

  private notify = (): void => {
    if (this.notifyQueued) return
    this.notifyQueued = true
    setTimeout(() => {
      this.notifyQueued = false
      const list = this.list()
      for (const l of this.listeners) l(list)
    }, 30)
  }

  private remove = (id: string): void => {
    this.sessions.get(id)?.dispose()
    this.sessions.delete(id)
    this.notify()
  }

  async create(req: CreateSessionRequest): Promise<SessionInfo> {
    const id = randomUUID()
    if (req.kind === 'claude') {
      const o = req.claude
      if (!existsSync(o.cwd)) throw new Error(`La cartella non esiste: ${o.cwd}`)
      const cli = await findClaudeCli()
      if (!cli.path) throw new Error('Claude Code non trovato. Installalo oppure aggiungi «claude» al PATH.')
      const claudeSessionId = o.resumeId ?? randomUUID()
      const args: string[] = []
      if (o.resumeId) args.push('--resume', o.resumeId)
      else args.push('--session-id', claudeSessionId)
      if (o.model !== 'default') args.push('--model', o.model)
      if (o.effort !== 'default') args.push('--effort', o.effort)
      for (const dir of o.addDirs) args.push('--add-dir', dir)
      if (o.name && !o.resumeId) args.push('--name', o.name)
      const session = new Session(
        {
          id,
          kind: 'claude',
          title: o.title || o.name || basename(o.cwd) || o.cwd,
          cwd: o.cwd,
          command: ['claude', ...args].map(quote).join(' '),
          claudeSessionId,
          model: o.model,
          effort: o.effort,
          addDirs: o.addDirs
        },
        cli.path,
        args,
        this.notify,
        this.remove
      )
      this.sessions.set(id, session)
    } else {
      if (!existsSync(req.cwd)) throw new Error(`La cartella non esiste: ${req.cwd}`)
      const cmd = await shellCommand(req.shell)
      if (!cmd) throw new Error(`Shell non disponibile: ${req.shell}`)
      const label = (await detectShells()).find((s) => s.info.id === req.shell)?.info.label ?? basename(cmd.file)
      const session = new Session(
        {
          id,
          kind: 'shell',
          title: label,
          cwd: req.cwd,
          command: [cmd.file, ...cmd.args].map(quote).join(' '),
          shell: req.shell
        },
        cmd.file,
        cmd.args,
        this.notify,
        this.remove
      )
      this.sessions.set(id, session)
    }
    this.notify()
    return { ...this.sessions.get(id)!.info }
  }

  attach(id: string, viewId: string, wc: WebContents): Promise<SessionSnapshot> | null {
    return this.sessions.get(id)?.attach(viewId, wc) ?? null
  }

  detach(id: string, viewId: string): void {
    this.sessions.get(id)?.detach(viewId)
  }

  input(id: string, viewId: string, data: string): void {
    this.sessions.get(id)?.input(viewId, data)
  }

  resize(id: string, viewId: string, cols: number, rows: number, claim: boolean): void {
    this.sessions.get(id)?.resize(viewId, cols, rows, claim)
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data)
  }

  /** Cambia modello o effort a sessione aperta (W3) scrivendo il comando slash nel terminale. */
  setModel(id: string, model: SessionInfo['model'], effort: SessionInfo['effort']): void {
    const s = this.sessions.get(id)
    if (!s || s.info.kind !== 'claude') return
    if (model && model !== 'default' && model !== s.info.model) {
      s.write(`/model ${model}\r`)
      s.info.model = model
    }
    if (effort && effort !== 'default' && effort !== s.info.effort) {
      s.write(`/effort ${effort}\r`)
      s.info.effort = effort
    }
    this.notify()
  }

  kill(id: string): void {
    this.sessions.get(id)?.kill()
  }

  /** Una finestra si chiude o si ricarica: le sue viste non esistono più. */
  dropViewsOf(wc: WebContents): void {
    for (const s of this.sessions.values()) if (s.hasView(wc)) s.dropViewsOf(wc)
  }

  killAll(): void {
    for (const s of this.sessions.values()) {
      s.kill()
      s.dispose()
    }
    this.sessions.clear()
  }
}
