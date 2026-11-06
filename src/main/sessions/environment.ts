import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import type { ClaudeCliInfo, ShellId, ShellInfo } from '@shared/sessions'

const run = promisify(execFile)

/** Cerca un eseguibile nel PATH (solo Windows: prova le estensioni di PATHEXT). */
function whichSync(name: string): string | null {
  const exts = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of ['', ...exts]) {
      const file = join(dir, name + ext)
      try {
        if (statSync(file).isFile()) return file
      } catch {
        // non esiste
      }
    }
  }
  return null
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return 0
}

/** La copia di Claude Code inclusa nell'app desktop di Claude: …\Claude-Data\<pkg>\claude-code\<versione>\<hash>\claude.exe */
function findDesktopAppClaude(): string | null {
  const base = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Claude-Data')
  if (!existsSync(base)) return null
  let best: { version: string; path: string } | null = null
  for (const pkg of safeReaddir(base)) {
    const codeDir = join(base, pkg, 'claude-code')
    for (const version of safeReaddir(codeDir)) {
      for (const hash of safeReaddir(join(codeDir, version))) {
        const exe = join(codeDir, version, hash, 'claude.exe')
        if (existsSync(exe) && (!best || compareVersions(version, best.version) > 0)) best = { version, path: exe }
      }
    }
  }
  return best?.path ?? null
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

let claudeCache: ClaudeCliInfo | null = null

/** Trova il CLI di Claude Code: PATH, poi ~/.local/bin (installer ufficiale), poi la copia dell'app desktop. */
export async function findClaudeCli(refresh = false): Promise<ClaudeCliInfo> {
  if (claudeCache && !refresh) return claudeCache
  const candidates: [ClaudeCliInfo['source'], string | null][] = [
    ['path', whichSync('claude')],
    ['local-bin', join(homedir(), '.local', 'bin', 'claude.exe')],
    ['desktop-app', findDesktopAppClaude()]
  ]
  for (const [source, path] of candidates) {
    if (!path || !existsSync(path)) continue
    let version: string | null = null
    try {
      const { stdout } = await run(path, ['--version'], { timeout: 15000, windowsHide: true })
      version = stdout.trim().split(' ')[0] ?? null
    } catch {
      // eseguibile presente ma non avviabile: proviamo il prossimo
      continue
    }
    claudeCache = { path, version, source }
    return claudeCache
  }
  claudeCache = { path: null, version: null, source: null }
  return claudeCache
}

export interface ShellCommand {
  file: string
  args: string[]
}

let shellCache: { info: ShellInfo; command: ShellCommand }[] | null = null

/** Shell disponibili su questo PC (S1): Git Bash, PowerShell 7, Windows PowerShell, Prompt dei comandi, distribuzioni WSL. */
export async function detectShells(): Promise<{ info: ShellInfo; command: ShellCommand }[]> {
  if (shellCache) return shellCache
  const out: { info: ShellInfo; command: ShellCommand }[] = []
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files'

  const gitBash = [join(pf, 'Git', 'bin', 'bash.exe'), join(homedir(), 'AppData', 'Local', 'Programs', 'Git', 'bin', 'bash.exe')].find(
    (p) => existsSync(p)
  )
  if (gitBash) out.push({ info: { id: 'git-bash', label: 'Git Bash' }, command: { file: gitBash, args: ['--login', '-i'] } })

  const pwsh = whichSync('pwsh') ?? [join(pf, 'PowerShell', '7', 'pwsh.exe')].find((p) => existsSync(p))
  if (pwsh) out.push({ info: { id: 'pwsh', label: 'PowerShell 7' }, command: { file: pwsh, args: ['-NoLogo'] } })

  const winPs = whichSync('powershell')
  if (winPs) out.push({ info: { id: 'powershell', label: 'Windows PowerShell' }, command: { file: winPs, args: ['-NoLogo'] } })

  const cmd = process.env.ComSpec ?? whichSync('cmd')
  if (cmd) out.push({ info: { id: 'cmd', label: 'Prompt dei comandi' }, command: { file: cmd, args: [] } })

  const wsl = whichSync('wsl')
  if (wsl) {
    for (const distro of await listWslDistros(wsl)) {
      out.push({ info: { id: `wsl:${distro}`, label: `WSL · ${distro}` }, command: { file: wsl, args: ['-d', distro] } })
    }
  }
  shellCache = out
  return out
}

async function listWslDistros(wsl: string): Promise<string[]> {
  try {
    // wsl.exe scrive in UTF-16LE.
    const { stdout } = await run(wsl, ['--list', '--quiet'], { encoding: 'buffer', timeout: 8000, windowsHide: true })
    return (stdout as unknown as Buffer)
      .toString('utf16le')
      .split(/\r?\n/)
      .map((s) => s.replace(/\0/g, '').trim())
      .filter((s) => s && !/^docker-desktop/i.test(s))
  } catch {
    return []
  }
}

export async function shellCommand(id: ShellId): Promise<ShellCommand | null> {
  return (await detectShells()).find((s) => s.info.id === id)?.command ?? null
}

/** Branch git della cartella (W5). `null` se non è un repository o git non è installato. */
export async function gitBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 4000, windowsHide: true })
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** PATH arricchito per i processi figli: include ~/.local/bin, dove l'installer ufficiale mette `claude`. */
export function childPath(): string {
  const localBin = join(homedir(), '.local', 'bin')
  const current = process.env.PATH ?? ''
  return current.toLowerCase().split(delimiter).includes(localBin.toLowerCase()) ? current : `${current}${delimiter}${localBin}`
}
