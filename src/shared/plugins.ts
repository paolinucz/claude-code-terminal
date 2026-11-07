// Plugin di linguaggio (requisiti X1–X9): pacchetti .ccplugin con un adapter che implementa
// la CCT Plugin API (docs/plugin-api.md) e fa l'adattamento verso il proprio language server.

/**
 * Manifest di un plugin (plugin.json nella radice del pacchetto).
 * Nei percorsi si possono usare ${plugin} (cartella del plugin) e ${downloads}.
 */
export interface PluginManifest {
  /** Identificatore unico, es. «cct.java». */
  id: string
  name: string
  version: string
  publisher: string
  description: string
  license?: string
  /** Versione della CCT Plugin API implementata dall'adapter. */
  apiVersion?: number
  /** File dell'adapter (es. «adapter.mjs»), eseguito con Node in un processo separato. Senza: solo colorazione. */
  main?: string
  /** Plugin necessari (per id), es. Maven richiede il runtime Java del plugin Java. */
  requires?: string[]
  /** Linguaggi che il plugin definisce: estensioni dei file → linguaggio di Monaco per la colorazione. */
  languages?: PluginLanguage[]
  /**
   * Linguaggi (id, anche definiti da altri plugin) i cui documenti vanno all'adapter.
   * Predefinito: gli id di `languages`. Es. Angular gestisce anche «typescript».
   */
  handles?: string[]
  /** File da scaricare all'installazione, verificati con SHA-256 o integrity npm (sha512). */
  downloads?: PluginDownload[]
  /** Runtime che il plugin mette a disposizione degli altri (es. «java»). */
  provides?: { runtimes?: Record<string, PluginRuntime> }
  /** Cosa fa il plugin, in frasi per l'utente: si mostra prima dell'installazione (X3). */
  activities?: string[]
}

export interface PluginLanguage {
  /** Id interno, es. «java», «xml», «angular-template». */
  id: string
  /** Estensioni (con il punto) o nomi di file esatti, es. [".java"] o ["pom.xml"]. */
  extensions?: string[]
  filenames?: string[]
  /** Linguaggio di Monaco per la colorazione (es. «java», «xml», «html»). */
  monaco: string
}

export interface PluginDownload {
  id: string
  url: string
  /** Uno dei due è obbligatorio. */
  sha256?: string
  /** Integrity in stile npm, es. «sha512-…». */
  integrity?: string
  size?: number
  /** Come trattarlo: «zip», «tar.gz» (estratti) o «file» (copiato così com'è). */
  type: 'zip' | 'tar.gz' | 'file'
  /** Cartella di destinazione dentro ${downloads}. */
  to: string
  /** Toglie la prima cartella dell'archivio (come tar --strip-components=1). */
  strip?: boolean
}

export interface PluginRuntime {
  command: string
  args?: string[]
}

/** Plugin installato, come lo vede l'interfaccia. */
export interface InstalledPlugin {
  manifest: PluginManifest
  enabled: boolean
  installedAt: string
  /** SHA-256 del pacchetto importato. */
  packageHash: string
  /**
   * - ok: pronto
   * - modified: i file del plugin non corrispondono a quelli installati (bloccato finché non lo reinstalli)
   * - missing-requirement: manca un plugin richiesto
   */
  state: 'ok' | 'modified' | 'missing-requirement'
  message?: string
  sizeBytes: number
}

/** Anteprima di un pacchetto prima dell'installazione (X3). */
export interface PluginPreview {
  token: string
  file: string
  manifest: PluginManifest
  packageHash: string
  packageSize: number
  /** Adapter che verrà eseguito (percorso nel pacchetto) e versione dell'API. */
  entry?: { main: string; apiVersion: number }
  missingRequirements: string[]
  /** Versione già installata, se c'è (aggiornamento). */
  installedVersion?: string
  warnings: string[]
}

export interface PluginInstallProgress {
  pluginId: string
  step: string
  /** 0–1 */
  progress: number
  done?: boolean
  error?: string
}

/** Linguaggi registrati dai plugin attivi, per l'editor. */
export interface PluginLanguageInfo {
  id: string
  monaco: string
  extensions: string[]
  filenames: string[]
  pluginId: string
  /** C'è almeno un adapter attivo che gestisce questo linguaggio. */
  hasServer: boolean
}
