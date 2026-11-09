import type { JavaBuild, JavaFramework, JavaService } from '@shared/java'
import { child, descendants, parseXml } from '@shared/xml'

/** Accesso al disco, separato per poter provare il rilevamento senza file veri. */
export interface Disk {
  /** Voci di una cartella (nome e se è cartella); [] se non esiste. */
  list(dir: string): { name: string; dir: boolean }[]
  /** Contenuto di un file di testo, null se non esiste. */
  read(path: string): string | null
}

const SKIP = new Set(['node_modules', '.git', 'target', 'build', 'out', 'dist', '.gradle', '.idea', '.vscode', '.mvn', '.settings', 'bin', '.next', '.angular', '__pycache__'])
const MAX_DIRS = 600
const MAX_DEPTH = 6

const sep = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '')
const join = (a: string, b: string) => `${sep(a)}\\${b}`
const dirname = (p: string) => sep(p).replace(/\\[^\\]*$/, '')
const key = (p: string) => sep(p).toLowerCase()

/** Elementi figli di <project>, senza scendere in <parent>, <dependencies>, <build>… */
function topValue(project: ReturnType<typeof parseXml>, tag: string): string | undefined {
  const t = child(project, tag)?.text.trim()
  return t || undefined
}

function mavenJavaVersion(project: ReturnType<typeof parseXml>): string | undefined {
  const props = child(project, 'properties')
  for (const k of ['maven.compiler.release', 'maven.compiler.target', 'maven.compiler.source', 'java.version', 'release.version']) {
    const v = child(props, k)?.text.trim()
    if (v && /^\d/.test(v)) return v.replace(/^1\./, '')
  }
  return undefined
}

function frameworkOf(text: string, kind: JavaBuild): JavaFramework {
  if (kind === 'maven') {
    if (/quarkus-maven-plugin|io\.quarkus|quarkus\.platform/.test(text)) return 'quarkus'
    if (/spring-boot-starter|spring-boot-maven-plugin|spring-boot-dependencies/.test(text)) return 'spring-boot'
  } else {
    if (/io\.quarkus|id\s*\(?\s*["']quarkus["']|quarkusPlatform/.test(text)) return 'quarkus'
    if (/org\.springframework\.boot|spring-boot-starter/.test(text)) return 'spring-boot'
  }
  return 'plain'
}

function gradleJavaVersion(text: string): string | undefined {
  const m =
    /JavaLanguageVersion\.of\(\s*(\d+)\s*\)/.exec(text) ??
    /(?:sourceCompatibility|targetCompatibility)\s*=\s*(?:JavaVersion\.VERSION_)?['"]?(\d+(?:[._]\d+)?)/.exec(text) ??
    /jvmTarget\s*=\s*['"](\d+)['"]/.exec(text)
  return m?.[1].replace('_', '.').replace(/^1\./, '')
}

/**
 * Trova i servizi Java sotto una cartella: ogni cartella con un pom.xml o un build.gradle(.kts) è un servizio
 * (più servizi possono stare nella stessa cartella di lavoro). Riconosce Quarkus e Spring Boot, i progetti
 * «contenitore» (pom con moduli, settings.gradle) e la presenza del wrapper.
 */
export function detectServices(root: string, disk: Disk): JavaService[] {
  const base = sep(root)
  const found: JavaService[] = []
  let visited = 0

  const hasWrapper = (dir: string, build: JavaBuild): boolean => {
    const name = build === 'maven' ? 'mvnw.cmd' : 'gradlew.bat'
    for (let d = sep(dir); ; d = dirname(d)) {
      if (disk.list(d).some((e) => e.name.toLowerCase() === name)) return true
      if (key(d) === key(base) || d.length <= 3 || !d.includes('\\')) return false
    }
  }

  const walk = (dir: string, depth: number) => {
    if (visited++ > MAX_DIRS || depth > MAX_DEPTH) return
    const entries = disk.list(dir)
    const names = new Map(entries.map((e) => [e.name.toLowerCase(), e.name]))
    const name = dir.split('\\').pop() ?? dir

    if (names.has('pom.xml')) {
      const text = disk.read(join(dir, names.get('pom.xml')!)) ?? ''
      let project
      try {
        project = child(parseXml(text), 'project')
      } catch {
        project = undefined
      }
      if (project) {
        const packaging = topValue(project, 'packaging') ?? 'jar'
        found.push({
          id: key(dir),
          name: topValue(project, 'artifactId') ?? name,
          root: dir,
          build: 'maven',
          framework: frameworkOf(text, 'maven'),
          aggregator: packaging === 'pom',
          wrapper: hasWrapper(dir, 'maven'),
          javaVersion: mavenJavaVersion(project) ?? descendants(project, 'java.version')[0]?.text.trim()
        })
      }
    }

    const gradleFile = names.get('build.gradle.kts') ?? names.get('build.gradle')
    const settingsFile = names.get('settings.gradle.kts') ?? names.get('settings.gradle')
    if (gradleFile || settingsFile) {
      const build = gradleFile ? (disk.read(join(dir, gradleFile)) ?? '') : ''
      const settings = settingsFile ? (disk.read(join(dir, settingsFile)) ?? '') : ''
      const projectName = /rootProject\.name\s*=\s*["']([^"']+)["']/.exec(settings)?.[1]
      const includes = /\binclude\s*\(?\s*["']/.test(settings)
      found.push({
        id: key(dir),
        name: projectName ?? name,
        root: dir,
        build: 'gradle',
        framework: frameworkOf(build + '\n' + settings, 'gradle'),
        // Un settings con include e senza codice proprio fa solo da contenitore.
        aggregator: includes && !gradleFile,
        wrapper: hasWrapper(dir, 'gradle'),
        javaVersion: gradleJavaVersion(build)
      })
    }

    for (const e of entries) {
      if (!e.dir || SKIP.has(e.name) || e.name.startsWith('.')) continue
      walk(join(dir, e.name), depth + 1)
    }
  }
  walk(base, 0)

  // Chi sta dentro un altro servizio dello stesso tipo ne è un modulo.
  for (const s of found) {
    const parent = found
      .filter((p) => p !== s && p.build === s.build && key(s.root).startsWith(key(p.root) + '\\'))
      .sort((a, b) => key(b.root).length - key(a.root).length)[0]
    if (parent) s.parent = parent.root
  }
  // Un pom con moduli e packaging non pom non è un contenitore, ma un servizio con sotto-moduli: resta avviabile.
  return found.sort((a, b) => key(a.root).localeCompare(key(b.root)))
}

/** Disco vero, per l'app. */
export async function nodeDisk(): Promise<Disk> {
  const fs = await import('node:fs')
  return {
    list: (dir) => {
      try {
        return fs.readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() }))
      } catch {
        return []
      }
    },
    read: (p) => {
      try {
        return fs.readFileSync(p, 'utf8')
      } catch {
        return null
      }
    }
  }
}
