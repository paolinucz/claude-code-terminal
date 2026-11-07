// Tipi condivisi tra processo principale, preload e interfaccia.
import type { ChangeContents, FileChange, RejectResult, ReviewNote, RevisionResult } from './changes'
import type { ExternalChange, PermissionScope, PermissionsState, SaveResult, ScopeData } from './permissions'
import type {
  DirEntry,
  FileContent,
  FileDiagnostics,
  FileIndex,
  GitStatus,
  LspStatus,
  SaveFileResult
} from './files'
import type { InstalledPlugin, PluginInstallProgress, PluginLanguageInfo, PluginPreview } from './plugins'
import type { ApiCompletionList, ApiHover, ApiLocation, ApiPosition } from './pluginApi'
import type {
  ClaudeCliInfo,
  ClaudeEffort,
  ClaudeModel,
  CreateSessionRequest,
  ProjectPrefs,
  ResumableSession,
  SessionAttention,
  SessionInfo,
  SessionSnapshot,
  ShellInfo
} from './sessions'
import type { AppInfo, UpdateStatus } from './updates'

/** Layout serializzato di Dockview (risultato di `api.toJSON()`). Lo trattiamo come dato opaco. */
export type SerializedLayout = Record<string, unknown>

/** Un foglio (L1): area di lavoro indipendente con i suoi pannelli. */
export interface Sheet {
  id: string
  name: string
  /** Disposizione salvata in automatico (L5). `null` = usa il layout predefinito del foglio. */
  layout: SerializedLayout | null
}

/** Layout salvato con un nome (L5). Contiene solo la disposizione dei pannelli, non le sessioni. */
export interface NamedLayout {
  id: string
  name: string
  layout: SerializedLayout
  createdAt: string
}

export interface WorkspaceState {
  sheets: Sheet[]
  activeSheetId: string | null
}

/** API esposta dal preload su `window.api`. Nel browser la sostituisce un'implementazione su localStorage. */
export interface AppApi {
  /** Dove vengono salvati i dati: 'sqlite' in Electron, 'localStorage' nel browser. */
  readonly backend: 'sqlite' | 'localStorage'
  workspace: {
    load(): Promise<WorkspaceState>
    /** Salva elenco, nomi e ordine dei fogli e il foglio attivo (non i layout). */
    saveSheets(sheets: Pick<Sheet, 'id' | 'name'>[], activeSheetId: string | null): Promise<void>
    /** Salvataggio automatico della disposizione di un foglio. */
    saveSheetLayout(sheetId: string, layout: SerializedLayout | null): Promise<void>
  }
  layouts: {
    list(): Promise<NamedLayout[]>
    save(name: string, layout: SerializedLayout): Promise<NamedLayout>
    remove(id: string): Promise<void>
  }
  /** Modifiche di Claude ai file (F4–F7). */
  changes: {
    list(): Promise<FileChange[]>
    contents(id: string): Promise<ChangeContents | null>
    approve(id: string): Promise<void>
    approveAll(sessionId?: string): Promise<number>
    /** Rifiuta: ripristina il file e avvisa la sessione al prossimo prompt. */
    reject(id: string, force?: boolean): Promise<RejectResult>
    /** F8: invia accortezze e divieti a Claude; la modifica torna in revisione quando Claude riscrive il file. */
    requestRevision(id: string, notes: ReviewNote[]): Promise<RevisionResult>
    onChanged(cb: (changes: FileChange[]) => void): () => void
  }
  /** File del workspace (F1, F2). */
  files: {
    list(dir: string): Promise<DirEntry[]>
    read(path: string): Promise<FileContent>
    write(path: string, text: string, expectedMtime?: number, force?: boolean): Promise<SaveFileResult>
    gitStatus(dir: string): Promise<GitStatus>
    /** L7: tutti i file della cartella, con percorsi relativi (per la palette comandi). Rispetta .gitignore. */
    index(root: string): Promise<FileIndex>
    watch(root: string): void
    unwatch(root: string): void
    reveal(path: string): Promise<void>
    onChanged(cb: (root: string, paths: string[]) => void): () => void
  }
  /** Language server dell'editor (F2, F3), forniti dai plugin. Il processo principale sceglie i server dal file. */
  lsp: {
    open(path: string, text: string, workspace?: string): void
    change(path: string, text: string, workspace?: string): void
    save(path: string, text: string): void
    close(path: string): void
    /** Richieste in formato CCT Plugin API (righe e colonne da 1); risultati uniti da tutti i plugin del file (X6). */
    completion(path: string, position: ApiPosition): Promise<ApiCompletionList>
    hover(path: string, position: ApiPosition): Promise<ApiHover | null>
    definition(path: string, position: ApiPosition): Promise<ApiLocation[]>
    statuses(): Promise<LspStatus[]>
    onDiagnostics(cb: (d: FileDiagnostics) => void): () => void
    onStatus(cb: (s: LspStatus) => void): () => void
  }
  /** Plugin di linguaggio (X1–X9). */
  plugins: {
    list(): Promise<InstalledPlugin[]>
    languages(): Promise<PluginLanguageInfo[]>
    /** Sceglie un file .ccplugin e ne prepara l'anteprima (nessuna installazione). */
    pick(): Promise<{ ok: boolean; preview?: PluginPreview; error?: string } | null>
    previewFile(file: string): Promise<{ ok: boolean; preview?: PluginPreview; error?: string }>
    cancel(token: string): Promise<void>
    install(token: string): Promise<{ ok: boolean; error?: string }>
    setEnabled(id: string, enabled: boolean): Promise<void>
    uninstall(id: string): Promise<{ ok: boolean; error?: string }>
    onChanged(cb: (list: InstalledPlugin[], languages: PluginLanguageInfo[]) => void): () => void
    onProgress(cb: (p: PluginInstallProgress) => void): () => void
  }  /** Permessi di Claude Code nei tre file di impostazioni (P1–P6). */
  permissions: {
    /** Legge i tre ambiti e inizia a osservarne i file (una cartella di progetto alla volta). */
    read(cwd: string): Promise<PermissionsState | null>
    save(cwd: string, scope: PermissionScope, data: ScopeData): Promise<SaveResult>
    onExternalChange(cb: (change: ExternalChange) => void): () => void
  }
  /** Versione dell'app e aggiornamenti automatici (fase 8). */
  updates: {
    info(): Promise<AppInfo>
    status(): Promise<UpdateStatus>
    /** Controlla subito se c'è una versione nuova. */
    check(): Promise<UpdateStatus>
    /** Chiude l'app e installa la versione scaricata. */
    install(): Promise<void>
    onStatus(cb: (s: UpdateStatus) => void): () => void
  }
  /** Impostazioni dell'app, salvate come JSON. */
  settings: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
  }
  /** Sessioni di terminale (requisiti §3). I processi vivono nel processo principale. */
  sessions: {
    list(): Promise<SessionInfo[]>
    create(req: CreateSessionRequest): Promise<SessionInfo>
    /** Collega una vista: restituisce l'istantanea dello schermo, oppure null se la sessione non esiste più. */
    attach(sessionId: string, viewId: string): Promise<SessionSnapshot | null>
    detach(sessionId: string, viewId: string): void
    input(sessionId: string, viewId: string, data: string): void
    resize(sessionId: string, viewId: string, cols: number, rows: number, claim: boolean): void
    setModel(sessionId: string, model: ClaudeModel, effort: ClaudeEffort): Promise<void>
    kill(sessionId: string): Promise<void>
    onChanged(cb: (sessions: SessionInfo[]) => void): () => void
    onData(cb: (sessionId: string, seq: number, data: string) => void): () => void
    onResize(cb: (sessionId: string, cols: number, rows: number) => void): () => void
    onExit(cb: (sessionId: string, exitCode: number) => void): () => void
    /** S7: una sessione ha finito, chiede un permesso o aspetta una risposta. */
    onAttention(cb: (a: SessionAttention) => void): () => void
    /** Clic su una notifica di Windows: mostrare la sessione. */
    onReveal(cb: (sessionId: string) => void): () => void
  }
  env: {
    claudeCli(refresh?: boolean): Promise<ClaudeCliInfo>
    shells(): Promise<ShellInfo[]>
    resumable(cwd: string): Promise<ResumableSession[]>
    projectPrefs(cwd: string): Promise<ProjectPrefs | null>
    recentProjects(): Promise<ProjectPrefs[]>
    saveProjectPrefs(p: Omit<ProjectPrefs, 'updatedAt'>): Promise<void>
    pickFolder(defaultPath?: string, title?: string): Promise<string | null>
    homeDir(): Promise<string>
    /** Cosa c'è a quel percorso: cartella, file, niente, oppure percorso non valido (non assoluto). */
    pathStatus(path: string): Promise<'dir' | 'file' | 'missing' | 'invalid'>
    /** Crea la cartella (e quelle che mancano sopra), per un progetto nuovo. */
    createFolder(path: string): Promise<{ ok: boolean; error?: string }>
  }
}
