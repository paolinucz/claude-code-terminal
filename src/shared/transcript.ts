/** Vista grafica della conversazione («bridge»): messaggi ricavati dal file di trascrizione di Claude Code. */

/** Consumi di un messaggio di Claude (campo `usage` della trascrizione). */
export interface ChatUsage {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

/** Immagine allegata a un messaggio dell'utente. `data` (base64) manca se è troppo grande per passare dall'IPC. */
export interface ChatImage {
  mediaType: string
  data?: string
}

/** Voce della lista di cose da fare di Claude (strumento TodoWrite). */
export interface TodoEntry {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  /** Forma «in corso» (es. «Scrivo i test»): si mostra mentre la voce è attiva. */
  activeForm?: string
}

type Assistantish = { msgId?: string; usage?: ChatUsage }

export type ChatItem =
  | { id: string; kind: 'user'; text: string; ts?: string; images?: ChatImage[] }
  | ({ id: string; kind: 'assistant'; text: string; ts?: string; model?: string } & Assistantish)
  /** Ragionamento di Claude («thinking»): si mostra ripiegato. */
  | ({ id: string; kind: 'thinking'; text: string; ts?: string } & Assistantish)
  /** Eventi della conversazione che non sono messaggi: interruzioni, compattazione, errori dell'API, comandi con la barra. */
  | { id: string; kind: 'system'; sub: 'interrupted' | 'compact' | 'error' | 'command'; text: string; ts?: string }
  | ({
      id: string
      kind: 'tool'
      name: string
      summary: string
      input: string
      /** Parametri testuali della chiamata (comando, percorso, pattern…), già accorciati: la scheda dello strumento li legge da qui. */
      args?: Record<string, string>
      result?: string
      isError?: boolean
      ts?: string
      edits?: FileEdit[]
      questions?: AskQuestion[]
      todos?: TodoEntry[]
      /** Piano proposto da Claude (strumento ExitPlanMode), in Markdown. */
      plan?: string
    } & Assistantish)

/** Parte di un file cambiata da Edit, MultiEdit o Write (per mostrare il diff nella conversazione). Per Write `old` è vuoto. */
export interface FileEdit {
  file: string
  old: string
  new: string
}

/** Domanda interattiva di Claude (strumento AskUserQuestion): scelte tra opzioni. */
export interface AskQuestion {
  question: string
  header?: string
  multiSelect: boolean
  options: { label: string; description?: string }[]
}

export interface TranscriptUpdate {
  sessionId: string
  items: ChatItem[]
}

const MAX_RESULT = 6000
const MAX_INPUT = 4000
const MAX_ARG = 2000
/** Oltre questa dimensione (base64) un'immagine non viaggia verso l'interfaccia: resta il segnaposto. */
const MAX_IMAGE = 1_500_000

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '\n[… tagliato …]' : s)

/** Una riga che ha senso come riga di breve descrizione di una chiamata a uno strumento. */
function summarize(name: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const first = (...keys: string[]) => keys.map(str).find(Boolean) ?? ''
  const text =
    name === 'Bash'
      ? first('description', 'command')
      : first('file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt', 'command') ||
        Object.values(input).find((v): v is string => typeof v === 'string') ||
        ''
  return text.replace(/\s+/g, ' ').slice(0, 160)
}

/** Parametri testuali (e numeri) di una chiamata, per le schede degli strumenti. */
function argsOf(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') out[k] = clip(v, MAX_ARG)
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
  }
  return out
}

/** Modifiche ai file di una chiamata a Edit, MultiEdit o Write. */
function editsOf(name: string, input: Record<string, unknown>): FileEdit[] | undefined {
  const s = (v: unknown) => (typeof v === 'string' ? clip(v, 4000) : '')
  const file = s(input.file_path)
  if (!file) return undefined
  if (name === 'Edit') return [{ file, old: s(input.old_string), new: s(input.new_string) }]
  if (name === 'Write') return [{ file, old: '', new: s(input.content) }]
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    return input.edits.slice(0, 20).map((e) => ({ file, old: s((e as Record<string, unknown>).old_string), new: s((e as Record<string, unknown>).new_string) }))
  }
  return undefined
}

/** Domande di una chiamata ad AskUserQuestion. */
function questionsOf(name: string, input: Record<string, unknown>): AskQuestion[] | undefined {
  if (name !== 'AskUserQuestion' || !Array.isArray(input.questions)) return undefined
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  const out = input.questions
    .map((q) => q as Record<string, unknown>)
    .filter((q) => typeof q.question === 'string' && Array.isArray(q.options))
    .map((q) => ({
      question: s(q.question),
      header: s(q.header) || undefined,
      multiSelect: q.multiSelect === true,
      options: (q.options as Record<string, unknown>[]).map((o) => ({ label: s(o.label), description: s(o.description) || undefined }))
    }))
  return out.length ? out : undefined
}

/** Lista di cose da fare di una chiamata a TodoWrite. */
function todosOf(name: string, input: Record<string, unknown>): TodoEntry[] | undefined {
  if (name !== 'TodoWrite' || !Array.isArray(input.todos)) return undefined
  const out: TodoEntry[] = []
  for (const raw of input.todos.slice(0, 60)) {
    const t = raw as Record<string, unknown>
    if (typeof t.content !== 'string') continue
    const status = t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending'
    out.push({ content: clip(t.content, 300), status, activeForm: typeof t.activeForm === 'string' ? clip(t.activeForm, 300) : undefined })
  }
  return out.length ? out : undefined
}

const toText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** Testi che Claude Code mette tra i messaggi dell'utente ma che l'utente non ha scritto. */
const isNoise = (t: string) => /^\s*<(command-|local-command|system-reminder|bash-|task-notification)/.test(t) || t.startsWith('Caveat:')

/** «/effort low» da un messaggio con `<command-name>`; `null` se non è un comando. */
function commandOf(text: string): string | null {
  const name = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(text)?.[1]
  if (!name) return null
  const args = /<command-args>\s*([\s\S]*?)\s*<\/command-args>/.exec(text)?.[1]
  return args ? `${name} ${args}` : name
}

function usageOf(u: unknown): ChatUsage | undefined {
  if (!u || typeof u !== 'object') return undefined
  const o = u as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return { input: n(o.input_tokens), output: n(o.output_tokens), cacheRead: n(o.cache_read_input_tokens) || undefined, cacheWrite: n(o.cache_creation_input_tokens) || undefined }
}

/**
 * Trasforma una riga JSONL della trascrizione in elementi della conversazione. `tools` ricorda a quale elemento
 * appartiene ogni `tool_use_id`, per attaccare l'esito alla chiamata: restituisce anche gli elementi aggiornati.
 */
export function parseTranscriptLine(line: string, tools: Map<string, ChatItem & { kind: 'tool' }>): ChatItem[] {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(line) as Record<string, unknown>
  } catch {
    return []
  }
  if ((o.type !== 'user' && o.type !== 'assistant') || o.isSidechain === true) return []
  const msg = o.message as { content?: unknown; model?: unknown; id?: unknown; usage?: unknown } | undefined
  if (!msg) return []
  const uuid = typeof o.uuid === 'string' ? o.uuid : String(Math.random())
  const ts = typeof o.timestamp === 'string' ? o.timestamp : undefined

  // Compattazione del contesto: il riassunto che Claude Code mette al posto della conversazione vecchia.
  if (o.type === 'user' && o.isCompactSummary === true) {
    return [{ id: `${uuid}:compact`, kind: 'system', sub: 'compact', text: clip(toText(msg.content), 3000), ts }]
  }
  if (o.isMeta === true) return []
  // Errore dell'API (limiti, rete…): un messaggio «sintetico» di Claude Code, non una risposta del modello.
  if (o.type === 'assistant' && o.isApiErrorMessage === true) {
    return [{ id: `${uuid}:error`, kind: 'system', sub: 'error', text: clip(toText(msg.content), 1500) || 'Errore dell\'API', ts }]
  }

  const blocks: unknown[] = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : Array.isArray(msg.content) ? msg.content : []
  const msgId = typeof msg.id === 'string' ? msg.id : undefined
  const usage = o.type === 'assistant' ? usageOf(msg.usage) : undefined
  const out: ChatItem[] = []
  const images: ChatImage[] = []
  blocks.forEach((raw, i) => {
    const b = raw as Record<string, unknown>
    const id = `${uuid}:${i}`
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      if (o.type === 'user') {
        const interrupted = /^\s*\[Request interrupted by user/.exec(b.text)
        const command = commandOf(b.text)
        if (interrupted) {
          out.push({ id, kind: 'system', sub: 'interrupted', text: /for tool use/.test(b.text) ? 'Interrotto dall\'utente durante uno strumento' : 'Interrotto dall\'utente', ts })
        } else if (command) out.push({ id, kind: 'system', sub: 'command', text: command, ts })
        else if (!isNoise(b.text)) out.push({ id, kind: 'user', text: b.text, ts })
      } else out.push({ id, kind: 'assistant', text: b.text, ts, model: typeof msg.model === 'string' ? msg.model : undefined, msgId, usage })
    } else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) {
      out.push({ id, kind: 'thinking', text: clip(b.thinking, 8000), ts, msgId, usage })
    } else if (b.type === 'image' && o.type === 'user') {
      const src = b.source as { type?: unknown; media_type?: unknown; data?: unknown } | undefined
      const mediaType = typeof src?.media_type === 'string' ? src.media_type : 'image/png'
      images.push({ mediaType, data: src?.type === 'base64' && typeof src.data === 'string' && src.data.length <= MAX_IMAGE ? src.data : undefined })
    } else if (b.type === 'tool_use' && typeof b.id === 'string') {
      const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>
      const name = typeof b.name === 'string' ? b.name : 'Strumento'
      const plan = name === 'ExitPlanMode' && typeof input.plan === 'string' ? clip(input.plan, 12000) : undefined
      const item = {
        id,
        kind: 'tool' as const,
        name,
        summary: summarize(name, input),
        input: clip(JSON.stringify(input, null, 2), MAX_INPUT),
        args: argsOf(input),
        ts,
        edits: editsOf(name, input),
        questions: questionsOf(name, input),
        todos: todosOf(name, input),
        plan,
        msgId,
        usage
      }
      tools.set(b.id, item)
      out.push(item)
    } else if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
      const item = tools.get(b.tool_use_id)
      if (item) {
        item.result = clip(toText(b.content), MAX_RESULT)
        item.isError = b.is_error === true
        out.push({ ...item })
      }
    }
  })
  // Le immagini stanno con il testo dello stesso messaggio; se c'è solo l'immagine, un messaggio vuoto che la porta.
  if (images.length) {
    const user = out.find((x): x is ChatItem & { kind: 'user' } => x.kind === 'user')
    if (user) user.images = images
    else out.unshift({ id: `${uuid}:img`, kind: 'user', text: '', ts, images })
  }
  return out
}
