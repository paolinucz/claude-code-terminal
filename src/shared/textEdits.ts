// Modifiche di testo nel formato della CCT Plugin API (righe e colonne da 1) e rinomina di percorsi: logica pura, senza
// dipendenze, che si prova da sola con `node --experimental-strip-types`. Usata dal processo principale per applicare ai file
// le modifiche di un refactoring (docs/plugin-api.md, «refactor/willRename»).

export interface TextPosition {
  line: number
  column: number
}

export interface TextRange {
  start: TextPosition
  end: TextPosition
}

export interface TextEdit {
  range: TextRange
  newText: string
}

export interface RenameOp {
  from: string
  to: string
}

/** Offset di inizio di ogni riga (a capo `\n`, `\r\n` o `\r`), più la fine del testo. */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 10) starts.push(i + 1)
    else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i++
      starts.push(i + 1)
    }
  }
  return starts
}

/** Offset di una posizione (riga e colonna da 1), limitato alla riga: oltre la fine riga vale la fine riga. */
function offsetOf(text: string, starts: number[], p: TextPosition): number {
  if (p.line > starts.length) return text.length
  const lineIndex = Math.max(0, p.line - 1)
  const start = starts[lineIndex]
  const next = lineIndex + 1 < starts.length ? starts[lineIndex + 1] : text.length + 1
  // La riga finisce prima del suo a capo.
  let end = Math.min(next, text.length)
  while (end > start && (text[end - 1] === '\n' || text[end - 1] === '\r')) end--
  return Math.max(start, Math.min(end, start + Math.max(0, p.column - 1)))
}

/**
 * Applica le modifiche al testo. Le posizioni si riferiscono al testo originale (come in un WorkspaceEdit): si applicano dal
 * fondo verso l'inizio. Modifiche che si sovrappongono non sono ammesse: si lancia un errore e il testo non cambia.
 */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  if (!edits.length) return text
  const starts = lineStarts(text)
  const ranges = edits
    .map((e) => ({ from: offsetOf(text, starts, e.range.start), to: offsetOf(text, starts, e.range.end), newText: e.newText }))
    .sort((a, b) => a.from - b.from || a.to - b.to)
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].from < ranges[i - 1].to) throw new Error('Modifiche sovrapposte')
  }
  let out = text
  for (let i = ranges.length - 1; i >= 0; i--) out = out.slice(0, ranges[i].from) + ranges[i].newText + out.slice(ranges[i].to)
  return out
}

const key = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

/** `child` è `parent` o sta dentro (Windows: senza distinguere maiuscole e minuscole). */
export function isInside(child: string, parent: string): boolean {
  const c = key(child)
  const p = key(parent)
  return c === p || c.startsWith(p + '\\')
}

/**
 * Il percorso di un file dopo le rinomine: se sta dentro una cartella (o è il file) che si sposta, il suo prefisso cambia.
 * Si applica la prima rinomina che lo riguarda, la più specifica.
 */
export function renamedPath(path: string, renames: RenameOp[]): string {
  const hit = [...renames].filter((r) => isInside(path, r.from)).sort((a, b) => key(b.from).length - key(a.from).length)[0]
  if (!hit) return path
  const rest = key(path).slice(key(hit.from).length)
  const original = path.replace(/\//g, '\\').replace(/\\+$/, '')
  return hit.to.replace(/[\\/]+$/, '') + original.slice(original.length - rest.length)
}

/** Nome valido per un file o una cartella su Windows: non vuoto, senza separatori né caratteri vietati, non riservato. */
export function validateName(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Il nome è vuoto.'
  if (n === '.' || n === '..') return 'Il nome non è valido.'
  if (/[\\/:*?"<>|]/.test(n)) return 'Il nome non può contenere \\ / : * ? " < > |'
  if (/[. ]$/.test(name)) return 'Il nome non può finire con un punto o con uno spazio.'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(n)) return 'Nome riservato da Windows.'
  if (n.length > 200) return 'Il nome è troppo lungo.'
  return null
}
