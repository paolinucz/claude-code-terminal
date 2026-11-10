// Costruisce i pacchetti dei plugin di linguaggio (.ccplugin) in dist/plugins.
//
//   node scripts/build-plugins.mjs              tutti i plugin
//   node scripts/build-plugins.mjs java maven   solo quelli indicati
//
// Per ogni plugin: risolve le versioni, fissa nel manifest gli indirizzi dei download con il loro
// checksum (così l'installazione è riproducibile e verificata, X4), copia i file del server e
// comprime tutto in uno zip con plugin.json nella radice.
//
// Maven e Gradle hanno bisogno di Java per essere costruiti: lo script usa il JRE in
// %APPDATA%\Claude Code Terminal\plugins\cct.java\downloads\jre (installa prima il plugin Java)
// oppure la variabile JAVA_HOME.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'dist', 'plugins')
const WORK = join(tmpdir(), 'cct-plugin-build')
const PUBLISHER = 'Magnolia'
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const log = (...a) => console.log('·', ...a)

async function json(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}
async function text(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.text()
}
async function download(url, file) {
  mkdirSync(join(file, '..'), { recursive: true })
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error(`${r.status} ${url}`)
  const out = createWriteStream(file)
  const reader = r.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!out.write(value)) await new Promise((res) => out.once('drain', res))
  }
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())))
  return file
}
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/** Pacchetto npm: indirizzo del tarball e integrity dal registro. */
async function npmDist(name, version = 'latest') {
  const meta = await json(`https://registry.npmjs.org/${name.replace('/', '%2F')}/${version}`)
  return { version: meta.version, url: meta.dist.tarball, integrity: meta.dist.integrity, size: meta.dist.unpackedSize }
}

/** Installa pacchetti npm (con le dipendenze, senza quelle di sviluppo) in una cartella. */
function npmInstall(dir, packages) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'server', private: true }))
  execFileSync(NPM, ['install', '--omit=dev', '--no-fund', '--no-audit', '--ignore-scripts', '--no-package-lock', ...packages], { cwd: dir, stdio: 'inherit', shell: true })
}

function javaHome() {
  const fromPlugin = join(process.env.APPDATA ?? '', 'Claude Code Terminal', 'plugins', 'cct.java', 'downloads', 'jre')
  if (existsSync(join(fromPlugin, 'bin', 'java.exe'))) return fromPlugin
  const fromPhase6 = join(process.env.APPDATA ?? '', 'Claude Code Terminal', 'toolchains', 'java', 'jre')
  if (existsSync(join(fromPhase6, 'bin', 'java.exe'))) return fromPhase6
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', 'java.exe'))) return process.env.JAVA_HOME
  throw new Error('Serve Java per costruire questo plugin: installa prima il plugin Java nell\'app, oppure imposta JAVA_HOME.')
}

/**
 * Aggiunge adapter e SDK (plugins/<nome>/adapter.mjs, plugins/sdk) e comprime la cartella in un
 * .ccplugin (zip) con il tar di Windows.
 */
function pack(staging, source, manifest) {
  // `source` null = pacchetto senza adapter (per esempio il Java development pack: porta file e abilita funzioni dell'app).
  if (source) {
    const srcDir = join(ROOT, 'plugins', source)
    if (existsSync(join(srcDir, 'tsconfig.json'))) {
      // Sorgenti TypeScript (.mts): si compilano in .mjs (outDir del tsconfig) e finiscono nella radice del pacchetto.
      const outDir = join(ROOT, 'dist', 'plugin-build', source)
      rmSync(outDir, { recursive: true, force: true })
      execFileSync(NPX, ['tsc', '-p', join(srcDir, 'tsconfig.json')], { cwd: ROOT, stdio: 'inherit', shell: true })
      cpSync(outDir, staging, { recursive: true })
    } else {
      cpSync(join(srcDir, 'adapter.mjs'), join(staging, 'adapter.mjs'))
    }
    cpSync(join(ROOT, 'plugins', 'sdk', 'cct-plugin-sdk.mjs'), join(staging, 'cct-plugin-sdk.mjs'))
    // Pagine dell'interfaccia del plugin (contributi, docs/plugin-contributi.md): plugins/<nome>/ui → ui/ nel pacchetto.
    if (existsSync(join(ROOT, 'plugins', source, 'ui'))) cpSync(join(ROOT, 'plugins', source, 'ui'), join(staging, 'ui'), { recursive: true })
    manifest = { ...manifest, apiVersion: 1, main: 'adapter.mjs' }
  } else {
    manifest = { ...manifest, apiVersion: 1 }
  }
  writeFileSync(join(staging, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n')
  mkdirSync(OUT, { recursive: true })
  const zip = join(OUT, `${manifest.id}-${manifest.version}.zip`)
  const target = zip.replace(/\.zip$/, '.ccplugin')
  rmSync(zip, { force: true })
  rmSync(target, { force: true })
  execFileSync('tar', ['-a', '-c', '-f', zip, '-C', staging, '.'], { stdio: 'inherit' })
  renameSync(zip, target)
  log(`pronto: ${target} (${(readFileSync(target).length / 1048576).toFixed(1)} MB, sha256 ${sha256(target).slice(0, 16)}…)`)
}

function staging(id) {
  const dir = join(WORK, id)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

// ---------------------------------------------------------------------------------------------

const PLUGINS = {
  /** TypeScript/JavaScript: server nativo di TypeScript 7 (tsc --lsp), scaricato dal registro npm. */
  async typescript() {
    const dist = await npmDist('@typescript/typescript-win32-x64')
    const dir = staging('cct.typescript')
    pack(dir, 'typescript', {
      id: 'cct.typescript',
      name: 'TypeScript e JavaScript',
      version: '1.0.0',
      publisher: PUBLISHER,
      license: 'Apache-2.0 (TypeScript)',
      description: `Completamento, errori e definizioni per TypeScript e JavaScript con il server nativo di TypeScript ${dist.version}.`,
      languages: [
        { id: 'typescript', extensions: ['.ts', '.mts', '.cts'], monaco: 'typescript' },
        { id: 'typescriptreact', extensions: ['.tsx'], monaco: 'typescript' },
        { id: 'javascript', extensions: ['.js', '.mjs', '.cjs'], monaco: 'javascript' },
        { id: 'javascriptreact', extensions: ['.jsx'], monaco: 'javascript' }
      ],
      downloads: [{ id: 'tsc', url: dist.url, integrity: dist.integrity, size: dist.size, type: 'tar.gz', to: 'tsc', strip: true }],
      activities: [`Avvia il server di TypeScript ${dist.version} (tsc.exe --lsp), uno per progetto (tsconfig.json o package.json)`]
    })
  },

  /** Python: Pyright, scaricato dal registro npm (pacchetto autosufficiente). */
  async python() {
    const dist = await npmDist('pyright')
    const dir = staging('cct.python')
    pack(dir, 'python', {
      id: 'cct.python',
      name: 'Python',
      version: '1.0.0',
      publisher: PUBLISHER,
      license: 'MIT (Pyright)',
      description: `Completamento, controllo dei tipi ed errori per Python con Pyright ${dist.version}.`,
      languages: [{ id: 'python', extensions: ['.py', '.pyi'], monaco: 'python' }],
      downloads: [{ id: 'pyright', url: dist.url, integrity: dist.integrity, size: dist.size, type: 'tar.gz', to: 'pyright', strip: true }],
      activities: [`Avvia Pyright ${dist.version} con Node (quello dell'app), uno per progetto Python`]
    })
  },

  /** YAML: yaml-language-server con le sue dipendenze, incluso nel pacchetto. */
  async yaml() {
    const dir = staging('cct.yaml')
    npmInstall(join(dir, 'server'), ['yaml-language-server'])
    const version = JSON.parse(readFileSync(join(dir, 'server', 'node_modules', 'yaml-language-server', 'package.json'), 'utf8')).version
    pack(dir, 'yaml', {
      id: 'cct.yaml',
      name: 'YAML',
      version: '1.0.0',
      publisher: PUBLISHER,
      license: 'MIT (yaml-language-server)',
      description: `Controlli e completamento per YAML (anche con gli schemi di SchemaStore) con yaml-language-server ${version}.`,
      languages: [{ id: 'yaml', extensions: ['.yml', '.yaml'], monaco: 'yaml' }],
      activities: [`Avvia yaml-language-server ${version} con Node (quello dell'app)`, 'Scarica gli schemi da SchemaStore (www.schemastore.org) per riconoscere i file noti']
    })
  },

  /** Java: JRE 25 Temurin + jdtls, scaricati all'installazione. Fornisce il runtime «java» agli altri plugin. */
  async java() {
    const jre = (await json('https://api.adoptium.net/v3/assets/latest/25/hotspot?os=windows&architecture=x64&image_type=jre&vendor=eclipse'))[0]
    const base = 'https://download.eclipse.org/jdtls/snapshots/'
    const name = (await text(base + 'latest.txt')).trim()
    const jdtlsSha = (await text(base + name + '.sha256')).trim().split(/\s+/)[0]
    const tgz = await download(base + name, join(WORK, 'cache', name))
    if (sha256(tgz) !== jdtlsSha) throw new Error('checksum di jdtls non valido')
    const version = name.match(/jdt-language-server-([\d.]+)/)?.[1] ?? '?'
    const dir = staging('cct.java')
    pack(dir, 'java', {
      id: 'cct.java',
      name: 'Java',
      version: '1.2.0',
      publisher: PUBLISHER,
      license: 'EPL-2.0 (jdtls), GPLv2 con Classpath Exception (Temurin)',
      description: `Eclipse JDT Language Server ${version} con un JRE ${jre.version.semver} (Eclipse Temurin). Importa i progetti Maven e Gradle. Fornisce Java ai plugin Maven e Gradle.`,
      languages: [{ id: 'java', extensions: ['.java'], monaco: 'java' }],
      // Vista «Package» dell'Esplora file (come IntelliJ): la pagina sta nel pacchetto, l'app non sa nulla di Java.
      contributes: { explorerViews: [{ id: 'packages', title: 'Package', entry: 'ui/packages.html' }] },
      downloads: [
        { id: 'jre', url: jre.binary.package.link, sha256: jre.binary.package.checksum, size: jre.binary.package.size, type: 'zip', to: 'jre', strip: true },
        { id: 'jdtls', url: base + name, sha256: jdtlsSha, size: readFileSync(tgz).length, type: 'tar.gz', to: 'jdtls' }
      ],
      provides: {
        runtimes: {
          // Certificati di Windows: con antivirus o proxy che ispezionano HTTPS, Maven e Gradle scaricano comunque.
          java: { command: '${downloads}/jre/bin/java.exe', args: ['-Djavax.net.ssl.trustStoreType=Windows-ROOT'] }
        }
      },
      activities: [
        `Avvia Eclipse JDT Language Server ${version} con il JRE del plugin, uno per progetto (il più esterno con pom.xml o build.gradle)`,
        'Importa i progetti Maven e Gradle: può scaricare le loro dipendenze da Maven Central',
        'Aggiunge all\'Esplora file la vista «Package» (moduli, sorgenti, test e package compatti)',
        'Tiene le sue cache nella cartella dati dell\'app'
      ]
    })
  },

  /**
   * Java development pack: debugger Java (java-debug dentro jdtls), run configuration per Maven, Gradle e Quarkus,
   * importazione da IntelliJ e Lombok. Porta un JDK Temurin completo per jdtls (il JRE di cct.java non ha jdk.jdi).
   */
  async javadev() {
    const jdk = (await json('https://api.adoptium.net/v3/assets/latest/25/hotspot?os=windows&architecture=x64&image_type=jdk&vendor=eclipse'))[0]
    const latest = async (path) => (await text(`https://repo1.maven.org/maven2/${path}/maven-metadata.xml`)).match(/<release>([^<]+)<\/release>/)?.[1] ?? (await text(`https://repo1.maven.org/maven2/${path}/maven-metadata.xml`)).match(/<latest>([^<]+)<\/latest>/)[1]
    const debugVersion = await latest('com/microsoft/java/com.microsoft.java.debug.plugin')
    const lombokVersion = await latest('org/projectlombok/lombok')
    const debugUrl = `https://repo1.maven.org/maven2/com/microsoft/java/com.microsoft.java.debug.plugin/${debugVersion}/com.microsoft.java.debug.plugin-${debugVersion}.jar`
    const lombokUrl = `https://repo1.maven.org/maven2/org/projectlombok/lombok/${lombokVersion}/lombok-${lombokVersion}.jar`
    const debugJar = await download(debugUrl, join(WORK, 'cache', `java-debug-${debugVersion}.jar`))
    const lombokJar = await download(lombokUrl, join(WORK, 'cache', `lombok-${lombokVersion}.jar`))
    const dir = staging('cct.java-dev')
    pack(dir, 'java-dev', {
      id: 'cct.java-dev',
      name: 'Java Development Pack',
      version: '2.0.0',
      publisher: PUBLISHER,
      license: 'EPL-1.0 (java-debug), MIT (Lombok), GPLv2 con Classpath Exception (Temurin)',
      description: `Debugger Java (java-debug ${debugVersion}) con run configuration per Maven, Gradle e Quarkus, importazione delle run configuration di IntelliJ IDEA e supporto a Lombok ${lombokVersion}. Porta un JDK Eclipse Temurin ${jdk.version.semver} per il language server.`,
      requires: ['cct.java'],
      languages: [],
      // Tutta l'interfaccia è del plugin: l'app non contiene più nulla di Java (docs/PLUGIN_API_DOCS.md).
      // I dati già salvati (run configuration, JDK, breakpoint) restano sotto «java.».
      storage: { settingsPrefixes: ['java.'] },
      permissions: ['terminal'],
      contributes: {
        sidebarViews: [{ id: 'run', title: 'Esegui e debug', entry: 'ui/run.html', icon: 'ui/run.svg', shortcut: 'Ctrl+Maiusc+D' }],
        editorGutter: { languages: ['java'], click: 'gutter.click' },
        commands: [{ id: 'open', title: 'Apri Esegui e debug', keywords: 'java maven gradle quarkus debug breakpoint avvia', openView: 'run' }]
      },
      downloads: [
        { id: 'jdk', url: jdk.binary.package.link, sha256: jdk.binary.package.checksum, size: jdk.binary.package.size, type: 'zip', to: 'jdk', strip: true },
        { id: 'debug', url: debugUrl, sha256: sha256(debugJar), size: readFileSync(debugJar).length, type: 'file', to: 'debug/java-debug.jar' },
        { id: 'lombok', url: lombokUrl, sha256: sha256(lombokJar), size: readFileSync(lombokJar).length, type: 'file', to: 'lombok/lombok.jar' }
      ],
      activities: [
        `Fa partire il language server Java con il JDK Temurin ${jdk.version.semver} del pack (completo, serve al debug) e con Lombok ${lombokVersion} come agente`,
        `Carica java-debug ${debugVersion} nel language server per il debug (breakpoint, passo-passo, variabili)`,
        'Aggiunge la vista «Esegui e debug»: avvia Maven, Gradle, Quarkus e applicazioni Java in un terminale, anche in debug',
        'Legge le run configuration di IntelliJ IDEA dalle cartelle .idea e .run del progetto (solo lettura)',
        'Scarica Eclipse Temurin (JDK) da api.adoptium.net quando lo chiedi dal pannello, verificando il checksum'
      ]
    })
  },

  /** Maven (e XML): LemMinX + estensione Maven, con tutte le dipendenze raccolte da Maven Central. */
  async maven() {
    const java = javaHome()
    const lemminxMaven = '0.12.0'
    // Maven serve solo per raccogliere le dipendenze, qui; non finisce nel pacchetto.
    const mvnVersion = (await text('https://dlcdn.apache.org/maven/maven-3/')).match(/href="(3\.\d+\.\d+)\/"/g)?.map((h) => h.slice(6, -2)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()
    const mvnZip = await download(`https://dlcdn.apache.org/maven/maven-3/${mvnVersion}/binaries/apache-maven-${mvnVersion}-bin.zip`, join(WORK, 'cache', `maven-${mvnVersion}.zip`))
    const mvnSha = (await text(`https://dlcdn.apache.org/maven/maven-3/${mvnVersion}/binaries/apache-maven-${mvnVersion}-bin.zip.sha512`)).trim().split(/\s+/)[0]
    if (createHash('sha512').update(readFileSync(mvnZip)).digest('hex') !== mvnSha) throw new Error('checksum di Maven non valido')
    const mvnDir = join(WORK, 'cache', `maven-${mvnVersion}`)
    if (!existsSync(mvnDir)) {
      mkdirSync(mvnDir, { recursive: true })
      execFileSync('tar', ['-xf', mvnZip, '-C', mvnDir])
    }
    const mvn = join(mvnDir, `apache-maven-${mvnVersion}`, 'bin', 'mvn.cmd')
    const dir = staging('cct.maven')
    const resolveDir = join(WORK, 'maven-resolve')
    rmSync(resolveDir, { recursive: true, force: true })
    mkdirSync(resolveDir, { recursive: true })
    writeFileSync(
      join(resolveDir, 'pom.xml'),
      `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>cct</groupId><artifactId>resolve</artifactId><version>1</version>
  <repositories><repository><id>lemminx</id><url>https://repo.eclipse.org/content/repositories/lemminx-releases/</url></repository></repositories>
  <dependencies><dependency><groupId>org.eclipse.lemminx</groupId><artifactId>lemminx-maven</artifactId><version>${lemminxMaven}</version></dependency></dependencies></project>`
    )
    execFileSync(mvn, ['-q', '-B', 'dependency:copy-dependencies', `-DoutputDirectory=${join(dir, 'server')}`, '-DincludeScope=runtime'], {
      cwd: resolveDir,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, JAVA_HOME: java, MAVEN_OPTS: '-Djavax.net.ssl.trustStoreType=Windows-ROOT' }
    })
    const jars = readdirSync(join(dir, 'server'))
    const lemminx = jars.find((j) => /^org\.eclipse\.lemminx-[\d.]+\.jar$/.test(j))?.match(/-([\d.]+)\.jar$/)?.[1] ?? '?'
    log(`Maven: ${jars.length} jar (LemMinX ${lemminx})`)
    pack(dir, 'maven', {
      id: 'cct.maven',
      name: 'Maven (e XML)',
      version: '1.0.0',
      publisher: PUBLISHER,
      license: 'EPL-2.0 (LemMinX, lemminx-maven), Apache-2.0 (Maven)',
      description: `LemMinX ${lemminx} con l'estensione Maven ${lemminxMaven}: completamento di dipendenze, plugin e versioni in pom.xml, e controlli per tutti i file XML.`,
      requires: ['cct.java'],
      languages: [{ id: 'xml', extensions: ['.xml', '.xsd', '.xsl', '.xslt', '.wsdl', '.pom'], monaco: 'xml' }],
      activities: [
        `Avvia LemMinX ${lemminx} con il runtime Java del plugin Java`,
        'Legge i pom.xml e il repository Maven locale (~/.m2) per completare dipendenze, plugin e versioni'
      ]
    })
  },

  /** Gradle: il language server per build.gradle dell'estensione Gradle for Java (MIT), dal suo pacchetto. */
  async gradle() {
    const meta = await json('https://open-vsx.org/api/vscjava/vscode-gradle')
    const vsix = await download(meta.files.download, join(WORK, 'cache', `vscode-gradle-${meta.version}.vsix`))
    const ex = join(WORK, 'gradle-vsix')
    rmSync(ex, { recursive: true, force: true })
    mkdirSync(ex, { recursive: true })
    execFileSync('tar', ['-xf', vsix, '-C', ex, 'extension/lib', 'extension/LICENSE.md'])
    const dir = staging('cct.gradle')
    mkdirSync(join(dir, 'server'), { recursive: true })
    for (const f of readdirSync(join(ex, 'extension', 'lib'))) if (f.endsWith('.jar')) cpSync(join(ex, 'extension', 'lib', f), join(dir, 'server', f))
    cpSync(join(ex, 'extension', 'LICENSE.md'), join(dir, 'LICENSE-vscode-gradle.md'))
    pack(dir, 'gradle', {
      id: 'cct.gradle',
      name: 'Gradle',
      version: '1.0.0',
      publisher: PUBLISHER,
      license: 'MIT (vscode-gradle, Microsoft)',
      description: `Language server per build.gradle (Groovy) dall'estensione Gradle for Java ${meta.version}: completamento di blocchi, proprietà e dipendenze, ed errori di sintassi.`,
      requires: ['cct.java'],
      languages: [{ id: 'gradle', extensions: ['.gradle'], monaco: 'java' }],
      activities: ['Avvia il Gradle Language Server con il runtime Java del plugin Java, collegato all\'adapter con una named pipe locale']
    })
  },

  /** Angular: @angular/language-server con le sue dipendenze. Usa anche la TypeScript del progetto. */
  async angular() {
    const dir = staging('cct.angular')
    npmInstall(join(dir, 'server'), ['@angular/language-server'])
    const pkgDir = join(dir, 'server', 'node_modules', '@angular', 'language-server')
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    pack(dir, 'angular', {
      id: 'cct.angular',
      name: 'Angular',
      version: '1.0.0',
      publisher: PUBLISHER,
      license: 'MIT (Angular)',
      description: `Angular Language Service ${pkg.version}: completamento, errori e definizioni nei template e nei componenti dei progetti con angular.json.`,
      languages: [{ id: 'html', extensions: ['.html'], monaco: 'html' }],
      // I file .ts arrivano all'adapter se è installato anche il plugin TypeScript (che definisce «typescript»).
      handles: ['html', 'typescript'],
      activities: [
        `Avvia Angular Language Service ${pkg.version} con Node (quello dell'app), solo nei progetti con angular.json`,
        'Usa TypeScript e @angular/core del progetto, se ci sono'
      ]
    })
  }
}

const wanted = process.argv.slice(2)
const names = wanted.length ? wanted : Object.keys(PLUGINS)
mkdirSync(WORK, { recursive: true })
for (const n of names) {
  if (!PLUGINS[n]) throw new Error(`Plugin sconosciuto: ${n} (disponibili: ${Object.keys(PLUGINS).join(', ')})`)
  log(`— ${n}`)
  await PLUGINS[n]()
}
