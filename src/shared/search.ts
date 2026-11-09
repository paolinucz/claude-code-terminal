/** Ricerca nei file del progetto (Ctrl+Maiusc+F): tipi condivisi e confronto riga per riga. */

export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  /** Glob da includere separati da virgola (es. «*.ts, src/**»). Vuoto = tutti. */
  include?: string
}

export interface SearchMatch {
  /** Riga (da 1) e colonna (da 1) dell'inizio della corrispondenza. */
  line: number
  column: number
  /** Testo della riga (tagliato) e posizione della corrispondenza dentro il testo mostrato. */
  text: string
  start: number
  end: number
}

export interface SearchFileResult {
  /** Percorso relativo alla cartella, con \ come separatore. */
  file: string
  matches: SearchMatch[]
}

export interface SearchResult {
  ok: boolean
  error?: string
  root: string
  files: SearchFileResult[]
  /** Numero totale di corrispondenze trovate. */
  total: number
  /** Ricerca interrotta ai limiti (troppi risultati o file). */
  truncated: boolean
  /** File esaminati. */
  searched: number
}

export const SEARCH_LIMITS = { matches: 2000, perFile: 200, fileBytes: 2 * 1024 * 1024, lineChars: 240 }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Espressione per la ricerca; `Error` con un messaggio comprensibile se l'espressione regolare non è valida. */
export function compileMatcher(query: string, opts: SearchOptions): RegExp {
  let source = opts.regex ? query : escapeRe(query)
  if (opts.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`
  let re: RegExp
  try {
    re = new RegExp(source, `gu${opts.caseSensitive ? '' : 'i'}`)
  } catch (e) {
    throw new Error(`Espressione regolare non valida: ${(e as Error).message.replace(/^Invalid regular expression: /, '')}`)
  }
  if (re.test('')) throw new Error("L'espressione trova anche il testo vuoto: scrivi qualcosa di più preciso.")
  re.lastIndex = 0
  return re
}

/** Tutte le corrispondenze in un testo, riga per riga. Si ferma a `limit` corrispondenze. */
export function searchText(text: string, re: RegExp, limit = SEARCH_LIMITS.perFile): SearchMatch[] {
  const out: SearchMatch[] = []
  const lines = text.split(/\r\n|\n|\r/)
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const line = lines[i]
    re.lastIndex = 0
    for (let m = re.exec(line); m && out.length < limit; m = re.exec(line)) {
      if (m[0] === '') {
        re.lastIndex++
        continue
      }
      // La riga mostrata si taglia attorno alla corrispondenza, così resta visibile.
      const from = m.index > 40 ? m.index - 40 : 0
      const prefix = from > 0 ? '…' : ''
      out.push({
        line: i + 1,
        column: m.index + 1,
        text: prefix + line.slice(from, from + SEARCH_LIMITS.lineChars),
        start: prefix.length + m.index - from,
        end: prefix.length + m.index - from + m[0].length
      })
    }
  }
  return out
}

/** Glob semplice: `*` dentro un nome, `**` attraverso le cartelle, `?` un carattere. Senza `/` vale sul nome del file. */
export function globToRegExp(glob: string): RegExp {
  const g = glob.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  const body = escapeRe(g)
    .replace(/\\\*\\\*/g, '\u0000')
    .replace(/\\\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\\\?/g, '[^/]')
  return new RegExp(g.includes('/') ? `^${body}$` : `(^|/)${body}$`, 'i')
}

/** Il file (percorso relativo con \) passa il filtro «include»? */
export function matchesInclude(rel: string, globs: RegExp[]): boolean {
  if (!globs.length) return true
  const p = rel.replace(/\\/g, '/')
  return globs.some((r) => r.test(p))
}

export function parseInclude(include: string | undefined): RegExp[] {
  return (include ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.endsWith('/') ? `${s}**` : s))
    .map(globToRegExp)
}
