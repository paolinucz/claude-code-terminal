import { useEffect, useState } from 'react'
import { getIconForFile, getIconForFolder, getIconForOpenFolder } from 'vscode-icons-js'

/**
 * Icone dei tipi di file e delle cartelle: il tema «vscode-icons» (licenza MIT), con i SVG dentro l'app
 * (`@iconify-json/vscode-icons`), quindi niente rete. I nomi dei file si associano alle icone con `vscode-icons-js`.
 * Il pacchetto è grande: si carica in un file a parte alla prima icona mostrata.
 */
interface IconData {
  icons: Record<string, { body: string; width?: number; height?: number }>
  width?: number
  height?: number
}

let data: IconData | null = null
let loading: Promise<void> | null = null
const waiting = new Set<() => void>()

function ensureLoaded(): void {
  if (data || loading) return
  loading = import('@iconify-json/vscode-icons/icons.json')
    .then((m) => {
      data = (m.default ?? m) as unknown as IconData
      waiting.forEach((fn) => fn())
    })
    .catch(() => undefined)
}

function useIconData(): IconData | null {
  const [, tick] = useState(0)
  useEffect(() => {
    if (data) return
    const fn = () => tick((n) => n + 1)
    waiting.add(fn)
    ensureLoaded()
    return () => void waiting.delete(fn)
  }, [])
  return data
}

/** Nome dell'icona nel pacchetto: «file_type_ts.svg» → «file-type-ts». */
const toKey = (svg: string): string => svg.replace(/\.svg$/, '').replace(/_/g, '-')

export function iconKeyFor(name: string, dir: boolean, open: boolean): string {
  if (dir) return toKey(open ? getIconForOpenFolder(name) : getIconForFolder(name))
  return toKey(getIconForFile(name) || 'default_file.svg')
}

/** Icona di un file o di una cartella (aperta o chiusa). */
export function FileIcon({ name, dir = false, open = false, size = 14, className }: { name: string; dir?: boolean; open?: boolean; size?: number; className?: string }) {
  const set = useIconData()
  const fallback = dir ? (open ? 'default-folder-opened' : 'default-folder') : 'default-file'
  const icon = set ? (set.icons[iconKeyFor(name, dir, open)] ?? set.icons[fallback]) : undefined
  const w = icon?.width ?? set?.width ?? 32
  const h = icon?.height ?? set?.height ?? 32
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      data-icon={icon ? iconKeyFor(name, dir, open) : 'loading'}
      className={className ?? 'shrink-0'}
      // Il contenuto viene dal pacchetto dell'icon set, non dall'utente.
      dangerouslySetInnerHTML={{ __html: icon?.body ?? '' }}
    />
  )
}
