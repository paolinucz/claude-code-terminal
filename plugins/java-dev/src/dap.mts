import net from 'node:net'

/** Un messaggio del Debug Adapter Protocol. */
interface DapMessage {
  seq: number
  type: 'request' | 'response' | 'event'
  command?: string
  event?: string
  request_seq?: number
  success?: boolean
  message?: string
  body?: Record<string, unknown>
  arguments?: Record<string, unknown>
}

export interface DapEvent {
  event: string
  body: Record<string, unknown>
}

/**
 * Client minimo del Debug Adapter Protocol su TCP (intestazioni Content-Length, come LSP).
 * Parla con il server di debug di java-debug, avviato dentro il language server Java.
 */
export class DapClient {
  private socket: net.Socket | null = null
  private buffer = Buffer.alloc(0)
  private seq = 1
  private waiting = new Map<number, { resolve(m: DapMessage): void; reject(e: Error): void; timer: NodeJS.Timeout; command: string }>()
  private closed = false

  constructor(
    private readonly onEvent: (e: DapEvent) => void,
    private readonly onClose: () => void
  ) {}

  connect(port: number, host = '127.0.0.1', timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = net.connect({ port, host })
      const timer = setTimeout(() => {
        s.destroy()
        reject(new Error('Il server di debug non risponde.'))
      }, timeoutMs)
      s.once('connect', () => {
        clearTimeout(timer)
        this.socket = s
        resolve()
      })
      s.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      s.on('data', (d: Buffer | string) => this.onData(Buffer.isBuffer(d) ? d : Buffer.from(d)))
      s.on('close', () => this.end())
      s.on('error', () => this.end())
    })
  }

  private end(): void {
    if (this.closed) return
    this.closed = true
    for (const w of this.waiting.values()) {
      clearTimeout(w.timer)
      w.reject(new Error('Connessione di debug chiusa.'))
    }
    this.waiting.clear()
    this.onClose()
  }

  private onData(d: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, d])
    for (;;) {
      const i = this.buffer.indexOf('\r\n\r\n')
      if (i < 0) return
      const len = Number(/Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, i).toString('ascii'))?.[1] ?? 0)
      if (!len || this.buffer.length < i + 4 + len) return
      let msg: DapMessage
      try {
        msg = JSON.parse(this.buffer.subarray(i + 4, i + 4 + len).toString('utf8')) as DapMessage
      } catch {
        this.buffer = this.buffer.subarray(i + 4 + len)
        continue
      }
      this.buffer = this.buffer.subarray(i + 4 + len)
      this.handle(msg)
    }
  }

  private handle(m: DapMessage): void {
    if (m.type === 'response') {
      const w = this.waiting.get(m.request_seq ?? -1)
      if (!w) return
      this.waiting.delete(m.request_seq!)
      clearTimeout(w.timer)
      if (m.success === false) w.reject(new Error(m.message || `«${w.command}» non riuscito`))
      else w.resolve(m)
    } else if (m.type === 'event') {
      this.onEvent({ event: m.event ?? '', body: m.body ?? {} })
    } else if (m.type === 'request') {
      // Richieste dell'adapter verso il client (runInTerminal, startDebugging): non le supportiamo.
      this.write({ seq: this.seq++, type: 'response', request_seq: m.seq, success: false, command: m.command, message: 'Non supportato dal client' } as DapMessage)
    }
  }

  private write(m: Record<string, unknown> | DapMessage): void {
    const s = JSON.stringify(m)
    this.socket?.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`)
  }

  /** Invia una richiesta e aspetta il corpo della risposta. */
  request<T = Record<string, unknown>>(command: string, args: Record<string, unknown> = {}, timeoutMs = 30000): Promise<T> {
    if (this.closed || !this.socket) return Promise.reject(new Error('Debug non collegato.'))
    return new Promise((resolve, reject) => {
      const id = this.seq++
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error(`«${command}» non ha risposto in tempo.`))
      }, timeoutMs)
      this.waiting.set(id, { resolve: (m) => resolve((m.body ?? {}) as T), reject, timer, command })
      this.write({ seq: id, type: 'request', command, arguments: args })
    })
  }

  close(): void {
    this.socket?.destroy()
    this.end()
  }
}
