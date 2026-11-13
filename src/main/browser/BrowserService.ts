import { WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import { isOpenableUrl, isWebUrl, type BrowserBounds, type BrowserEvent, type BrowserState } from '../../shared/browser'

interface Entry {
  pluginId: string
  view: WebContentsView
  bounds: BrowserBounds
  visible: boolean
  debugging: boolean
}

/**
 * Browser integrato per i plugin (permesso `browser`). Ogni vista è una `WebContentsView` della finestra principale
 * (partizione propria per plugin, senza accesso all'app né al suo preload) posizionata sopra il segnaposto del pannello.
 * L'adapter la apre e la pilota; il protocollo DevTools passa da `webContents.debugger`. L'app non sa a cosa serva.
 */
export class BrowserService {
  private views = new Map<string, Entry>()

  constructor(
    private readonly getWindow: () => BrowserWindow | undefined,
    /** Stato aggiornato (per il pannello). */
    private readonly onState: (s: BrowserState) => void,
    /** Eventi per l'adapter del plugin proprietario. */
    private readonly onEvent: (pluginId: string, e: BrowserEvent) => void
  ) {}

  private entry(id: string): Entry {
    const e = this.views.get(id)
    if (!e) throw new Error(`Browser «${id}» non aperto`)
    return e
  }

  private ownedBy(pluginId: string, id: string): Entry {
    const e = this.entry(id)
    if (e.pluginId !== pluginId) throw new Error('La vista appartiene a un altro plugin')
    return e
  }

  has(id: string): boolean {
    return this.views.has(id)
  }

  state(id: string): BrowserState | null {
    const e = this.views.get(id)
    return e ? this.snapshot(id, e) : null
  }

  private snapshot(id: string, e: Entry): BrowserState {
    const wc = e.view.webContents
    const nav = wc.navigationHistory
    return {
      id,
      pluginId: e.pluginId,
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: nav.canGoBack(),
      canGoForward: nav.canGoForward(),
      debugging: e.debugging
    }
  }

  private push(id: string): void {
    const e = this.views.get(id)
    if (!e || e.view.webContents.isDestroyed()) return
    const state = this.snapshot(id, e)
    this.onState(state)
    this.onEvent(e.pluginId, { id, type: 'state', state })
  }

  /** Crea la vista (nascosta finché il pannello non ne comunica la posizione) e apre l'indirizzo. Se esiste già, la riusa. */
  async open(pluginId: string, id: string, url: string): Promise<void> {
    if (!isOpenableUrl(url)) throw new Error('Il browser apre solo indirizzi http e https')
    const existing = this.views.get(id)
    if (existing) {
      if (existing.pluginId !== pluginId) throw new Error('La vista appartiene a un altro plugin')
      this.load(existing, url)
      return
    }
    const win = this.getWindow()
    if (!win) throw new Error('Finestra principale non disponibile')
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: `persist:cct-browser-${pluginId}` }
    })
    const entry: Entry = { pluginId, view, bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: false, debugging: false }
    this.views.set(id, entry)
    view.setVisible(false)
    view.setBackgroundColor('#ffffff')
    win.contentView.addChildView(view)

    const wc = view.webContents
    // La vista non è mai fidata: nessun permesso del sito (fotocamera, posizione, notifiche…).
    wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    wc.setWindowOpenHandler(({ url: target }) => {
      if (isWebUrl(target)) void wc.loadURL(target)
      return { action: 'deny' }
    })
    wc.on('will-navigate', (event, target) => {
      if (!isOpenableUrl(target)) event.preventDefault()
    })
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated'] as const) {
      wc.on(ev as 'did-navigate', () => this.push(id))
    }
    wc.on('destroyed', () => this.drop(id))
    this.attachDebugger(id, entry, wc)
    this.load(entry, url)
    this.push(id)
  }

  /**
   * Avvia il caricamento senza aspettarne la fine: con un debugger collegato la pagina può restare ferma su un breakpoint
   * prima del `load`, e chi ha chiesto la navigazione non deve bloccarsi.
   */
  private load(e: Entry, url: string): void {
    void e.view.webContents.loadURL(url).catch(() => {})
  }

  private attachDebugger(id: string, entry: Entry, wc: WebContents): void {
    try {
      wc.debugger.attach('1.3')
      entry.debugging = true
    } catch {
      return
    }
    wc.debugger.on('message', (_e, method, params, sessionId) => this.onEvent(entry.pluginId, { id, type: 'cdp', method, params, sessionId }))
    wc.debugger.on('detach', () => {
      entry.debugging = false
      this.push(id)
    })
  }

  /** Comando CDP (per esempio `Debugger.enable`). Solo il plugin proprietario. */
  async cdp(pluginId: string, id: string, method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    const e = this.ownedBy(pluginId, id)
    if (typeof method !== 'string' || !/^[A-Z]\w*\.\w+$/.test(method)) throw new Error(`Metodo CDP non valido: ${String(method)}`)
    if (!e.view.webContents.debugger.isAttached()) this.attachDebugger(id, e, e.view.webContents)
    return e.view.webContents.debugger.sendCommand(method, params ?? {}, sessionId)
  }

  async navigate(pluginId: string, id: string, url: string): Promise<void> {
    if (!isWebUrl(url)) throw new Error('Il browser apre solo indirizzi http e https')
    this.load(this.ownedBy(pluginId, id), url)
  }

  // ---- comandi dall'interfaccia (barra del pannello e posizione) ----

  setBounds(id: string, b: BrowserBounds): void {
    const e = this.views.get(id)
    if (!e) return
    const r = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) }
    e.bounds = r
    e.view.setBounds(r)
  }

  setVisible(id: string, visible: boolean): void {
    const e = this.views.get(id)
    if (!e) return
    e.visible = visible
    e.view.setVisible(visible)
  }

  /** Indirizzo scritto dall'utente nella barra: se manca il protocollo si assume https (http per localhost). */
  go(id: string, text: string): void {
    const e = this.views.get(id)
    if (!e) return
    const t = String(text).trim()
    if (!t) return
    const url = /^https?:\/\//i.test(t) ? t : /^(localhost|127\.|\[::1\])/i.test(t) ? `http://${t}` : `https://${t}`
    if (isWebUrl(url)) void e.view.webContents.loadURL(url).catch(() => {})
  }

  back(id: string): void {
    this.views.get(id)?.view.webContents.navigationHistory.goBack()
  }
  forward(id: string): void {
    this.views.get(id)?.view.webContents.navigationHistory.goForward()
  }
  reload(id: string): void {
    this.views.get(id)?.view.webContents.reload()
  }

  // ---- chiusura ----

  /** Chiusa dall'utente (pannello): la vista sparisce e l'adapter lo sa (`closed`). */
  closeByUser(id: string): void {
    this.destroy(id)
  }

  close(pluginId: string, id: string): void {
    const e = this.views.get(id)
    if (e && e.pluginId === pluginId) this.destroy(id)
  }

  /** Chiude le viste di un plugin (adapter fermato). */
  closeAllFor(pluginId: string): void {
    for (const [id, e] of [...this.views]) if (e.pluginId === pluginId) this.destroy(id)
  }

  dispose(): void {
    for (const id of [...this.views.keys()]) this.destroy(id)
  }

  private destroy(id: string): void {
    const e = this.views.get(id)
    if (!e) return
    this.views.delete(id)
    this.onEvent(e.pluginId, { id, type: 'closed' })
    this.onState({ id, pluginId: e.pluginId, url: '', title: '', loading: false, canGoBack: false, canGoForward: false, debugging: false, closed: true })
    const win = this.getWindow()
    const wc = e.view.webContents
    try {
      if (!wc.isDestroyed()) {
        if (wc.debugger.isAttached()) wc.debugger.detach()
        e.view.setVisible(false)
        if (win && !win.isDestroyed()) win.contentView.removeChildView(e.view)
        wc.close()
      }
    } catch {
      /* già chiusa */
    }
  }

  /** La vista è stata distrutta da sola: si toglie dall'elenco. */
  private drop(id: string): void {
    const e = this.views.get(id)
    if (!e) return
    this.views.delete(id)
    this.onEvent(e.pluginId, { id, type: 'closed' })
    this.onState({ id, pluginId: e.pluginId, url: '', title: '', loading: false, canGoBack: false, canGoForward: false, debugging: false, closed: true })
  }
}
