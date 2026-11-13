// Colori ANSI → HTML, per l'output dei comandi (Bash) nella vista grafica. Solo SGR (colori, grassetto, tenue, corsivo, sottolineato):
// le altre sequenze di controllo (cursore, titoli…) si tolgono. Il testo è sempre scappato: l'HTML prodotto è sicuro.

/** Stessi colori del terminale (TerminalView), così un comando ha lo stesso aspetto nelle due viste. */
const BASE = ['#27272a', '#ff8a8a', '#6fd39b', '#f5c46b', '#6ea8fe', '#c792ea', '#7fd4e6', '#d4d4d8']
const BRIGHT = ['#71717a', '#ffb3b3', '#a8f0c6', '#ffe08f', '#9cc4ff', '#dcb8f5', '#a8e6f2', '#fafafa']

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface Style {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

/** Colore a 256 posti: 0–15 base, 16–231 cubo 6×6×6, 232–255 grigi. */
function color256(n: number): string | undefined {
  if (n < 0 || n > 255) return undefined
  if (n < 8) return BASE[n]
  if (n < 16) return BRIGHT[n - 8]
  if (n >= 232) {
    const v = 8 + (n - 232) * 10
    return `rgb(${v},${v},${v})`
  }
  const i = n - 16
  const c = (x: number) => (x === 0 ? 0 : 55 + x * 40)
  return `rgb(${c(Math.floor(i / 36))},${c(Math.floor(i / 6) % 6)},${c(i % 6)})`
}

function apply(style: Style, codes: number[]): Style {
  const s = { ...style }
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]
    if (c === 0) Object.keys(s).forEach((k) => delete s[k as keyof Style])
    else if (c === 1) s.bold = true
    else if (c === 2) s.dim = true
    else if (c === 3) s.italic = true
    else if (c === 4) s.underline = true
    else if (c === 22) (s.bold = false), (s.dim = false)
    else if (c === 23) s.italic = false
    else if (c === 24) s.underline = false
    else if (c >= 30 && c <= 37) s.fg = BASE[c - 30]
    else if (c === 39) delete s.fg
    else if (c >= 40 && c <= 47) s.bg = BASE[c - 40]
    else if (c === 49) delete s.bg
    else if (c >= 90 && c <= 97) s.fg = BRIGHT[c - 90]
    else if (c >= 100 && c <= 107) s.bg = BRIGHT[c - 100]
    else if (c === 38 || c === 48) {
      const target = c === 38 ? 'fg' : 'bg'
      if (codes[i + 1] === 5) {
        s[target] = color256(codes[i + 2])
        i += 2
      } else if (codes[i + 1] === 2) {
        s[target] = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`
        i += 4
      }
    }
  }
  return s
}

const css = (s: Style) =>
  [s.fg && `color:${s.fg}`, s.bg && `background:${s.bg}`, s.bold && 'font-weight:600', s.dim && 'opacity:.7', s.italic && 'font-style:italic', s.underline && 'text-decoration:underline'].filter(Boolean).join(';')

/** Testo con sequenze ANSI → HTML con `<span style>`. */
export function ansiToHtml(input: string): string {
  // Sequenze che non sono colori (movimento del cursore, cancellazioni, titoli): via.
  const text = input.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[A-LN-Za-ln-z]/g, '')
  let style: Style = {}
  let out = ''
  let last = 0
  const re = /\x1b\[([0-9;]*)m/g
  const push = (chunk: string) => {
    if (!chunk) return
    const c = css(style)
    out += c ? `<span style="${c}">${escapeHtml(chunk)}</span>` : escapeHtml(chunk)
  }
  for (let m = re.exec(text); m; m = re.exec(text)) {
    push(text.slice(last, m.index))
    style = apply(style, m[1] === '' ? [0] : m[1].split(';').map((x) => Number(x) || 0))
    last = re.lastIndex
  }
  push(text.slice(last))
  return out
}

/** Il testo ha sequenze ANSI di colore? (per non passare dall'HTML quando non serve) */
export const hasAnsi = (s: string) => /\x1b\[[0-9;]*m/.test(s)
