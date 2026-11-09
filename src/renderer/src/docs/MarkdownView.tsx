import { useRef } from 'react'
import { openFile } from '@/state/editor'
import { cn } from '@/lib/cn'

/** Markdown già trasformato da `renderMarkdown`/`renderMarkdownDiff` (HTML sanificato): link ai file e ancore funzionanti. */
export function MarkdownView({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const onClick = (e: React.MouseEvent) => {
    const copy = (e.target as HTMLElement).closest('[data-copy]')
    if (copy) {
      const code = copy.closest('pre')?.querySelector('code')?.textContent ?? ''
      void navigator.clipboard.writeText(code).then(() => {
        copy.textContent = 'Copiato'
        window.setTimeout(() => (copy.textContent = 'Copia'), 1500)
      })
      return
    }
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const file = a.getAttribute('data-file')
    const anchor = a.getAttribute('data-anchor')
    if (file) openFile(file)
    else if (anchor) {
      const target = [...(ref.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? [])].find(
        (h) => (h.textContent ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') === anchor.toLowerCase()
      )
      target?.scrollIntoView({ block: 'start' })
    }
  }
  return <div ref={ref} onClick={onClick} className={cn('cct-md overflow-y-auto px-6 py-4', className)} dangerouslySetInnerHTML={{ __html: html }} />
}
