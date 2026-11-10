/** Vista grafica della conversazione («bridge»): messaggi ricavati dal file di trascrizione di Claude Code. */
export type ChatItem =
  | { id: string; kind: 'user'; text: string; ts?: string }
  | { id: string; kind: 'assistant'; text: string; ts?: string; model?: string }
  | { id: string; kind: 'tool'; name: string; summary: string; input: string; result?: string; isError?: boolean; ts?: string; edits?: FileEdit[]; questions?: AskQuestion[] }

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
  if ((o.type !== 'user' && o.type !== 'assistant') || o.isSidechain === true || o.isMeta === true) return []
  const msg = o.message as { content?: unknown; model?: unknown } | undefined
  if (!msg) return []
  const uuid = typeof o.uuid === 'string' ? o.uuid : String(Math.random())
  const ts = typeof o.timestamp === 'string' ? o.timestamp : undefined
  const blocks: unknown[] = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : Array.isArray(msg.content) ? msg.content : []
  const out: ChatItem[] = []
  blocks.forEach((raw, i) => {
    const b = raw as Record<string, unknown>
    const id = `${uuid}:${i}`
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      if (o.type === 'user') {
        if (!isNoise(b.text)) out.push({ id, kind: 'user', text: b.text, ts })
      } else out.push({ id, kind: 'assistant', text: b.text, ts, model: typeof msg.model === 'string' ? msg.model : undefined })
    } else if (b.type === 'tool_use' && typeof b.id === 'string') {
      const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>
      const name = typeof b.name === 'string' ? b.name : 'Strumento'
      const item = { id, kind: 'tool' as const, name, summary: summarize(name, input), input: clip(JSON.stringify(input, null, 2), MAX_INPUT), ts, edits: editsOf(name, input), questions: questionsOf(name, input) }
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
  return out
}
