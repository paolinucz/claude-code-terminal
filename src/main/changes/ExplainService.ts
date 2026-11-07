import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { relative } from 'node:path'
import { createTwoFilesPatch, structuredPatch } from 'diff'
import type { ChangeContents } from '@shared/changes'
import { EXPLAIN_MODEL, type ExplainResult } from '@shared/explain'
import type { AppDb } from '../db'
import { findClaudeCli } from '../sessions/environment'

/** Sale quando cambiano le istruzioni: le spiegazioni già salvate con quelle vecchie non valgono più. */
const PROMPT_VERSION = 1
/** Oltre questa dimensione il diff si taglia: la spiegazione resta economica. */
const MAX_DIFF_CHARS = 30_000
const MAX_OUTPUT_BYTES = 500_000
const TIMEOUT_MS = 120_000
/** Quante pagine tenere in memoria per l'iframe. */
const MAX_SERVED = 60

/** Istruzioni per il modello: HTML breve e autonomo, tema scuro dell'app, nessuna risorsa esterna (O3, O7). */
const SYSTEM_PROMPT = `Spieghi a una persona, in modo visivo, una modifica al codice scritta da un altro assistente: serve a decidere se approvarla.
Ricevi il diff di un solo file. Rispondi con UN SOLO documento HTML completo (da <!doctype html> a </html>).
Regole:
- Solo il documento HTML: nessun testo fuori, nessun blocco markdown.
- CSS e JavaScript stanno nello stesso file. Nessuna risorsa esterna: niente librerie, font, immagini, rete.
- Lingua: italiano. Pagina breve (circa 6 KB al massimo): cosa cambia in 2-4 frasi, perché conta, cosa controllare. Evidenzia le righe chiave del diff.
- Animazioni leggere in CSS solo se aiutano a capire. JavaScript solo per interazioni semplici, per esempio mostrare o nascondere il dettaglio di un blocco.
- Tema scuro con questi colori: sfondo #09090b, pannelli #18181b, bordi #27272a, testo #fafafa, testo secondario #a1a1aa, accento #e8875f, aggiunte #6fd39b, rimozioni #ff8a8a, avvisi #f5c46b. Font di sistema, e monospazio per il codice.`

/** Politica dell'iframe (O4): niente rete, niente frame, niente moduli; solo il suo stesso codice incorporato. */
export const EXPLAIN_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"

interface Running {
  child: ChildProcessWithoutNullStreams
  cancelled: boolean
}

/**
 * Output smart (O1–O8): la spiegazione delle modifiche di Claude la scrive il modello più economico (Haiku) con
 * `claude -p`, usando il login già attivo dell'utente. L'app non legge né salva credenziali. Il risultato è una pagina
 * HTML che si mostra in un iframe isolato e si conserva legata all'hash del diff, così riaprirla non consuma token.
 */
export class ExplainService {
  private readonly running = new Map<string, Running>()
  /** Pagine pronte per l'iframe, per indirizzo. */
  private readonly served = new Map<string, string>()

  constructor(
    private readonly db: AppDb,
    private readonly workDir: string
  ) {}

  /** Pagina da servire a `app://explain/<token>`, o `undefined` se non esiste. */
  page(token: string): string | undefined {
    return this.served.get(token)
  }

  private serve(html: string): string {
    const token = randomUUID()
    this.served.set(token, html)
    while (this.served.size > MAX_SERVED) this.served.delete(this.served.keys().next().value as string)
    return token
  }

  /** Il diff che si manda al modello, tagliato se troppo lungo. */
  private diffOf(c: ChangeContents): string {
    const name = relative(c.change.cwd, c.change.filePath) || c.change.filePath
    const patch = createTwoFilesPatch(name, name, c.before ?? '', c.after ?? '', '', '', { context: 3 })
    return patch.length > MAX_DIFF_CHARS ? patch.slice(0, MAX_DIFF_CHARS) + '\n[… diff tagliato: troppo lungo …]\n' : patch
  }

  private keyOf(diff: string): string {
    return createHash('sha256').update(`${PROMPT_VERSION}\n${EXPLAIN_MODEL}\n${diff}`).digest('hex')
  }

  /** La spiegazione già generata per questa modifica, se c'è: non chiama il modello. */
  peek(contents: ChangeContents | null): ExplainResult | null {
    if (!contents || contents.binary) return null
    const hit = this.db.getExplanation(this.keyOf(this.diffOf(contents)))
    return hit ? { ok: true, kind: 'html', token: this.serve(hit.html), cached: true, ...(hit.costUsd !== null ? { costUsd: hit.costUsd } : {}) } : null
  }

  cancel(requestId: string): void {
    const r = this.running.get(requestId)
    if (!r) return
    r.cancelled = true
    r.child.kill()
  }

  /** Genera la spiegazione (solo a richiesta dell'utente). `force` ignora quella salvata («Rigenera»). */
  async run(requestId: string, contents: ChangeContents | null, force: boolean): Promise<ExplainResult> {
    if (!contents) return { ok: false, error: 'Modifica non trovata.' }
    if (contents.binary || contents.after === null) return { ok: false, error: 'File binario o troppo grande: non si può spiegare.' }
    const diff = this.diffOf(contents)
    const key = this.keyOf(diff)

    if (!force) {
      const hit = this.db.getExplanation(key)
      if (hit) return { ok: true, kind: 'html', token: this.serve(hit.html), cached: true, ...(hit.costUsd !== null ? { costUsd: hit.costUsd } : {}) }
    }

    const cli = await findClaudeCli()
    if (!cli.path) return this.fallback(contents, 'Claude Code non trovato: installalo o aggiungilo al PATH.')

    const name = relative(contents.change.cwd, contents.change.filePath) || contents.change.filePath
    const prompt = `File: ${name}\nStato: ${contents.change.created ? 'file nuovo' : 'file modificato'}\n\n${diff}`

    mkdirSync(this.workDir, { recursive: true })
    // Un solo turno, senza strumenti, senza sessione salvata, senza MCP né comandi: solo testo dentro e HTML fuori.
    // `--setting-sources project` non carica le impostazioni dell'utente (hook compresi). Cartella di lavoro vuota.
    const args = [
      '-p',
      '--model', EXPLAIN_MODEL,
      '--tools', '',
      '--no-session-persistence',
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--setting-sources', 'project',
      '--output-format', 'json',
      '--system-prompt', SYSTEM_PROMPT
    ]

    const out = await this.exec(requestId, cli.path, args, prompt)
    if (out.cancelled) return { ok: false, error: 'Generazione annullata.', cancelled: true }
    if (out.error) return this.fallback(contents, out.error)

    let parsed: { result?: unknown; is_error?: unknown; total_cost_usd?: unknown }
    try {
      parsed = JSON.parse(out.stdout) as typeof parsed
    } catch {
      return this.fallback(contents, 'Risposta di Claude Code non leggibile.')
    }
    if (parsed.is_error === true) {
      return this.fallback(contents, typeof parsed.result === 'string' && parsed.result ? parsed.result : 'Claude Code ha restituito un errore.')
    }
    const html = extractHtml(typeof parsed.result === 'string' ? parsed.result : '')
    if (!html) return this.fallback(contents, 'Il modello non ha restituito una pagina HTML valida.')

    const cost = typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null
    this.db.putExplanation(key, html, cost)
    return { ok: true, kind: 'html', token: this.serve(html), cached: false, ...(cost !== null ? { costUsd: cost } : {}) }
  }

  /** Lancia `claude -p` con il testo su stdin (la riga di comando di Windows ha un limite) e raccoglie l'output. */
  private exec(
    requestId: string,
    file: string,
    args: string[],
    input: string
  ): Promise<{ stdout: string; error?: string; cancelled?: boolean }> {
    return new Promise((resolve) => {
      const child = spawn(file, args, { cwd: this.workDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      const state: Running = { child, cancelled: false }
      this.running.set(requestId, state)
      let stdout = ''
      let stderr = ''
      let size = 0
      let settled = false
      const finish = (r: { stdout: string; error?: string; cancelled?: boolean }) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.running.delete(requestId)
        resolve(r)
      }
      const timer = setTimeout(() => {
        child.kill()
        finish({ stdout, error: 'La generazione ha impiegato troppo tempo.' })
      }, TIMEOUT_MS)

      child.stdout.on('data', (d: Buffer) => {
        size += d.length
        if (size > MAX_OUTPUT_BYTES) {
          child.kill()
          finish({ stdout, error: 'La risposta è troppo lunga.' })
          return
        }
        stdout += d.toString('utf8')
      })
      child.stderr.on('data', (d: Buffer) => {
        if (stderr.length < 4000) stderr += d.toString('utf8')
      })
      child.on('error', (err) => finish({ stdout, error: `Impossibile avviare Claude Code: ${err.message}` }))
      child.on('close', (code) => {
        if (state.cancelled) return finish({ stdout, cancelled: true })
        if (code !== 0 && !stdout.trim()) return finish({ stdout, error: stderr.trim() || `Claude Code è terminato con codice ${code}.` })
        finish({ stdout })
      })
      child.stdin.on('error', () => {
        // Il processo si è chiuso prima di leggere tutto: l'esito lo decide «close».
      })
      child.stdin.end(input)
    })
  }

  /** Riepilogo in testo semplice, senza modello, quando la spiegazione smart non è disponibile (O6). */
  private fallback(c: ChangeContents, warning: string): ExplainResult {
    const name = relative(c.change.cwd, c.change.filePath) || c.change.filePath
    const patch = structuredPatch(name, name, c.before ?? '', c.after ?? '', '', '', { context: 0 })
    const lines = [
      `${name}: ${c.change.created ? 'file nuovo' : 'file modificato'}, +${c.change.added} −${c.change.removed} righe in ${patch.hunks.length} ${patch.hunks.length === 1 ? 'punto' : 'punti'}.`,
      ...patch.hunks.slice(0, 12).map((h) => {
        const to = h.newStart + Math.max(h.newLines - 1, 0)
        const where = h.newLines === 0 ? `dopo la riga ${h.newStart}` : h.newStart === to ? `riga ${h.newStart}` : `righe ${h.newStart}–${to}`
        return `• ${where}: −${h.oldLines} +${h.newLines}`
      })
    ]
    if (patch.hunks.length > 12) lines.push(`• … e altri ${patch.hunks.length - 12} punti`)
    return { ok: true, kind: 'text', text: lines.join('\n'), warning }
  }
}

/** Estrae il documento HTML dalla risposta (il modello a volte aggiunge un recinto markdown). Null se non c'è. */
export function extractHtml(text: string): string | null {
  const start = text.search(/<!doctype html|<html[\s>]/i)
  const end = text.toLowerCase().lastIndexOf('</html>')
  if (start < 0 || end < start) return null
  return text.slice(start, end + '</html>'.length)
}
