import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Evento ricevuto da un hook di Claude Code (corpo JSON inviato in POST). */
export interface HookEvent {
  hook_event_name: string
  session_id?: string
  cwd?: string
  notification_type?: string
  message?: string
  source?: string
  tool_name?: string
  last_assistant_message?: string
  [key: string]: unknown
}

/** Dati che Claude Code passa alla status line (sottoinsieme che usiamo). */
export interface StatusLinePayload {
  session_id?: string
  model?: { id?: string; display_name?: string }
  effort?: { level?: string }
  context_window?: { used_percentage?: number; context_window_size?: number; total_input_tokens?: number }
  cost?: { total_cost_usd?: number }
  rate_limits?: { five_hour?: { used_percentage?: number; resets_at?: number }; seven_day?: { used_percentage?: number; resets_at?: number } }
  [key: string]: unknown
}

type Handler = {
  /** Può restituire un oggetto JSON come risposta all'hook (es. additionalContext per UserPromptSubmit). */
  onHook(appSessionId: string, event: HookEvent): Record<string, unknown> | void
  onStatusLine(appSessionId: string, payload: StatusLinePayload): void
}

const MAX_BODY = 1024 * 1024

/**
 * Piccolo server HTTP su 127.0.0.1 che riceve gli hook HTTP di Claude Code e i dati della status line.
 * Ogni avvio dell'app usa una porta e un token casuali: le richieste senza token vengono rifiutate.
 */
export class HookServer {
  private server: Server | null = null
  private port = 0
  private readonly token = randomBytes(18).toString('hex')

  constructor(private readonly handler: Handler) {}

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const match = /^\/(hook|status)\/([0-9a-f-]{36})$/.exec(url.pathname)
      if (req.method !== 'POST' || !match || url.searchParams.get('t') !== this.token) {
        res.writeHead(404).end()
        return
      }
      const [, kind, appSessionId] = match
      let size = 0
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_BODY) req.destroy()
        else chunks.push(c)
      })
      req.on('end', () => {
        let body: unknown = null
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          // corpo non valido: si ignora
        }
        let reply: Record<string, unknown> | void = undefined
        try {
          if (body && typeof body === 'object') {
            if (kind === 'hook') reply = this.handler.onHook(appSessionId, body as HookEvent)
            else this.handler.onStatusLine(appSessionId, body as StatusLinePayload)
          }
        } catch (err) {
          console.error('Errore nella gestione di un hook', err)
        } finally {
          // Risposta vuota: per gli hook significa «nessuna decisione», per la status line «niente da mostrare».
          if (reply) res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply))
          else res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('')
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', () => resolve())
    })
    this.port = (this.server.address() as AddressInfo).port
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  private url(kind: 'hook' | 'status', appSessionId: string): string {
    return `http://127.0.0.1:${this.port}/${kind}/${appSessionId}?t=${this.token}`
  }

  /**
   * Impostazioni passate a Claude Code con `--settings` per una sessione aperta dall'app.
   * Non toccano i file settings.json dell'utente o del progetto.
   */
  claudeSettings(appSessionId: string): Record<string, unknown> {
    if (!this.port) return {}
    const http = (timeout = 5) => [{ type: 'http', url: this.url('hook', appSessionId), timeout }]
    const events = [
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'PermissionRequest',
      'Notification',
      'Stop',
      'StopFailure',
      'SubagentStop',
      'PostModelSwitch',
      'SessionEnd'
    ]
    const hooks: Record<string, unknown> = {}
    for (const e of events) hooks[e] = [{ hooks: http() }]
    return {
      hooks,
      // La status line inoltra a noi i dati di sessione (modello, effort, contesto, limiti) con curl: `curl.exe` è incluso
      // in Windows, su Linux e macOS è `curl`.
      statusLine: {
        type: 'command',
        command: `${process.platform === 'win32' ? 'curl.exe' : 'curl'} -s -m 3 -X POST -H "Content-Type: application/json" --data-binary @- "${this.url('status', appSessionId)}"`
      }
    }
  }
}
