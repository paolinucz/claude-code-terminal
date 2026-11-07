import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/updates'

/** Primo controllo poco dopo l'avvio, poi a intervalli regolari. */
const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/**
 * Aggiornamenti automatici (fase 8) da GitHub Releases, con electron-updater.
 * La versione nuova si scarica in background e si installa alla chiusura dell'app; l'utente può
 * anche riavviare subito. Dai sorgenti (npm run dev / start) è spento, a meno di indicare un file
 * di configurazione di prova in CCT_UPDATE_DEV_CONFIG.
 */
export class Updater {
  private status: UpdateStatus = { state: 'idle' }
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly onStatus: (s: UpdateStatus) => void) {}

  get current(): UpdateStatus {
    return this.status
  }

  start(): void {
    const devConfig = process.env.CCT_UPDATE_DEV_CONFIG
    if (!app.isPackaged && !devConfig) {
      this.set({ state: 'disabled', reason: 'Gli aggiornamenti funzionano solo nell\'app installata.' })
      return
    }
    if (devConfig) {
      autoUpdater.forceDevUpdateConfig = true
      autoUpdater.updateConfigPath = devConfig
    }
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'none', checkedAt: new Date().toISOString() }))
    autoUpdater.on('update-available', (info) => this.set({ state: 'downloading', version: info.version, percent: 0 }))
    autoUpdater.on('download-progress', (p) => {
      const version = this.status.state === 'downloading' ? this.status.version : ''
      this.set({ state: 'downloading', version, percent: Math.round(p.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version }))
    autoUpdater.on('error', (err) => this.set({ state: 'error', message: friendly(err) }))
    setTimeout(() => void this.check(), FIRST_CHECK_MS)
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  /** Controllo manuale (palette comandi). Non riscarica se una versione è già pronta. */
  async check(): Promise<UpdateStatus> {
    if (this.status.state === 'disabled' || this.status.state === 'ready' || this.status.state === 'downloading') return this.status
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      this.set({ state: 'error', message: friendly(err) })
    }
    return this.status
  }

  /** Chiude l'app e avvia l'installazione della versione scaricata. */
  install(): void {
    if (this.status.state !== 'ready') return
    // isSilent: niente procedura guidata; isForceRunAfter: l'app si riapre da sola.
    autoUpdater.quitAndInstall(true, true)
  }

  dispose(): void {
    clearInterval(this.timer)
  }

  private set(s: UpdateStatus): void {
    this.status = s
    this.onStatus(s)
  }
}

function friendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_/i.test(msg)) return 'Impossibile raggiungere il server degli aggiornamenti (sei connesso a internet?).'
  if (/app-update\.yml|ENOENT/i.test(msg)) return 'Questa installazione non ha la configurazione degli aggiornamenti.'
  if (/404/.test(msg)) return 'Nessuna versione pubblicata trovata.'
  return msg.split('\n')[0].slice(0, 300)
}
