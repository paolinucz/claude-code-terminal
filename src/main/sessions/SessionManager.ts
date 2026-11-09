import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { WebContents } from 'electron'
import * as pty from 'node-pty'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isSessionRunning } from '@shared/changes'
import type { CreateSessionRequest, SessionAttention, SessionInfo, SessionSnapshot } from '@shared/sessions'
import { childPath, detectShells, findClaudeCli, gitBranch, shellCommand } from './environment'
import type { HookEvent, StatusLinePayload } from './HookServer'

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
    private readonly ended: (id: string) => void,
    extraEnv: Record<string, string> = {}
  ) {
    this.info = { ...info, status: 'idle', views: 0, cols: DEFAULT_COLS, rows: DEFAULT_ROWS, startedAt: new Date().toISOString() }
    this.screen = new HeadlessTerminal({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS, scrollback: SCROLLBACK, allowProposedApi: true })
    this.screen.loadAddon(this.serializer)

    this.proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: info.cwd,
      env: mergeEnv(childEnv(), extraEnv),
      useConpty: true
    })
    this.proc.onData((data) => this.onOutput(data))
    this.proc.onExit(({ exitCode }) => this.onExit(exitCode))

    this.statusTimer = setInterval(() => {
      if (this.info.hooks) return
      if (this.info.status === 'working' && Date.now() - this.lastOutputAt > IDLE_AFTER_MS) this.setStatus('idle')
    }, 400)

    void this.refreshBranch()
    this.branchTimer = setInterval(() => void this.refreshBranch(), BRANCH_POLL_MS)
  }

  private onOutput(data: string): void {
    const now = Date.now()
    this.lastOutputAt = now
    // Senza hook (shell, o Claude prima del primo evento) lo stato si deduce dall'output.
    if (!this.info.hooks && now - this.lastInputAt > ECHO_WINDOW_MS && this.info.status === 'idle') this.setStatus('working')
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

  /** Chiamata quando il processo termina (anche se ci sono ancora viste aperte). */
  onExited?: () => void

  private onExit(exitCode: number): void {
    this.onExited?.()
    this.flush()
    this.info.exitCode = exitCode
    this.setStatus('exited')
    for (const wc of this.targets()) wc.send('session:exit', this.info.id, exitCode)
    this.dispose()
    if (this.views.size === 0) this.ended(this.info.id)
  }

  private lastAttention: { kind: string; at: number } | null = null

  /**
   * Evento di un hook di Claude Code (fase 3): aggiorna lo stato (S6) e, se serve,
   * restituisce una richiesta di attenzione da notificare (S7).
   */
  applyHook(e: HookEvent): SessionAttention | null {
    const first = !this.info.hooks
    this.info.hooks = true
    let attention: SessionAttention['kind'] | null = null
    let message = ''
    switch (e.hook_event_name) {
      case 'SessionStart':
        // Dopo /clear Claude Code apre una nuova conversazione con un nuovo id: serve per «Riprendi».
        if (e.session_id) this.info.claudeSessionId = e.session_id
        this.setStatus('idle')
        break
      case 'UserPromptSubmit':
      case 'PreToolUse':
      case 'PostToolUse':
        this.setStatus('working')
        break
      case 'PermissionRequest':
        this.setStatus('waiting')
        attention = 'permission'
        message = e.tool_name ? `Chiede il permesso per ${e.tool_name}` : 'Chiede un permesso'
        break
      case 'Notification':
        if (e.notification_type === 'permission_prompt') {
          this.setStatus('waiting')
          attention = 'permission'
          message = e.message || 'Chiede un permesso'
        } else if (e.notification_type === 'elicitation_dialog' || e.notification_type === 'agent_needs_input') {
          this.setStatus('waiting')
          attention = 'input'
          message = e.message || 'Aspetta una tua risposta'
        }
        break
      case 'Stop':
        this.setStatus('idle')
        attention = 'finished'
        message = summarize(e.last_assistant_message) || 'Ha finito'
        break
      case 'StopFailure':
        this.setStatus('idle')
        attention = 'error'
        message = typeof e.error === 'string' ? e.error : 'Si è fermata per un errore'
        break
    }
    if (first) this.changed()
    if (!attention) return null
    // PermissionRequest e Notification(permission_prompt) arrivano insieme: una sola notifica.
    const now = Date.now()
    if (this.lastAttention && this.lastAttention.kind === attention && now - this.lastAttention.at < 3000) return null
    this.lastAttention = { kind: attention, at: now }
    return { sessionId: this.info.id, kind: attention, title: this.info.title, message }
  }

  /** Dati della status line di Claude Code (W5): modello, effort, contesto, costo. */
  applyStatusLine(p: StatusLinePayload): void {
    const percent = p.context_window?.used_percentage
    const next = {
      contextPercent: typeof percent === 'number' ? Math.round(percent) : this.info.contextPercent,
      modelLabel: p.model?.display_name ?? this.info.modelLabel,
      effortLevel: p.effort?.level ?? this.info.effortLevel,
      costUsd: typeof p.cost?.total_cost_usd === 'number' ? p.cost.total_cost_usd : this.info.costUsd
    }
    if (p.session_id) this.info.claudeSessionId = p.session_id
    const win = (w?: { used_percentage?: number; resets_at?: number }) =>
      typeof w?.used_percentage === 'number' ? { percent: Math.round(w.used_percentage), ...(typeof w.resets_at === 'number' ? { resetsAt: w.resets_at } : {}) } : undefined
    const fiveHour = win(p.rate_limits?.five_hour)
    const sevenDay = win(p.rate_limits?.seven_day)
    if (fiveHour || sevenDay) {
      const old = this.info.usage
      const same = JSON.stringify([old?.fiveHour, old?.sevenDay]) === JSON.stringify([fiveHour, sevenDay])
      if (!same) {
        this.info.usage = { ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}), at: Date.now() }
        this.changed()
      }
    }
    if (
      next.contextPercent !== this.info.contextPercent ||
      next.modelLabel !== this.info.modelLabel ||
      next.effortLevel !== this.info.effortLevel ||
      next.costUsd !== this.info.costUsd
    ) {
      Object.assign(this.info, next)
      this.changed()
    }
  }

  /** Rimedio manuale: Claude Code non manda nessun evento quando lo si interrompe con Esc, e lo stato resta «lavora». */
  forceIdle(): void {
    if (this.info.status === 'working' || this.info.status === 'waiting') this.setStatus('idle')
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

/** Aggiunge variabili all'ambiente di un processo. Windows non distingue maiuscole e minuscole: «PATH» rimpiazza «Path». */
function mergeEnv(base: Record<string, string>, extra: Record<string, string>): Record<string, string> {
  const out = { ...base }
  for (const [k, v] of Object.entries(extra)) {
    for (const existing of Object.keys(out)) if (existing.toLowerCase() === k.toLowerCase()) delete out[existing]
    out[k] = v
  }
  return out
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

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Prima frase (o primi 140 caratteri) della risposta di Claude, per il testo della notifica. */
function summarize(text: unknown): string {
  if (typeof text !== 'string') return ''
  const clean = text.replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim()
  const sentence = clean.match(/^.{20,140}?[.!?](\s|$)/)?.[0] ?? clean
  return sentence.length > 140 ? sentence.slice(0, 139) + '…' : sentence
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
    this.removeSettingsFile(id)
    this.notify()
  }

  private readonly attentionListeners = new Set<(a: SessionAttention) => void>()

  /**
   * @param hookSettings impostazioni da passare a Claude Code (hook e status line) per una sessione.
   * @param settingsDir cartella dei file temporanei passati con --settings.
   */
  constructor(
    private readonly hookSettings: (appSessionId: string) => Record<string, unknown> = () => ({}),
    private readonly settingsDir: string | null = null,
    /** Strumenti di Claude Code da togliere alle sessioni dell'app (vedi `--disallowedTools`). */
    private readonly blockedTools: () => string[] = () => []
  ) {}

  /**
   * Toglie le cartelle di impostazioni lasciate da copie dell'app che non sono più in esecuzione
   * (per esempio dopo un arresto improvviso). Le cartelle sono «settings-<pid>».
   */
  cleanStaleSettings(): void {
    if (!this.settingsDir) return
    const parent = dirname(this.settingsDir)
    let entries: string[] = []
    try {
      entries = readdirSync(parent)
    } catch {
      return
    }
    for (const name of entries) {
      const pid = Number(/^settings-(\d+)$/.exec(name)?.[1])
      if (!pid || pid === process.pid || isRunning(pid)) continue
      try {
        rmSync(join(parent, name), { recursive: true, force: true })
      } catch {
        // in uso o già rimossa
      }
    }
  }

  onAttention(listener: (a: SessionAttention) => void): () => void {
    this.attentionListeners.add(listener)
    return () => this.attentionListeners.delete(listener)
  }

  /** Evento di un hook di Claude Code per una sessione dell'app. */
  handleHook(id: string, event: HookEvent): void {
    const attention = this.sessions.get(id)?.applyHook(event)
    if (attention) for (const l of this.attentionListeners) l(attention)
  }

  /**
   * La sessione può ricevere un messaggio scritto dall'app? Non se è terminata, e non se sta
   * mostrando una domanda o un permesso: il testo finirebbe come risposta a quella domanda.
   */
  canReceivePrompt(id: string): { ok: true } | { ok: false; error: string } {
    const s = this.sessions.get(id)
    if (!s) return { ok: false, error: 'La sessione non è più attiva: riprendila per chiedere modifiche.' }
    if (s.info.kind !== 'claude') return { ok: false, error: 'La sessione non è di Claude Code.' }
    if (s.info.status === 'exited') return { ok: false, error: 'La sessione è terminata: riprendila per chiedere modifiche.' }
    if (s.info.status === 'waiting') return { ok: false, error: 'Claude sta aspettando una tua risposta nel terminale: rispondi prima lì.' }
    return { ok: true }
  }

  /**
   * Scrive un messaggio nella sessione come se lo digitasse l'utente: incolla (bracketed paste, così
   * gli a capo restano nel testo) e poi Invio. Se Claude sta lavorando, Claude Code lo mette in coda.
   */
  sendPrompt(id: string, text: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    s.write(`\x1b[200~${text.replace(/\r?\n/g, '\r')}\x1b[201~`)
    setTimeout(() => s.write('\r'), 250)
  }

  /** Scrive un tasto nel terminale della sessione (senza cambiare la vista che comanda la dimensione). */
  sendKeys(id: string, data: string): void {
    if (this.isLocked(id)) return
    this.sessions.get(id)?.write(data)
  }

  /** Titolo e cartella di una sessione (per registrare le modifiche ai file). */
  ref(id: string): { title: string; cwd: string } | undefined {
    const s = this.sessions.get(id)
    return s ? { title: s.info.title, cwd: s.info.cwd } : undefined
  }

  handleStatusLine(id: string, payload: StatusLinePayload): void {
    this.sessions.get(id)?.applyStatusLine(payload)
  }

  /** Scrive il file JSON passato con --settings (in un file, per evitare problemi di virgolette sulla riga di comando). */
  private writeSettingsFile(id: string): string | null {
    const settings = this.hookSettings(id)
    if (!this.settingsDir || Object.keys(settings).length === 0) return null
    mkdirSync(this.settingsDir, { recursive: true })
    const file = join(this.settingsDir, `${id}.json`)
    writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8')
    return file
  }

  private removeSettingsFile(id: string): void {
    if (!this.settingsDir) return
    try {
      rmSync(join(this.settingsDir, `${id}.json`), { force: true })
    } catch {
      // file già rimosso
    }
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
      // Fase 3: hook e status line dell'app, solo per questa sessione (non tocca i settings.json dell'utente).
      const settingsFile = this.writeSettingsFile(id)
      if (settingsFile) args.push('--settings', settingsFile)
      const blocked = this.blockedTools()
      // Forma con «=»: il flag accetta più valori e senza «=» inghiotte gli argomenti seguenti.
      if (blocked.length) args.push(`--disallowedTools=${blocked.join(',')}`)
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
      session.onExited = () => this.removeSettingsFile(id)
      this.sessions.set(id, session)
    } else if (req.kind === 'task') {
      if (!existsSync(req.cwd)) throw new Error(`La cartella non esiste: ${req.cwd}`)
      const session = new Session(
        { id, kind: 'task', title: req.title, cwd: req.cwd, command: [req.file, ...req.args].map(quote).join(' ') },
        req.file,
        req.args,
        this.notify,
        this.remove,
        req.env
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
    if (this.isLocked(id)) return
    this.sessions.get(id)?.input(viewId, data)
  }

  /** Revisione obbligatoria: chi sa se la sessione ha modifiche da rivedere (impostato dal processo principale). */
  private lockCheck: (info: SessionInfo) => boolean = () => false

  setLockCheck(fn: (info: SessionInfo) => boolean): void {
    this.lockCheck = fn
  }

  /** Claude sta eseguendo (lavora o aspetta un permesso)? Finché è così non si può revisionare. */
  isRunning(id: string): boolean {
    const s = this.sessions.get(id)
    return Boolean(s) && isSessionRunning(s!.info.status)
  }

  /** L'input della sessione è bloccato dalla revisione obbligatoria? */
  isLocked(id: string): boolean {
    const s = this.sessions.get(id)
    return Boolean(s) && this.lockCheck(s!.info)
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

  /** L'utente dice che Claude è fermo: lo stato torna «fermo» (sblocca la revisione). */
  markIdle(id: string): void {
    this.sessions.get(id)?.forceIdle()
  }

  kill(id: string): void {
    this.sessions.get(id)?.kill()
  }

  /** Una finestra si chiude o si ricarica: le sue viste non esistono più. */
  dropViewsOf(wc: WebContents): void {
    for (const s of this.sessions.values()) if (s.hasView(wc)) s.dropViewsOf(wc)
  }

  killAll(): void {
    for (const [id, s] of this.sessions) {
      s.kill()
      s.dispose()
      this.removeSettingsFile(id)
    }
    this.sessions.clear()
  }
}
