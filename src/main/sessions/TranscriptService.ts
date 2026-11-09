import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseTranscriptLine, type ChatItem, type TranscriptUpdate } from '@shared/transcript'
import { projectDir } from './history'

/** Di un file molto lungo si legge solo la parte finale. */
const MAX_INITIAL_BYTES = 6 * 1024 * 1024
const POLL_MS = 600

interface Watch {
  resolve(): string | null
  path: string | null
  offset: number
  rest: string
  tools: Map<string, ChatItem & { kind: 'tool' }>
  views: number
  timer?: NodeJS.Timeout
}

/**
 * Vista grafica della conversazione: legge il file di trascrizione che Claude Code già scrive
 * (`~/.claude/projects/<cartella>/<sessione>.jsonl`) e manda alla finestra i messaggi nuovi.
 * Sola lettura del file locale: non usa rete né credenziali.
 */
export class TranscriptService {
  private readonly watches = new Map<string, Watch>()

  constructor(private readonly emit: (update: TranscriptUpdate) => void) {}

  /** File di trascrizione di una sessione dell'app, dalla cartella e dall'id di Claude Code. */
  static pathOf(cwd: string, claudeSessionId?: string): string | null {
    return claudeSessionId ? join(projectDir(cwd), `${claudeSessionId}.jsonl`) : null
  }

  /** Inizia a seguire la sessione e restituisce la conversazione fin qui. */
  open(sessionId: string, resolve: () => string | null): ChatItem[] {
    let w = this.watches.get(sessionId)
    if (w) {
      w.views++
      // Nuova vista: rilegge da capo, la vista nuova è vuota.
      w.path = null
      w.offset = 0
      w.rest = ''
      w.tools.clear()
      return this.read(w)
    }
    w = { resolve, path: null, offset: 0, rest: '', tools: new Map(), views: 1 }
    this.watches.set(sessionId, w)
    const items = this.read(w)
    // Un timer invece di watchFile: il percorso può cambiare (resume) e il file può non esistere ancora.
    const timer = setInterval(() => {
      const cur = this.watches.get(sessionId)
      if (!cur) return clearInterval(timer)
      const added = this.read(cur)
      if (added.length) this.emit({ sessionId, items: added })
    }, POLL_MS)
    w.timer = timer
    return items
  }

  close(sessionId: string): void {
    const w = this.watches.get(sessionId)
    if (!w) return
    if (--w.views > 0) return
    if (w.timer) clearInterval(w.timer)
    this.watches.delete(sessionId)
  }

  dispose(): void {
    for (const w of this.watches.values()) if (w.timer) clearInterval(w.timer)
    this.watches.clear()
  }

  /** Legge ciò che è stato aggiunto al file dall'ultima volta. */
  private read(w: Watch): ChatItem[] {
    const path = w.resolve()
    if (!path || !existsSync(path)) return []
    if (path !== w.path) {
      w.path = path
      w.offset = 0
      w.rest = ''
      w.tools.clear()
    }
    let size: number
    try {
      size = statSync(path).size
    } catch {
      return []
    }
    if (size < w.offset) {
      w.offset = 0
      w.rest = ''
      w.tools.clear()
    }
    if (w.offset === 0 && size > MAX_INITIAL_BYTES) {
      w.offset = size - MAX_INITIAL_BYTES
      w.rest = '\u0000skip'
    }
    if (size === w.offset) return []
    const buf = Buffer.alloc(size - w.offset)
    let fd = -1
    try {
      fd = openSync(path, 'r')
      readSync(fd, buf, 0, buf.length, w.offset)
    } catch {
      return []
    } finally {
      if (fd >= 0) closeSync(fd)
    }
    w.offset = size
    const text = (w.rest.startsWith('\u0000skip') ? '' : w.rest) + buf.toString('utf8')
    const skipFirst = w.rest.startsWith('\u0000skip')
    const lines = text.split('\n')
    w.rest = lines.pop() ?? ''
    if (skipFirst) lines.shift()
    const out: ChatItem[] = []
    for (const line of lines) if (line.trim()) out.push(...parseTranscriptLine(line, w.tools))
    return out
  }
}
