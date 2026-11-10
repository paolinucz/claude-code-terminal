/** Plugin Docker: container del sistema, gestiti dal comando `docker` (tipi condivisi tra adapter e pagina). */

/**
 * Stato del motore Docker:
 * - missing: il comando `docker` non si trova;
 * - stopped: c'è, ma il motore non risponde (Docker Desktop spento);
 * - starting: lo sta avviando il plugin;
 * - ready: risponde;
 * - error: risponde in modo inatteso.
 */
export type EngineState = 'missing' | 'stopped' | 'starting' | 'ready' | 'error'

export interface EngineInfo {
  state: EngineState
  message?: string
  /** Percorso del comando docker usato. */
  cli?: string
  /** Versione del motore, quando risponde. */
  version?: string
  /** Si può avviare e fermare dal plugin (Docker Desktop installato). */
  canControl: boolean
}

export interface PortMapping {
  /** Indirizzo sul PC (es. «0.0.0.0»); assente se la porta non è pubblicata. */
  host?: string
  hostPort?: number
  containerPort: number
  proto: string
}

export type ContainerState = 'running' | 'paused' | 'restarting' | 'exited' | 'created' | 'dead' | 'removing'

export interface Container {
  id: string
  /** Primi 12 caratteri dell'id, come li mostra Docker. */
  shortId: string
  name: string
  image: string
  state: ContainerState
  /** Testo di Docker («Up 3 minutes», «Exited (0) 2 hours ago»). */
  status: string
  createdAt: string
  ports: PortMapping[]
  /** Progetto Compose a cui appartiene, se ne ha uno. */
  project?: string
  service?: string
  command: string
}

/** Uso di risorse di un container in esecuzione. */
export interface ContainerStats {
  id: string
  /** Percentuale di CPU (può superare 100 con più core). */
  cpu: number
  memUsage: string
  memLimit: string
  memPercent: number
  net: string
  block: string
  pids: number
}

export type ContainerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill' | 'remove'

export interface ActionResult {
  ok: boolean
  error?: string
}
