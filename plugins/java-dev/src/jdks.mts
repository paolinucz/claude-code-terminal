import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { JavaProgress, JdkInfo } from './types.mts'
import { downloadVerified, extract } from './download.mts'

/** Versioni offerte per il download da Eclipse Temurin (LTS). */
export const TEMURIN_MAJORS = [8, 11, 17, 21, 25]

const key = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

/** Dalla riga «JAVA_VERSION="21.0.5"» del file `release` di un JDK. */
export function parseRelease(text: string): { version: string; vendor: string } | null {
  const get = (k: string) => new RegExp(`^${k}="?([^"\\r\\n]*)"?`, 'm').exec(text)?.[1]
  const version = get('JAVA_VERSION')
  if (!version) return null
  return { version, vendor: get('IMPLEMENTOR') ?? get('JAVA_VENDOR') ?? '' }
}

/** Versione principale: «1.8.0_402» → 8, «21.0.5» → 21. */
export function majorOf(version: string): number {
  const m = /^1\.(\d+)/.exec(version) ?? /^(\d+)/.exec(version)
  return m ? Number(m[1]) : 0
}

function readJdk(dir: string, source: JdkInfo['source']): JdkInfo | null {
  // Serve un JDK (con javac): un JRE non basta per compilare ed eseguire Maven e Gradle.
  if (!existsSync(join(dir, 'bin', 'javac.exe')) || !existsSync(join(dir, 'bin', 'java.exe'))) return null
  let text = ''
  try {
    text = readFileSync(join(dir, 'release'), 'utf8')
  } catch {
    return null
  }
  const r = parseRelease(text)
  if (!r) return null
  return { id: key(dir), major: majorOf(r.version), version: r.version, vendor: r.vendor, path: dir, source }
}

/** Sottocartelle (anche collegamenti e giunzioni: sdkman e IntelliJ ne usano). */
const subdirs = (dir: string): string[] => {
  try {
    return readdirSync(dir)
      .map((name) => join(dir, name))
      .filter((p) => {
        try {
          return statSync(p).isDirectory()
        } catch {
          return false
        }
      })
  } catch {
    return []
  }
}

/**
 * JDK presenti sul PC: JAVA_HOME, il PATH, le cartelle di installazione comuni, quelli scaricati da IntelliJ
 * (~/.jdks) e dai toolchain di Gradle, e quelli che l'app ha scaricato (`managedDir`).
 */
export function detectJdks(managedDir: string): JdkInfo[] {
  const found = new Map<string, JdkInfo>()
  const add = (dir: string | undefined, source: JdkInfo['source']) => {
    if (!dir) return
    const jdk = readJdk(dir, source)
    if (jdk && !found.has(jdk.id)) found.set(jdk.id, jdk)
  }
  for (const d of subdirs(managedDir)) add(d, 'temurin')
  add(process.env.JAVA_HOME, 'env')
  for (const p of (process.env.PATH ?? '').split(delimiter)) {
    if (p && existsSync(join(p, 'java.exe'))) add(join(p, '..'), 'path')
  }
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean) as string[]
  for (const base of pf) {
    for (const vendor of ['Java', 'Eclipse Adoptium', 'Eclipse Foundation', 'Microsoft', 'Zulu', 'BellSoft', 'Amazon Corretto', 'Semeru', 'Temurin']) {
      for (const d of subdirs(join(base, vendor))) add(d, 'system')
    }
  }
  for (const d of subdirs(join(homedir(), '.jdks'))) add(d, 'intellij')
  for (const d of subdirs(join(homedir(), '.gradle', 'jdks'))) add(d, 'system')
  for (const d of subdirs(join(homedir(), '.sdkman', 'candidates', 'java'))) add(d, 'system')
  return [...found.values()].sort((a, b) => b.major - a.major || a.path.localeCompare(b.path))
}

interface AdoptiumAsset {
  version: { semver: string }
  binary: { package: { link: string; size: number; checksum: string; name: string } }
}

/** Scarica e installa Eclipse Temurin (JDK) nella cartella dell'app, verificando il checksum SHA-256 dato da Adoptium. */
export async function downloadTemurin(major: number, managedDir: string, onProgress: (p: JavaProgress) => void): Promise<JdkInfo> {
  if (!TEMURIN_MAJORS.includes(major)) throw new Error(`Versione non offerta: ${major}`)
  onProgress({ step: `Cerco Temurin ${major}`, progress: 0 })
  const url = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?os=windows&architecture=x64&image_type=jdk&vendor=eclipse`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Adoptium non risponde (${res.status}).`)
  const asset = ((await res.json()) as AdoptiumAsset[])[0]
  const pkg = asset?.binary?.package
  if (!pkg?.link || !pkg.checksum) throw new Error(`Adoptium non ha un JDK ${major} per Windows.`)
  if (!pkg.link.startsWith('https://')) throw new Error('Indirizzo di download non HTTPS: rifiutato.')
  const dest = join(managedDir, `temurin-${major}`)
  const tmp = join(managedDir, '.tmp', pkg.name)
  rmSync(join(managedDir, '.tmp'), { recursive: true, force: true })
  await downloadVerified({ url: pkg.link, sha256: pkg.checksum }, tmp, (f) => onProgress({ step: `Scarico Temurin ${major} (${asset.version.semver})`, progress: f * 0.9 }))
  onProgress({ step: `Installo Temurin ${major}`, progress: 0.92 })
  await extract(tmp, 'zip', dest, true)
  rmSync(join(managedDir, '.tmp'), { recursive: true, force: true })
  const jdk = readJdk(dest, 'temurin')
  if (!jdk) throw new Error('Il JDK scaricato non è valido.')
  onProgress({ step: `Temurin ${major} installato`, progress: 1, done: true })
  return jdk
}

/** Cancella un JDK scaricato dall'app (solo quelli nella cartella gestita). */
export function removeManagedJdk(jdk: JdkInfo, managedDir: string): boolean {
  if (jdk.source !== 'temurin' || !key(jdk.path).startsWith(key(managedDir) + '\\')) return false
  rmSync(jdk.path, { recursive: true, force: true })
  return !existsSync(jdk.path)
}

/** Percorso di un eseguibile nel PATH (mvn.cmd, gradle.bat…). */
export function whichOnPath(names: string[]): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const n of names) {
      const f = join(dir, n)
      try {
        if (statSync(f).isFile()) return f
      } catch {
        // non c'è
      }
    }
  }
  return null
}
