// Tipi condivisi tra processo principale, preload e interfaccia.
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
    pickFolder(defaultPath?: string): Promise<string | null>
    homeDir(): Promise<string>
  }
}
