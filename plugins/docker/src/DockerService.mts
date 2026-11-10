import { spawn, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import { DockerError, findDocker, hasDesktop, isContainerRef, parseContainers, parseStats, runDocker } from './docker.mts'
import type { ActionResult, Container, ContainerAction, ContainerStats, EngineInfo } from './types.mts'

/** Richiesta di una sessione «task» (un comando in un terminale dell'app, senza shell). */
export interface TaskRequest {
  kind: 'task'
  title: string
  cwd: string
  file: string
  args: string[]
  env: Record<string, string>
}

export interface DockerDeps {
  createTask(req: TaskRequest): Promise<{ id: string }>
  showTerminal(sessionId: string): void
  showHive(key: string, title: string, sessionIds: string[]): void
  /** Il motore è cambiato (acceso, spento, in avvio). */
  emitEngine(info: EngineInfo): void
  /** Qualcosa è cambiato tra i container: la pagina rilegge l'elenco. */
  emitChanged(): void
  log(level: 'info' | 'warn' | 'error', message: string): void
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ACTIONS: Record<Exclude<ContainerAction, 'remove'>, string[]> = {
  start: ['start'],
  stop: ['stop', '-t', '10'],
  restart: ['restart', '-t', '10'],
  pause: ['pause'],
  unpause: ['unpause'],
  kill: ['kill']
}
/** Quanto si aspetta che il motore risponda dopo l'avvio di Docker Desktop. */
const START_TIMEOUT_MS = 4 * 60 * 1000

/**
 * Container Docker del sistema, gestiti con il comando `docker` (Docker Desktop può restare chiuso: il plugin ne accende il
 * motore da solo, quando glielo chiedi). Log e shell si aprono in terminali dell'app; più log insieme vanno nell'alveare.
 */
export class DockerService {
  private cli: string | null = null
  private starting: Promise<EngineInfo> | null = null
  private startedAt = 0
  private watcher: ChildProcess | null = null
  private watchTimer: NodeJS.Timeout | null = null
  private changeTimer: NodeJS.Timeout | null = null
  private shuttingDown = false
  private names = new Map<string, string>()

  constructor(private readonly d: DockerDeps) {}

  private findCli(): string | null {
    if (!this.cli) this.cli = findDocker()
    return this.cli
  }

  // ---------------------------------------------------------------- motore

  /** Come sta il motore, senza avviare niente. */
  private async probe(): Promise<EngineInfo> {
    const cli = this.findCli()
    if (!cli) return { state: 'missing', message: 'Il comando docker non si trova. Installa Docker Desktop (o aggiungi docker al PATH).', canControl: false }
    const canControl = hasDesktop(cli)
    try {
      const r = await runDocker(cli, ['version', '--format', '{{.Server.Version}}'], { timeout: 10000 })
      const version = r.stdout.trim()
      if (!version) throw new DockerError('Il motore non ha dato la versione.', 'engine')
      return { state: 'ready', version, cli, canControl }
    } catch (e) {
      const err = e as DockerError
      if (err.kind === 'engine') return { state: 'stopped', message: 'Il motore di Docker non è acceso.', cli, canControl }
      return { state: 'error', message: err.message, cli, canControl }
    }
  }

  async engine(): Promise<EngineInfo> {
    if (this.starting) return { state: 'starting', message: this.startMessage(), cli: this.cli ?? undefined, canControl: true }
    const info = await this.probe()
    if (info.state === 'ready') this.startWatcher()
    return info
  }

  private startMessage(): string {
    const s = Math.round((Date.now() - this.startedAt) / 1000)
    return `Avvio di Docker Desktop in corso… ${s} s (può volerci un minuto)`
  }

  /**
   * Accende il motore con `docker desktop start`, senza aprire la finestra di Docker Desktop che si vede, e aspetta che
   * risponda. Chiamarla mentre sta già partendo restituisce la stessa attesa.
   */
  startEngine(): Promise<EngineInfo> {
    if (this.starting) return this.starting
    this.starting = (async () => {
      const cli = this.findCli()
      if (!cli) return this.probe()
      if (!hasDesktop(cli)) return { state: 'error', message: 'Non è Docker Desktop: avvia il servizio Docker a mano.', cli, canControl: false } satisfies EngineInfo
      this.startedAt = Date.now()
      this.d.emitEngine({ state: 'starting', message: this.startMessage(), cli, canControl: true })
      try {
        await runDocker(cli, ['desktop', 'start', '--detach'], { timeout: 90000 })
      } catch (e) {
        return { state: 'error', message: `Docker Desktop non è partito: ${(e as Error).message}`, cli, canControl: true } satisfies EngineInfo
      }
      while (Date.now() - this.startedAt < START_TIMEOUT_MS) {
        // Finché non risponde si aspetta, qualunque cosa dica nel frattempo: durante l'avvio gli errori sono transitori.
        const info = await this.probe()
        if (info.state === 'ready') return info
        this.d.emitEngine({ state: 'starting', message: this.startMessage(), cli, canControl: true })
        await sleep(2000)
      }
      return { state: 'error', message: 'Il motore non ha risposto entro 4 minuti. Apri Docker Desktop per vedere cosa non va.', cli, canControl: true } satisfies EngineInfo
    })()
      .then((info) => {
        this.starting = null
        if (info.state === 'ready') this.startWatcher()
        this.d.emitEngine(info)
        return info
      })
      .catch((e: Error) => {
        this.starting = null
        const info: EngineInfo = { state: 'error', message: e.message, canControl: true }
        this.d.emitEngine(info)
        return info
      })
    return this.starting
  }

  /** Ferma Docker Desktop (e quindi il motore): libera memoria e CPU. */
  async stopEngine(): Promise<EngineInfo> {
    const cli = this.findCli()
    if (!cli || !hasDesktop(cli)) return this.probe()
    this.stopWatcher()
    try {
      await runDocker(cli, ['desktop', 'stop'], { timeout: 180000 })
    } catch (e) {
      return { state: 'error', message: `Non sono riuscito a fermare Docker Desktop: ${(e as Error).message}`, cli, canControl: true }
    }
    const info = await this.probe()
    this.d.emitEngine(info)
    return info
  }

  // ---------------------------------------------------------------- container

  private need(): string {
    const cli = this.findCli()
    if (!cli) throw new Error('Il comando docker non si trova.')
    return cli
  }

  async list(): Promise<Container[]> {
    const cli = this.need()
    const r = await runDocker(cli, ['ps', '-a', '--no-trunc', '--format', '{{json .}}'], { timeout: 20000 })
    const list = parseContainers(r.stdout).sort((a, b) => (a.project ?? '').localeCompare(b.project ?? '') || a.name.localeCompare(b.name))
    this.names = new Map(list.flatMap((c) => [[c.id, c.name], [c.name, c.name], [c.shortId, c.name]] as [string, string][]))
    this.startWatcher()
    return list
  }

  /** CPU e memoria dei container indicati (solo quelli in esecuzione hanno dati). */
  async stats(ids: string[]): Promise<ContainerStats[]> {
    const refs = ids.filter(isContainerRef).slice(0, 64)
    if (!refs.length) return []
    const r = await runDocker(this.need(), ['stats', '--no-stream', '--format', '{{json .}}', ...refs], { timeout: 25000 })
    return parseStats(r.stdout)
  }

  /** Avvia, ferma, riavvia… uno o più container con un solo comando. */
  async act(action: ContainerAction, refs: string[], opts: { volumes?: boolean } = {}): Promise<ActionResult> {
    const list = (Array.isArray(refs) ? refs : []).slice(0, 64)
    if (!list.length || !list.every(isContainerRef)) return { ok: false, error: 'Container non valido.' }
    const args = action === 'remove' ? ['rm', '-f', ...(opts.volumes ? ['-v'] : [])] : ACTIONS[action as Exclude<ContainerAction, 'remove'>]
    if (!args) return { ok: false, error: `Azione sconosciuta: ${String(action)}` }
    try {
      await runDocker(this.need(), [...args, ...list], { timeout: action === 'stop' || action === 'restart' ? 120000 : 45000 })
      this.d.emitChanged()
      return { ok: true }
    } catch (e) {
      this.d.emitChanged()
      return { ok: false, error: (e as Error).message }
    }
  }

  // ---------------------------------------------------------------- terminali

  private nameOf(ref: string): string {
    return this.names.get(ref) ?? ref
  }

  /**
   * Log in tempo reale in un terminale dell'app (`docker logs -f`). Con più container si apre un solo alveare con un
   * terminale per ciascuno.
   */
  async logs(refs: string[], workspace: string): Promise<ActionResult & { sessionIds?: string[] }> {
    const list = (Array.isArray(refs) ? refs : []).slice(0, 24)
    if (!list.length || !list.every(isContainerRef)) return { ok: false, error: 'Container non valido.' }
    try {
      const cli = this.need()
      const ids: string[] = []
      for (const ref of list) {
        const s = await this.d.createTask({ kind: 'task', title: `Log · ${this.nameOf(ref)}`, cwd: workspace || homedir(), file: cli, args: ['logs', '-f', '--tail', '300', ref], env: {} })
        ids.push(s.id)
        if (list.length === 1) this.d.showTerminal(s.id)
      }
      if (list.length > 1) this.d.showHive('logs', 'Log dei container', ids)
      return { ok: true, sessionIds: ids }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /** Shell dentro il container (bash se c'è, altrimenti sh) in un terminale dell'app. */
  async shell(ref: string, workspace: string): Promise<ActionResult & { sessionId?: string }> {
    if (!isContainerRef(ref)) return { ok: false, error: 'Container non valido.' }
    try {
      const cli = this.need()
      const s = await this.d.createTask({
        kind: 'task',
        title: `Shell · ${this.nameOf(ref)}`,
        cwd: workspace || homedir(),
        file: cli,
        args: ['exec', '-it', ref, 'sh', '-c', 'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'],
        env: {}
      })
      this.d.showTerminal(s.id)
      return { ok: true, sessionId: s.id }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  // ---------------------------------------------------------------- eventi del motore

  /** `docker events`: un flusso che avvisa la pagina di ogni cambiamento, così l'elenco resta aggiornato senza interrogare di continuo. */
  private startWatcher(): void {
    if (this.watcher || this.shuttingDown || this.starting) return
    const cli = this.findCli()
    if (!cli) return
    const p = spawn(cli, ['events', '--filter', 'type=container', '--format', '{{json .}}'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    this.watcher = p
    p.stdout.on('data', () => {
      clearTimeout(this.changeTimer ?? undefined)
      this.changeTimer = setTimeout(() => this.d.emitChanged(), 250)
    })
    const lost = () => {
      if (this.watcher !== p) return
      this.watcher = null
      // Il motore si è fermato o ha chiuso il flusso: si riprova solo se risponde ancora.
      if (!this.shuttingDown) this.watchTimer = setTimeout(() => void this.probe().then((i) => i.state === 'ready' && this.startWatcher()), 5000)
      this.d.emitChanged()
    }
    p.on('exit', lost)
    p.on('error', lost)
  }

  private stopWatcher(): void {
    clearTimeout(this.watchTimer ?? undefined)
    const w = this.watcher
    this.watcher = null
    w?.kill()
  }

  shutdown(): void {
    this.shuttingDown = true
    clearTimeout(this.changeTimer ?? undefined)
    this.stopWatcher()
  }
}
