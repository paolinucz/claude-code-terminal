import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { joinRel } from '@shared/project'

/** Trasforma il Markdown in HTML sicuro, con id sulle intestazioni, link relativi gestibili e ricerca evidenziata. */
export function renderMarkdown(
  text: string,
  baseDir: string,
  query: string,
  withLines = false
): { html: string; outline: { id: string; level: number; text: string }[] } {
  if (!withLines) return finishHtml(marked.parse(text, { async: false, gfm: true }) as string, baseDir, query)
  // Con le righe: ogni blocco porta `data-l="inizio-fine"` (righe del sorgente), per revisionare dal Markdown impaginato.
  const { blocks, links } = lexBlocks(text)
  return finishHtml(blocks.map((b) => renderBlock(b, links)).join('\n'), baseDir, query)
}

type Outline = { id: string; level: number; text: string }[]
type Token = ReturnType<typeof marked.lexer>[number]
interface Block {
  tok: Token
  /** Righe del sorgente (da 1) occupate dal blocco. */
  start: number
  end: number
}

const newlines = (t: string): number => t.split('\n').length - 1

/** Blocchi di primo livello con le righe del sorgente: si ricavano sommando i `raw` di tutti i token, spazi compresi. */
function lexBlocks(text: string): { blocks: Block[]; links: ReturnType<typeof marked.lexer>['links'] } {
  const all = marked.lexer(text.replace(/\r\n?/g, '\n'), { gfm: true })
  const blocks: Block[] = []
  let line = 1
  for (const tok of all) {
    const lead = /^\n*/.exec(tok.raw)![0].length
    if (tok.type !== 'space') {
      const start = line + lead
      blocks.push({ tok, start, end: start + newlines(tok.raw.slice(lead).replace(/\s+$/, '')) })
    }
    line += newlines(tok.raw)
  }
  return { blocks, links: all.links }
}

/** Il blocco in HTML, con le sue righe sul primo elemento. */
function renderBlock(b: Block, links: ReturnType<typeof marked.lexer>['links']): string {
  const html = marked.parser(Object.assign([b.tok], { links }) as never, { gfm: true })
  return html.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1 data-l="${b.start}-${b.end}"`)
}

/**
 * Diff «impaginato» tra due versioni di un Markdown: confronta i blocchi (paragrafi, titoli, elenchi, codice…)
 * e li mostra renderizzati, con i blocchi aggiunti in verde e quelli tolti in rosso.
 */
export function renderMarkdownDiff(before: string, after: string, baseDir: string): { html: string; outline: Outline; added: number; removed: number } {
  const lex = (t: string) => {
    const { blocks, links } = lexBlocks(t)
    return { tokens: blocks, links }
  }
  const a = lex(before)
  const b = lex(after)
  const key = (x: Block) => x.tok.raw.trim()
  // LCS sui blocchi: i documenti sono piccoli, la tabella quadratica basta.
  const n = a.tokens.length
  const m = b.tokens.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = key(a.tokens[i]) === key(b.tokens[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  // Solo i blocchi della versione «dopo» portano le righe: i tolti non esistono più nel file.
  const one = (blk: Block, links: typeof a.links, lines: boolean) =>
    lines ? renderBlock(blk, links) : marked.parser(Object.assign([blk.tok], { links }) as never, { gfm: true })
  const parts: string[] = []
  let added = 0
  let removed = 0
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && key(a.tokens[i]) === key(b.tokens[j])) {
      parts.push(one(b.tokens[j], b.links, true))
      i++
      j++
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      parts.push(`<div class="cct-md-add">${one(b.tokens[j], b.links, true)}</div>`)
      added++
      j++
    } else {
      parts.push(`<div class="cct-md-del">${one(a.tokens[i], a.links, false)}</div>`)
      removed++
      i++
    }
  }
  return { ...finishHtml(parts.join('\n'), baseDir, ''), added, removed }
}

function finishHtml(raw: string, baseDir: string, query: string): { html: string; outline: Outline } {
  // Niente script, stili o frame dal Markdown: DOMPurify toglie tutto ciò che esegue codice.
  const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button'], FORBID_ATTR: ['style'], ADD_ATTR: ['class'] })
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, 'text/html')
  const root = doc.body.firstElementChild as HTMLElement
  const outline: { id: string; level: number; text: string }[] = []
  root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h, i) => {
    h.id = `sec-${i}`
    outline.push({ id: h.id, level: Number(h.tagName.slice(1)), text: h.textContent ?? '' })
  })
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? ''
    if (/^(https?:|mailto:)/i.test(href)) {
      a.setAttribute('data-external', href)
      a.removeAttribute('href')
    } else if (href.startsWith('#')) {
      a.setAttribute('data-anchor', href.slice(1))
      a.removeAttribute('href')
    } else if (href) {
      a.setAttribute('data-file', joinRel(baseDir, decodeURIComponent(href.split('#')[0])))
      a.removeAttribute('href')
    }
  })
  root.querySelectorAll('img').forEach((img) => img.remove())
  // Blocchi di codice: etichetta del linguaggio e «Copia» (il clic lo gestisce MarkdownView).
  root.querySelectorAll('pre').forEach((pre) => {
    const lang = /language-([\w+#-]+)/.exec(pre.querySelector('code')?.className ?? '')?.[1] ?? ''
    const bar = doc.createElement('div')
    bar.className = 'cct-code-bar'
    const label = doc.createElement('span')
    label.textContent = lang
    const copy = doc.createElement('span')
    copy.className = 'cct-copy'
    copy.setAttribute('data-copy', '')
    copy.textContent = 'Copia'
    bar.append(label, copy)
    pre.prepend(bar)
  })
  const q = query.trim()
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
    for (const node of nodes) {
      const value = node.nodeValue ?? ''
      if (!re.test(value)) continue
      re.lastIndex = 0
      const frag = doc.createDocumentFragment()
      let last = 0
      for (const m of value.matchAll(re)) {
        frag.append(value.slice(last, m.index))
        const mark = doc.createElement('mark')
        mark.textContent = m[0]
        frag.append(mark)
        last = (m.index ?? 0) + m[0].length
      }
      frag.append(value.slice(last))
      node.replaceWith(frag)
    }
  }
  return { html: root.innerHTML, outline }
}
