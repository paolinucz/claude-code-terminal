import { useEffect, type RefObject } from 'react'

/** Nomi di linguaggio dei blocchi di codice (```ts) → id dei linguaggi di Monaco. */
const ALIASES: Record<string, string> = {
  sh: 'shell', bash: 'shell', zsh: 'shell', shell: 'shell', console: 'shell',
  ps1: 'powershell', pwsh: 'powershell',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  py: 'python', yml: 'yaml', md: 'markdown', rs: 'rust', kt: 'kotlin', cs: 'csharp', rb: 'ruby', 'c++': 'cpp', 'c#': 'csharp', html: 'html', xml: 'xml', json: 'json', jsonc: 'json', sql: 'sql', css: 'css', java: 'java', go: 'go', diff: 'plaintext'
}

/** Id del linguaggio di Monaco per un nome o un'estensione; `null` se non si conosce. */
export function monacoLanguage(name: string): string | null {
  const n = name.toLowerCase()
  if (ALIASES[n]) return ALIASES[n]
  return /^[a-z][a-z0-9+#-]*$/.test(n) ? n : null
}

/** Evidenzia la sintassi con Monaco (già nel pacchetto, caricato solo alla prima richiesta). `null` se non c'è nulla da fare. */
export async function colorize(code: string, lang: string): Promise<string | null> {
  const id = monacoLanguage(lang)
  if (!id || id === 'plaintext' || code.length > 20000) return null
  const { monaco } = await import('@/lib/monaco')
  // Il tema è globale: senza un editor aperto resterebbe quello chiaro e il codice uscirebbe scuro su scuro.
  monaco.editor.setTheme('cct-dark')
  const known = monaco.languages.getLanguages().some((l) => l.id === id)
  if (!known) return null
  try {
    return await monaco.editor.colorize(code, id, { tabSize: 2 })
  } catch {
    return null
  }
}

/**
 * Evidenzia i blocchi di codice (`<pre><code class="language-x">`) di un contenitore con HTML generato dal Markdown. Si rifà quando
 * cambia `dep` (l'HTML): i blocchi già evidenziati si riconoscono dall'attributo `data-hl`.
 */
export function useCodeHighlight(ref: RefObject<HTMLElement | null>, dep: unknown): void {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    let stale = false
    root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]').forEach((code) => {
      if (code.dataset.hl) return
      const lang = /language-([\w+#-]+)/.exec(code.className)?.[1]
      if (!lang) return
      code.dataset.hl = '1'
      void colorize(code.textContent ?? '', lang).then((html) => {
        if (!stale && html) code.innerHTML = html
      })
    })
    return () => {
      stale = true
    }
  }, [ref, dep])
}
