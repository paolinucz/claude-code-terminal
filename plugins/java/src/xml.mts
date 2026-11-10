/**
 * Lettore XML minimo (niente dipendenze) per i file di configurazione di IntelliJ e i pom.xml:
 * elementi, attributi, testo, CDATA e commenti. Non valida e non gestisce DTD né spazi dei nomi.
 */
export interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#10;': '\n', '&#13;': '\r', '&#9;': '\t' }
const decode = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#10|#13|#9);/g, (m) => ENTITIES[m] ?? m).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) top.text += m[1]
    else if (m[2] !== undefined) {
      if (stack.length > 1) stack.pop()
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {}
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? '')
      const node: XmlNode = { tag: m[3], attrs, children: [], text: '' }
      top.children.push(node)
      if (!m[5]) stack.push(node)
    } else if (m[6] !== undefined) top.text += decode(m[6])
  }
  return root
}

/** Primo figlio diretto con quel nome. */
export const child = (n: XmlNode | undefined, tag: string): XmlNode | undefined => n?.children.find((c) => c.tag === tag)
export const childrenOf = (n: XmlNode | undefined, tag: string): XmlNode[] => n?.children.filter((c) => c.tag === tag) ?? []

/** Tutti i discendenti con quel nome (in profondità). */
export function descendants(n: XmlNode, tag: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of n.children) {
    if (c.tag === tag) out.push(c)
    descendants(c, tag, out)
  }
  return out
}
