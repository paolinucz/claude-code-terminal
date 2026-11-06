import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { ResumableSession } from '@shared/sessions'

/** Cartella in cui Claude Code salva le sessioni di un progetto: ~/.claude/projects/<cwd con i separatori sostituiti da ->. */
export function projectDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
}

const HEAD_BYTES = 192 * 1024
const TAIL_BYTES = 96 * 1024

/**
 * Sessioni di Claude Code che si possono riprendere in una cartella (S2, S8), dalla più recente.
 * Legge solo l'inizio e la fine di ogni file: bastano per titolo, cartella e branch.
 */
export async function listResumable(cwd: string, limit = 30): Promise<ResumableSession[]> {
  const dir = projectDir(cwd)
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return []
  }
  const withTime = await Promise.all(
    files.map(async (f) => {
      try {
        return { file: join(dir, f), mtime: (await stat(join(dir, f))).mtime }
      } catch {
        return null
      }
    })
  )
  const recent = withTime
    .filter((x): x is { file: string; mtime: Date } => x !== null)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, limit)

  const out: ResumableSession[] = []
  for (const { file, mtime } of recent) {
    const parsed = await summarize(file)
    if (!parsed) continue
    out.push({
      id: basename(file, '.jsonl'),
      title: parsed.title,
      cwd: parsed.cwd ?? cwd,
      gitBranch: parsed.gitBranch,
      updatedAt: mtime.toISOString()
    })
  }
  return out
}

async function summarize(file: string): Promise<{ title: string; cwd?: string; gitBranch?: string } | null> {
  const { head, tail } = await readEnds(file)
  let customTitle: string | undefined
  let summary: string | undefined
  let firstPrompt: string | undefined
  let cwd: string | undefined
  let gitBranch: string | undefined
  let hasUserMessage = false

  const scan = (chunk: string, fromTail: boolean) => {
    const lines = chunk.split('\n')
    // Il primo e l'ultimo pezzo possono essere righe tagliate: si scartano se non sono JSON validi.
    for (const line of lines) {
      if (!line.startsWith('{')) continue
      let entry: Record<string, unknown>
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') customTitle = entry.customTitle
      if (entry.type === 'summary' && typeof entry.summary === 'string') summary = entry.summary
      if (entry.type === 'user' && !entry.isSidechain) {
        hasUserMessage = true
        if (typeof entry.cwd === 'string') cwd ??= entry.cwd
        if (typeof entry.gitBranch === 'string' && entry.gitBranch) gitBranch = fromTail ? entry.gitBranch : (gitBranch ?? entry.gitBranch)
        if (!firstPrompt && !fromTail) firstPrompt = promptText(entry.message)
      }
    }
  }
  scan(head, false)
  if (tail) scan(tail, true)
  if (!hasUserMessage) return null
  const title = (customTitle ?? summary ?? firstPrompt ?? 'Sessione senza titolo').replace(/\s+/g, ' ').trim()
  return { title: title.length > 90 ? title.slice(0, 89) + '…' : title, cwd, gitBranch }
}

function promptText(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined
  const content = (message as { content?: unknown }).content
  let text: string | undefined
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    const part = content.find((p) => p && typeof p === 'object' && (p as { type?: string }).type === 'text') as
      | { text?: string }
      | undefined
    text = part?.text
  }
  // Salta i messaggi generati (comandi slash, promemoria di sistema).
  if (!text || text.startsWith('<')) return undefined
  return text
}

async function readEnds(file: string): Promise<{ head: string; tail: string }> {
  const fh = await open(file, 'r')
  try {
    const { size } = await fh.stat()
    const headLen = Math.min(size, HEAD_BYTES)
    const headBuf = Buffer.alloc(headLen)
    await fh.read(headBuf, 0, headLen, 0)
    let tail = ''
    if (size > HEAD_BYTES) {
      const tailLen = Math.min(TAIL_BYTES, size - HEAD_BYTES)
      const tailBuf = Buffer.alloc(tailLen)
      await fh.read(tailBuf, 0, tailLen, size - tailLen)
      tail = tailBuf.toString('utf8')
    }
    return { head: headBuf.toString('utf8'), tail }
  } finally {
    await fh.close()
  }
}
