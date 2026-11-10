import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BuildTool, BuildToolKind, JavaProgress } from './types.mts'
import { downloadVerified, extract } from './download.mts'

/**
 * Maven e Gradle scaricati dall'app, uno per versione: `<dati>/build-tools/<maven|gradle>/<versione>`. Così ogni servizio può
 * usare la sua versione senza toccare il wrapper del progetto (per esempio un Gradle vecchio con un JDK vecchio).
 * Le distribuzioni arrivano dai siti ufficiali (services.gradle.org, Maven Central) e si installano solo se il checksum
 * pubblicato corrisponde.
 */

const SCRIPT: Record<BuildToolKind, string> = { maven: 'mvn.cmd', gradle: 'gradle.bat' }
const LABEL: Record<BuildToolKind, string> = { maven: 'Maven', gradle: 'Gradle' }
/** Come appare una versione ammessa: numeri separati da punti, con un eventuale suffisso (-rc-1, -milestone-1). */
const VERSION_RE = /^\d+(\.\d+){1,2}(-[A-Za-z0-9.]+)?$/

export const isValidVersion = (v: unknown): v is string => typeof v === 'string' && v.length <= 32 && VERSION_RE.test(v)

/** Numeri di una versione, per confrontarle («8.14.3» → [8, 14, 3]). */
export const parseVersion = (v: string): number[] => (/^\d+(\.\d+)*/.exec(v)?.[0] ?? '0').split('.').map(Number)
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return 0
}

const rootOf = (dir: string, kind: BuildToolKind) => join(dir, kind)

// ---------------------------------------------------------------- installati

export function toolScript(tool: BuildTool): string {
  return join(tool.path, 'bin', SCRIPT[tool.kind])
}

/** Maven e Gradle che l'app ha scaricato. */
export function detectTools(dir: string): BuildTool[] {
  const out: BuildTool[] = []
  for (const kind of ['maven', 'gradle'] as const) {
    let names: string[] = []
    try {
      names = readdirSync(rootOf(dir, kind))
    } catch {
      continue
    }
    for (const version of names) {
      const path = join(rootOf(dir, kind), version)
      if (isValidVersion(version) && existsSync(join(path, 'bin', SCRIPT[kind]))) out.push({ kind, version, path })
    }
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || compareVersions(b.version, a.version))
}

export function removeTool(dir: string, kind: BuildToolKind, version: string): boolean {
  if (!isValidVersion(version)) return false
  const path = join(rootOf(dir, kind), version)
  rmSync(path, { recursive: true, force: true })
  return !existsSync(path)
}

// ---------------------------------------------------------------- versioni disponibili

const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(20000) })

/** L'ultima patch di ogni versione «major.minor», dalla più recente: l'elenco resta breve e utile. */
function latestPerMinor(versions: string[], min: string, max = 14): string[] {
  const best = new Map<string, string>()
  for (const v of versions) {
    if (compareVersions(v, min) < 0) continue
    const k = parseVersion(v).slice(0, 2).join('.')
    const cur = best.get(k)
    if (!cur || compareVersions(v, cur) > 0) best.set(k, v)
  }
  return [...best.values()].sort((a, b) => compareVersions(b, a)).slice(0, max)
}

/** Versioni stabili che si possono scaricare. */
export async function availableVersions(kind: BuildToolKind): Promise<string[]> {
  if (kind === 'gradle') {
    const res = await get('https://services.gradle.org/versions/all')
    if (!res.ok) throw new Error(`services.gradle.org non risponde (${res.status}).`)
    const all = (await res.json()) as { version: string; snapshot?: boolean; nightly?: boolean; releaseNightly?: boolean; broken?: boolean; rcFor?: string; milestoneFor?: string }[]
    const stable = all.filter((v) => !v.snapshot && !v.nightly && !v.releaseNightly && !v.broken && !v.rcFor && !v.milestoneFor && /^\d+\.\d+(\.\d+)?$/.test(v.version)).map((v) => v.version)
    return latestPerMinor(stable, '6.0')
  }
  const res = await get('https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/maven-metadata.xml')
  if (!res.ok) throw new Error(`Maven Central non risponde (${res.status}).`)
  const xml = await res.text()
  const versions = [...xml.matchAll(/<version>(\d+\.\d+\.\d+)<\/version>/g)].map((m) => m[1])
  return latestPerMinor(versions, '3.6')
}

// ---------------------------------------------------------------- download

const hexToIntegrity = (hex: string) => `sha512-${Buffer.from(hex, 'hex').toString('base64')}`

/** Il checksum pubblicato accanto al file: SHA-256 (Gradle, a volte Maven) oppure SHA-512 (Maven). */
async function publishedChecksum(url: string, algos: ('sha512' | 'sha256')[]): Promise<{ sha256?: string; integrity?: string }> {
  for (const algo of algos) {
    const res = await get(`${url}.${algo}`).catch(() => null)
    if (!res?.ok) continue
    const hex = ((await res.text()).trim().split(/\s+/)[0] ?? '').toLowerCase()
    if (algo === 'sha256' && /^[0-9a-f]{64}$/.test(hex)) return { sha256: hex }
    if (algo === 'sha512' && /^[0-9a-f]{128}$/.test(hex)) return { integrity: hexToIntegrity(hex) }
  }
  throw new Error('Il sito non pubblica un checksum SHA-256 o SHA-512 per questa versione: non la installo senza poterla verificare.')
}

/** Scarica e installa Maven o Gradle nella cartella dell'app, verificando il checksum pubblicato. */
export async function downloadTool(kind: BuildToolKind, version: string, dir: string, onProgress: (p: JavaProgress) => void): Promise<BuildTool> {
  if (!isValidVersion(version)) throw new Error(`Versione non valida: ${String(version)}`)
  const name = `${LABEL[kind]} ${version}`
  const url =
    kind === 'gradle'
      ? `https://services.gradle.org/distributions/gradle-${version}-bin.zip`
      : `https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/${version}/apache-maven-${version}-bin.zip`
  onProgress({ step: `Cerco ${name}`, progress: 0 })
  const sum = await publishedChecksum(url, kind === 'gradle' ? ['sha256'] : ['sha512', 'sha256'])
  const tmp = join(dir, '.tmp', `${kind}-${version}.zip`)
  rmSync(join(dir, '.tmp'), { recursive: true, force: true })
  await downloadVerified({ url, ...sum }, tmp, (f) => onProgress({ step: `Scarico ${name}`, progress: f * 0.9 }))
  onProgress({ step: `Installo ${name}`, progress: 0.92 })
  const dest = join(rootOf(dir, kind), version)
  await extract(tmp, 'zip', dest, true)
  rmSync(join(dir, '.tmp'), { recursive: true, force: true })
  const tool: BuildTool = { kind, version, path: dest }
  if (!existsSync(toolScript(tool))) {
    rmSync(dest, { recursive: true, force: true })
    throw new Error(`${name} scaricato ma non valido: manca bin\\${SCRIPT[kind]}.`)
  }
  onProgress({ step: `${name} installato`, progress: 1, done: true })
  return tool
}

// ---------------------------------------------------------------- wrapper del progetto

/** Versione dichiarata dal wrapper (mvnw / gradlew) che sta in `dir`, se si legge. */
export function wrapperVersion(kind: BuildToolKind, dir: string): string | undefined {
  const file = kind === 'gradle' ? join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties') : join(dir, '.mvn', 'wrapper', 'maven-wrapper.properties')
  try {
    if (!statSync(file).isFile()) return undefined
    const text = readFileSync(file, 'utf8')
    const url = /^distributionUrl\s*=\s*(.+)$/m.exec(text)?.[1] ?? ''
    const re = kind === 'gradle' ? /gradle-(\d+(?:\.\d+)+(?:-[A-Za-z0-9.]+)?)-(?:bin|all)\.zip/ : /apache-maven-(\d+(?:\.\d+)+)-bin\.zip/
    return re.exec(url)?.[1]
  } catch {
    return undefined
  }
}

/** Cartella che contiene il wrapper a cui punta uno script trovato (mvnw.cmd / gradlew.bat). */
export const wrapperDir = (script: string) => dirname(script)

// ---------------------------------------------------------------- compatibilità con il JDK

/**
 * Prima versione di Gradle che può girare su un certo Java (tabella «Java compatibility» della documentazione di Gradle).
 * Una versione di Gradle va d'accordo con Java da 8 fino al più recente di questa tabella che già supporta.
 */
const GRADLE_MIN_FOR_JAVA: [number, string][] = [
  [9, '4.3'], [10, '4.7'], [11, '5.0'], [12, '5.4'], [13, '6.0'], [14, '6.3'], [15, '6.7'], [16, '7.0'], [17, '7.3'], [18, '7.5'],
  [19, '7.6'], [20, '8.3'], [21, '8.5'], [22, '8.8'], [23, '8.10'], [24, '8.14'], [25, '9.1']
]

export interface JavaRange {
  min: number
  /** Il Java più recente supportato; `null` = nessun limite noto. */
  max: number | null
}

export function javaRangeFor(kind: BuildToolKind, version: string): JavaRange {
  if (kind === 'gradle') {
    // Da Gradle 9 serve almeno Java 17.
    const min = compareVersions(version, '9.0') >= 0 ? 17 : 8
    let max = 8
    for (const [java, from] of GRADLE_MIN_FOR_JAVA) if (compareVersions(version, from) >= 0) max = java
    // L'ultima riga della tabella non ha un limite superiore sicuro: le versioni più nuove possono supportare Java più recenti.
    return { min, max: max >= GRADLE_MIN_FOR_JAVA[GRADLE_MIN_FOR_JAVA.length - 1][0] ? null : max }
  }
  // Maven 3.x gira su Java 8 e successivi; da Maven 4 serve almeno Java 17.
  return { min: compareVersions(version, '4.0') >= 0 ? 17 : 8, max: null }
}

/** Il problema (in italiano, con il rimedio) di usare questa versione dello strumento con questo JDK, o `null` se va bene. */
export function compatIssue(kind: BuildToolKind, version: string, javaMajor: number): string | null {
  const r = javaRangeFor(kind, version)
  const name = `${LABEL[kind]} ${version}`
  if (javaMajor < r.min) return `${name} richiede almeno Java ${r.min}, ma il servizio usa Java ${javaMajor}: scegli un JDK più recente${kind === 'gradle' ? ' oppure una versione più vecchia di Gradle' : ''}.`
  if (r.max !== null && javaMajor > r.max) {
    const need = GRADLE_MIN_FOR_JAVA.find(([j]) => j === javaMajor)?.[1]
    return `${name} supporta al massimo Java ${r.max}, ma il servizio usa Java ${javaMajor}: scegli un JDK più vecchio${need ? ` oppure Gradle ${need} o successivo` : ''}.`
  }
  return null
}
