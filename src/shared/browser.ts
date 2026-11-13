// Browser integrato (docs/PLUGIN_API_DOCS.md §5, permesso `browser`): una vista web in un pannello, aperta e pilotata da un
// plugin. L'app non sa a cosa serva (debug frontend, anteprime…): offre navigazione e il protocollo Chrome DevTools (CDP).

/** Rettangolo della vista, in pixel dell'interfaccia (relativi alla finestra). */
export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Stato di una vista, per la barra del pannello. */
export interface BrowserState {
  /** Id completo: `<id-plugin>/<id>`. */
  id: string
  pluginId: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** Il debugger CDP è collegato (c'è un plugin che lo pilota). */
  debugging: boolean
  /** La vista è stata chiusa: il pannello si può togliere. */
  closed?: boolean
}

/** Evento riservato: l'adapter chiede di mostrare il pannello di una vista. */
export const HOST_EVENT_BROWSER = '$browser.open'

/** Messaggio dell'app all'adapter (`browser/event`): messaggio CDP, cambio di stato o chiusura della vista. */
export type BrowserEvent =
  | { id: string; type: 'cdp'; method: string; params: unknown; sessionId?: string }
  | { id: string; type: 'state'; state: BrowserState }
  | { id: string; type: 'closed' }

/** Solo indirizzi web: la vista non apre file né protocolli dell'app. */
export const isWebUrl = (url: unknown): url is string => typeof url === 'string' && url.length <= 4096 && /^https?:\/\//i.test(url)

export const BROWSER_ID_RE = /^[\w.:-]{1,60}$/

/** Pagina con cui si può aprire una vista: un indirizzo web o la pagina vuota (per accendere il debugger prima di caricare). */
export const isOpenableUrl = (url: unknown): url is string => url === 'about:blank' || isWebUrl(url)
