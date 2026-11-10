/** Java development pack: servizi, JDK, run configuration e debug (tipi condivisi tra processo principale e interfaccia). */

/** Id del pacchetto che abilita tutto questo (pacchetto .ccplugin, richiede cct.java). */
export const JAVA_PACK_ID = 'cct.java-dev'

export type JavaBuild = 'maven' | 'gradle'
export type JavaFramework = 'quarkus' | 'spring-boot' | 'plain'

/** Un servizio Java: una cartella con un proprio pom.xml o build.gradle (anche più d'uno nella stessa cartella di lavoro). */
export interface JavaService {
  /** Cartella del servizio, in minuscolo e con \ (chiave stabile). */
  id: string
  name: string
  /** Cartella del servizio (percorso vero). */
  root: string
  build: JavaBuild
  framework: JavaFramework
  /** Progetto «contenitore» (packaging pom con moduli): non si avvia da solo. */
  aggregator: boolean
  /** Esiste mvnw/gradlew (nella cartella o sopra). */
  wrapper: boolean
  /** Cartella del progetto che lo contiene come modulo, se è un modulo. */
  parent?: string
  /** Versione di Java dichiarata dal progetto (release, source, javaVersion…), se si trova. */
  javaVersion?: string
}

export interface JdkInfo {
  /** Chiave stabile: percorso normalizzato. */
  id: string
  /** Versione principale (8, 11, 17, 21, 25…). */
  major: number
  /** Versione completa, per esempio «21.0.5». */
  version: string
  vendor: string
  path: string
  /** `temurin` = scaricato dall'app (si può cancellare); gli altri sono trovati sul PC. */
  source: 'temurin' | 'env' | 'path' | 'system' | 'intellij'
}

export type RunConfigType = 'maven' | 'gradle' | 'quarkus' | 'application' | 'attach'

export interface RunConfig {
  id: string
  name: string
  type: RunConfigType
  /** Cartella di lavoro/servizio. */
  root: string
  /** JDK da usare (id); vuoto = quello del servizio, poi quello predefinito. */
  jdk?: string
  /** Variabili d'ambiente aggiuntive. */
  env: Record<string, string>
  /** Opzioni della JVM dell'applicazione (-Xmx…, -Dprop=…). */
  vmOptions: string
  /** Argomenti del programma (application) o parametri aggiuntivi (maven/gradle). */
  args: string
  /** Porta di debug dell'applicazione. */
  debugPort: number
  /** maven: obiettivi (clean package, quarkus:dev…). */
  goals?: string
  /** maven: profili separati da virgola. */
  profiles?: string
  /** gradle: task (bootRun, quarkusDev…). */
  tasks?: string
  /** quarkus: con quale strumento si avvia il dev mode. */
  tool?: JavaBuild
  /** application: classe con il main. */
  mainClass?: string
  /** attach: macchina e porta a cui collegarsi. */
  host?: string
  port?: number
  /** Da dove viene (per mostrare l'origine). */
  origin?: 'manuale' | 'intellij'
}

export interface JavaProgress {
  /** Cosa sta facendo («Scarico Temurin 21»…). */
  step: string
  progress: number
  done?: boolean
  error?: string
}

/** Stato di un breakpoint salvato (per file). */
export interface JavaBreakpoint {
  line: number
  condition?: string
  enabled: boolean
}

export type DebugStatus = 'idle' | 'starting' | 'running' | 'paused' | 'terminated'

export interface DebugFrame {
  id: number
  name: string
  path?: string
  line: number
  column?: number
}

export interface DebugVariable {
  name: string
  value: string
  type?: string
  /** > 0 = ha figli da caricare con `variables`. */
  ref: number
}

export interface DebugScope {
  name: string
  ref: number
}

export interface DebugState {
  status: DebugStatus
  configId?: string
  configName?: string
  /** Messaggio per l'utente («Importazione del progetto…», errore). */
  message?: string
  threadId?: number
  /** Perché si è fermato (breakpoint, step, exception…). */
  reason?: string
  frames: DebugFrame[]
  /** Breakpoint come li ha verificati java-debug: file → righe confermate. */
  verified: Record<string, number[]>
  /** Sessione terminale in cui gira il processo, se lo ha avviato l'app. */
  sessionId?: string
}

export interface DebugOutput {
  /** console, stdout, stderr, repl */
  category: string
  text: string
}

export interface JavaState {
  /** Il pacchetto è installato e attivo. */
  enabled: boolean
  services: JavaService[]
  jdks: JdkInfo[]
  configs: RunConfig[]
  /** JDK predefinito generale (id). */
  defaultJdk?: string
  /** JDK per servizio (id servizio → id JDK). */
  serviceJdk: Record<string, string>
}

export interface IdeaImportResult {
  configs: RunConfig[]
  warnings: string[]
}

export const emptyDebugState = (): DebugState => ({ status: 'idle', frames: [], verified: {} })
