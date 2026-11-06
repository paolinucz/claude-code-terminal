// Tipi condivisi tra processo principale, preload e interfaccia.

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
}
