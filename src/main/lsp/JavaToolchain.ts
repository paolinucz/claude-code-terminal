import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { JavaInstallProgress } from '@shared/files'
import { findLauncherJar } from './LanguageServerManager'

const run = promisify(execFile)

const ADOPTIUM_ASSETS = 'https://api.adoptium.net/v3/assets/latest/25/hotspot?os=windows&architecture=x64&image_type=jre&vendor=eclipse'
const JDTLS_BASE = 'https://download.eclipse.org/jdtls/snapshots/'
/** Le versioni recenti di jdtls richiedono Java 25 (osgi.ee JavaSE 25). */
const REQUIRED_JAVA = 25

/**
 * Supporto Java dell'editor, scaricato al primo uso nella cartella dati dell'app (decisione della fase 6):
 * un JRE 25 portatile (jdtls richiede Java 25) (Eclipse Temurin, da api.adoptium.net) e jdtls (Eclipse, da download.eclipse.org).
 * Ogni download viene verificato con il suo SHA-256 ufficiale prima di essere estratto.
 */
export class JavaToolchain {
  private installing: Promise<void> | null = null

  constructor(private readonly dir: string) {}

  get jreDir(): string {
    return join(this.dir, 'jre')
  }

  get jdtlsDir(): string {
    return join(this.dir, 'jdtls')
  }

  get java(): string {
    return join(this.jreDir, 'bin', 'java.exe')
  }

  installed(): boolean {
    return this.jreOk() && findLauncherJar(this.jdtlsDir) !== null
  }

  /** Il JRE c'è ed è almeno Java 25 (versione richiesta da jdtls). Legge il file «release» del JRE. */
  private jreOk(): boolean {
    if (!existsSync(this.java)) return false
    try {
      const release = readFileSync(join(this.jreDir, 'release'), 'utf8')
      const major = Number(/JAVA_VERSION="(\d+)/.exec(release)?.[1] ?? 0)
      return major >= REQUIRED_JAVA
    } catch {
      return false
    }
  }

  install(onProgress: (p: JavaInstallProgress) => void): Promise<void> {
    this.installing ??= this.doInstall(onProgress).finally(() => (this.installing = null))
    return this.installing
  }

  private async doInstall(onProgress: (p: JavaInstallProgress) => void): Promise<void> {
    mkdirSync(this.dir, { recursive: true })
    const tmp = join(this.dir, 'download')
    mkdirSync(tmp, { recursive: true })
    try {
      if (!this.jreOk()) {
        onProgress({ step: 'jre', progress: 0, message: 'Cerco il JRE 25…' })
        const assets = (await (await fetch(ADOPTIUM_ASSETS)).json()) as { binary: { package: { link: string; checksum: string; name: string; size: number } } }[]
        const pkg = assets[0]?.binary.package
        if (!pkg) throw new Error('Nessun JRE 25 disponibile da Adoptium.')
        const zip = join(tmp, pkg.name)
        await download(pkg.link, zip, pkg.checksum, (f) => onProgress({ step: 'jre', progress: f, message: `Scarico il JRE 25 (${Math.round(pkg.size / 1048576)} MB)…` }))
        onProgress({ step: 'jre', progress: 1, message: 'Estraggo il JRE…' })
        const out = join(tmp, 'jre-extract')
        rmSync(out, { recursive: true, force: true })
        mkdirSync(out, { recursive: true })
        await run('tar', ['-xf', zip, '-C', out], { windowsHide: true })
        // Lo zip contiene una cartella tipo «jdk-25.0.5+8-jre»: diventa «jre».
        const inner = readdirSync(out).find((n) => existsSync(join(out, n, 'bin', 'java.exe')))
        if (!inner) throw new Error('Il JRE scaricato non contiene java.exe.')
        rmSync(this.jreDir, { recursive: true, force: true })
        renameSync(join(out, inner), this.jreDir)
      }

      if (!findLauncherJar(this.jdtlsDir)) {
        onProgress({ step: 'jdtls', progress: 0, message: 'Cerco jdtls…' })
        const name = (await (await fetch(JDTLS_BASE + 'latest.txt')).text()).trim()
        if (!/^jdt-language-server-[\w.-]+\.tar\.gz$/.test(name)) throw new Error('Versione di jdtls non riconosciuta.')
        const sha = (await (await fetch(JDTLS_BASE + name + '.sha256')).text()).trim().split(/\s+/)[0]
        const tgz = join(tmp, name)
        await download(JDTLS_BASE + name, tgz, sha, (f) => onProgress({ step: 'jdtls', progress: f, message: 'Scarico jdtls…' }))
        onProgress({ step: 'jdtls', progress: 1, message: 'Estraggo jdtls…' })
        rmSync(this.jdtlsDir, { recursive: true, force: true })
        mkdirSync(this.jdtlsDir, { recursive: true })
        await run('tar', ['-xzf', tgz, '-C', this.jdtlsDir], { windowsHide: true })
        if (!findLauncherJar(this.jdtlsDir)) throw new Error('jdtls estratto non è completo.')
      }
      onProgress({ step: 'done', progress: 1, message: 'Supporto Java installato.' })
    } catch (err) {
      onProgress({ step: 'error', progress: 0, message: (err as Error).message })
      throw err
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  /** Comando per avviare jdtls su un progetto. */
  command(dataDir: string): { file: string; args: string[] } {
    const launcher = findLauncherJar(this.jdtlsDir)!
    return {
      file: this.java,
      args: [
        '-Declipse.application=org.eclipse.jdt.ls.core.id1',
        '-Dosgi.bundles.defaultStartLevel=4',
        '-Declipse.product=org.eclipse.jdt.ls.core.product',
        '-Dlog.level=WARNING',
        // Certificati di Windows: con antivirus o proxy che ispezionano HTTPS, Maven/Gradle altrimenti
        // non riescono a scaricare le dipendenze (PKIX path building failed).
        '-Djavax.net.ssl.trustStoreType=Windows-ROOT',
        '-Xms256m',
        '-Xmx1G',
        '--add-modules=ALL-SYSTEM',
        '--add-opens', 'java.base/java.util=ALL-UNNAMED',
        '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
        '-jar', launcher,
        '-configuration', join(this.jdtlsDir, 'config_win'),
        '-data', dataDir
      ]
    }
  }
}

/** Scarica un file mostrando l'avanzamento e ne verifica lo SHA-256. */
async function download(url: string, target: string, sha256: string, onProgress: (fraction: number) => void): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download non riuscito (${res.status}): ${url}`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = createHash('sha256')
  const file = createWriteStream(target)
  let done = 0
  let lastReport = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done: end, value } = await reader.read()
    if (end) break
    hash.update(value)
    if (!file.write(value)) await new Promise((r) => file.once('drain', r))
    done += value.length
    if (total && Date.now() - lastReport > 150) {
      lastReport = Date.now()
      onProgress(done / total)
    }
  }
  await new Promise<void>((resolve, reject) => file.end((err?: Error | null) => (err ? reject(err) : resolve())))
  const actual = hash.digest('hex')
  if (actual.toLowerCase() !== sha256.toLowerCase()) {
    rmSync(target, { force: true })
    throw new Error('Il file scaricato non corrisponde al checksum ufficiale: download annullato.')
  }
}
