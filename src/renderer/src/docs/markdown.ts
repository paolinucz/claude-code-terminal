import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { joinRel } from '@shared/project'

/** Trasforma il Markdown in HTML sicuro, con id sulle intestazioni, link relativi gestibili e ricerca evidenziata. */
export function renderMarkdown(text: string, baseDir: string, query: string): { html: string; outline: { id: string; level: number; text: string }[] } {
  return finishHtml(marked.parse(text, { async: false, gfm: true }) as string, baseDir, query)
}

type Outline = { id: string; level: number; text: string }[]

/**
 * Diff «impaginato» tra due versioni di un Markdown: confronta i blocchi (paragrafi, titoli, elenchi, codice…)
 * e li mostra renderizzati, con i blocchi aggiunti in verde e quelli tolti in rosso.
 */
export function renderMarkdownDiff(before: string, after: string, baseDir: string): { html: string; outline: Outline; added: number; removed: number } {
  const lex = (t: string) => {
    const tokens = marked.lexer(t, { gfm: true })
    return { tokens: tokens.filter((x) => x.type !== 'space'), links: tokens.links }
  }
  const a = lex(before)
  const b = lex(after)
  const key = (x: { raw: string }) => x.raw.trim()
  // LCS sui blocchi: i documenti sono piccoli, la tabella quadratica basta.
  const n = a.tokens.length
  const m = b.tokens.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = key(a.tokens[i]) === key(b.tokens[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const one = (tok: (typeof a.tokens)[number], links: typeof a.links) => marked.parser(Object.assign([tok], { links }) as never, { gfm: true })
  const parts: string[] = []
  let added = 0
  let removed = 0
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && key(a.tokens[i]) === key(b.tokens[j])) {
      parts.push(one(b.tokens[j], b.links))
      i++
      j++
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      parts.push(`<div class="cct-md-add">${one(b.tokens[j], b.links)}</div>`)
      added++
      j++
    } else {
      parts.push(`<div class="cct-md-del">${one(a.tokens[i], a.links)}</div>`)
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
