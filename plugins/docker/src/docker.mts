import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import type { Container, ContainerState, ContainerStats, PortMapping } from './types.mts'

/**
 * Il comando `docker`: nel PATH o nelle cartelle di Docker Desktop (che di solito non lo mette nel PATH di un'app avviata
 * prima dell'installazione). Gli argomenti si passano sempre come elenco, mai in una riga di shell.
 */
export function findDocker(): string | null {
  const candidates: string[] = []
  for (const dir of (process.env.PATH ?? '').split(delimiter)) if (dir) candidates.push(join(dir, 'docker.exe'))
  const local = process.env.LOCALAPPDATA
  const pf = process.env.ProgramFiles
  if (local) candidates.push(join(local, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe'))
  if (pf) candidates.push(join(pf, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'))
  return candidates.find((c) => existsSync(c)) ?? null
}

/** Docker Desktop, se è quello il docker trovato: da lì si può avviare e fermare il motore. */
export const hasDesktop = (cli: string): boolean => existsSync(join(dirname(cli), '..', '..', 'Docker Desktop.exe'))

export class DockerError extends Error {
  constructor(
    message: string,
    /** `engine` = il motore non risponde; `other` = qualunque altro errore. */
    readonly kind: 'engine' | 'other'
  ) {
    super(message)
  }
}

const ENGINE_DOWN = /failed to connect to the docker api|cannot connect to the docker daemon|error during connect|npipe|pipe\/docker|is the docker daemon running|dockerDesktopLinuxEngine|docker_engine/i

/** Esegue `docker <args>`. Se il comando fallisce l'errore porta il testo di Docker. */
export function runDocker(cli: string, args: string[], opts: { timeout?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cli,
      args,
      { windowsHide: true, timeout: opts.timeout ?? 30000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, DOCKER_CLI_HINTS: 'false' } },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout, stderr })
        const text = (stderr || '').trim() || err.message
        const killed = (err as NodeJS.ErrnoException & { killed?: boolean }).killed
        // Un comando che non risponde in tempo è, di solito, un motore che sta ancora partendo o è bloccato: conta come «motore».
        reject(new DockerError(killed ? `Docker non ha risposto in tempo (${args[0]}).` : text.split(/\r?\n/).filter(Boolean).slice(-3).join(' '), killed || ENGINE_DOWN.test(text) ? 'engine' : 'other'))
      }
    )
  })
}

/** Un riferimento a un container (nome o id) sicuro da passare al comando. */
export const isContainerRef = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(v)

// ---------------------------------------------------------------- lettura dell'output

const jsonLines = (text: string): Record<string, string>[] =>
  text
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, string>
      } catch {
        return null
      }
    })
    .filter((x): x is Record<string, string> => x !== null)

/** «0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, 5432/tcp» → porte, senza i doppioni IPv4/IPv6. */
export function parsePorts(text: string | undefined): PortMapping[] {
  const out: PortMapping[] = []
  const seen = new Set<string>()
  for (const part of (text ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    // 0.0.0.0:8080->80/tcp · [::]:8080->80/tcp · 0.0.0.0:8000-8010->8000-8010/tcp · 5432/tcp
    const m = /^(?:(\[[^\]]+\]|[^:]+):(\d+)(?:-\d+)?->)?(\d+)(?:-\d+)?\/(\w+)$/.exec(part)
    if (!m) continue
    const p: PortMapping = { host: m[1], hostPort: m[2] ? Number(m[2]) : undefined, containerPort: Number(m[3]), proto: m[4] }
    const k = `${p.hostPort ?? ''}:${p.containerPort}/${p.proto}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
  }
  return out
}

function labelOf(labels: string | undefined, key: string): string | undefined {
  const m = new RegExp(`(?:^|,)${key.replace(/\./g, '\\.')}=([^,]*)`).exec(labels ?? '')
  return m?.[1] || undefined
}

const STATES = new Set<ContainerState>(['running', 'paused', 'restarting', 'exited', 'created', 'dead', 'removing'])

export function parseContainers(text: string): Container[] {
  return jsonLines(text).map((r) => {
    const id = r.ID ?? ''
    const state = (r.State ?? '').toLowerCase() as ContainerState
    return {
      id,
      shortId: id.slice(0, 12),
      name: (r.Names ?? id).split(',')[0],
      image: r.Image ?? '',
      state: STATES.has(state) ? state : 'created',
      status: r.Status ?? '',
      createdAt: r.CreatedAt ?? '',
      ports: parsePorts(r.Ports),
      project: labelOf(r.Labels, 'com.docker.compose.project'),
      service: labelOf(r.Labels, 'com.docker.compose.service'),
      command: (r.Command ?? '').replace(/^"|"$/g, '')
    }
  })
}

const pct = (s: string | undefined) => Number.parseFloat((s ?? '').replace('%', '')) || 0

export function parseStats(text: string): ContainerStats[] {
  return jsonLines(text).map((r) => {
    const [used, limit] = (r.MemUsage ?? '').split('/').map((s) => s.trim())
    return {
      id: r.ID ?? '',
      cpu: pct(r.CPUPerc),
      memUsage: used ?? '',
      memLimit: limit ?? '',
      memPercent: pct(r.MemPerc),
      net: r.NetIO ?? '',
      block: r.BlockIO ?? '',
      pids: Number(r.PIDs) || 0
    }
  })
}
