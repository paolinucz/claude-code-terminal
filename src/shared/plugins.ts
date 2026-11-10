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
  /** Punti dell'app a cui il plugin aggiunge cose (docs/plugin-contributi.md). */
  contributes?: PluginContributions
  /** Dati del plugin nelle impostazioni dell'app (la chiave deve iniziare con `plugin.<id>.` o con uno di questi prefissi). */
  storage?: { settingsPrefixes?: string[] }
  /** Cosa fa il plugin, in frasi per l'utente: si mostra prima dell'installazione (X3). */
  activities?: string[]
  /** Servizi sensibili dell'app che le pagine e l'adapter del plugin possono usare; si mostrano prima dell'installazione. */
  permissions?: PluginPermission[]
}

/**
 * Permessi dei servizi sensibili (docs/PLUGIN_API_DOCS.md §6). Quello che non è qui (aprire un file nell'editor, avvisi,
 * dialoghi, impostazioni del plugin, chiamate al proprio adapter) è sempre disponibile.
 */
export const PLUGIN_PERMISSIONS = {
  terminal: 'Mostrare i terminali delle sessioni che avvia',
  openUrl: 'Aprire indirizzi web (http e https) nel browser',
  'files.read': 'Leggere i file del progetto aperto',
  'files.write': 'Scrivere i file del progetto aperto'
} as const
export type PluginPermission = keyof typeof PLUGIN_PERMISSIONS

/** Eventi che l'app manda alle pagine dei plugin (oltre a quelli dell'adapter): `{cct:'event', event, data}`. */
export const APP_EVENTS = ['app.workspace', 'app.file.changed', 'app.session.exit'] as const

/** Eventi riservati che l'adapter manda all'app tramite `app.notify` e `app.terminal.show`: non arrivano alle pagine. */
export const HOST_EVENT_NOTIFY = '$ui.notify'
export const HOST_EVENT_TERMINAL = '$terminal.show'
export const HOST_EVENT_HIVE = '$terminal.hive'

/**
 * Contributi di un plugin all'interfaccia. L'app offre i punti di aggancio e non sa cosa ci sia dentro: la pagina
 * (HTML/JS/CSS) sta nel pacchetto e gira in un iframe isolato che parla con l'app via messaggi (PluginFrame).
 */
/** Indirizzo da cui l'iframe di un plugin carica la sua pagina: `app://plugin/<id-plugin>/<percorso>`. */
export const PLUGIN_UI_HOST = 'plugin'
export const pluginUiUrl = (pluginId: string, entry: string) => `app://${PLUGIN_UI_HOST}/${pluginId}/${entry.replace(/\\/g, '/')}`

export interface PluginContributions {
  /** Viste alternative dell'Esplora file (es. «Package» per Java). Compaiono solo con il plugin attivo. */
  explorerViews?: PluginExplorerView[]
  /** Segni nel margine dell'editor (breakpoint, riga fermata) per i file di certi linguaggi. */
  editorGutter?: PluginEditorGutter
  /** Voci della barra laterale (icona + pagina), per esempio «Esegui e debug» di Java. */
  sidebarViews?: PluginSidebarView[]
  /** Comandi nella palette (Ctrl+K). */
  commands?: PluginCommand[]
  /** Pagina di impostazioni del plugin, aperta dal pannello Plugin. */
  settings?: PluginSettingsPage
}

/**
 * Comando del plugin nella palette. Fa una cosa sola: `method` chiama l'adapter (con `{command: id}`), `openView` apre una
 * vista della barra laterale del plugin (id della vista).
 */
export interface PluginCommand {
  /** Unico dentro il plugin. */
  id: string
  title: string
  /** Parole in più per la ricerca. */
  keywords?: string
  /** Testo a destra nella palette (per esempio una scorciatoia). */
  hint?: string
  method?: string
  openView?: string
}

export interface PluginSettingsPage {
  /** Titolo della finestra (predefinito: «Impostazioni di <plugin>»). */
  title?: string
  /** Pagina HTML nel pacchetto. */
  entry: string
}

/**
 * Margine dell'editor: per i file dei linguaggi indicati l'app lascia lo spazio per i segni e, al clic su una riga,
 * chiama il metodo dell'adapter. I segni (quali righe e di che tipo) li decide l'adapter con `app.editor.markers`.
 */
export interface PluginEditorGutter {
  /** Id dei linguaggi (come in `languages`, anche di altri plugin). */
  languages: string[]
  /** Metodo dell'adapter chiamato al clic nel margine, con `{path, line}`. */
  click: string
}

/** Aspetto di un segno nel margine: un vocabolario piccolo e fisso, scelto dall'app. */
export type GutterKind = 'breakpoint' | 'breakpoint-disabled' | 'stopped'

export interface GutterMarker {
  /** Riga, da 1. */
  line: number
  kind: GutterKind
  /** Suggerimento al passaggio del mouse. */
  hint?: string
  /** Apre il file e porta la riga in vista (per esempio la riga in cui il programma si ferma). */
  reveal?: boolean
}

/** Segni di un file: sostituiscono i precedenti dello stesso plugin per quel file (`path: null` = tutti i file). */
export interface GutterMarkersUpdate {
  pluginId: string
  path: string | null
  markers: GutterMarker[]
}

export interface PluginSidebarView {
  /** Unico dentro il plugin. */
  id: string
  title: string
  /** Pagina HTML nel pacchetto. */
  entry: string
  /** Icona: file SVG nel pacchetto (es. «ui/run.svg»), mostrato come immagine. */
  icon?: string
  /** Scorciatoia da tastiera, per esempio «Ctrl+Maiusc+D» (la mostra nel suggerimento). */
  shortcut?: string
}

export interface PluginExplorerView {
  /** Unico dentro il plugin. */
  id: string
  /** Etichetta sul pulsante di scelta della vista. */
  title: string
  /** Pagina HTML nel pacchetto (percorso relativo, es. «ui/packages.html»). */
  entry: string
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
