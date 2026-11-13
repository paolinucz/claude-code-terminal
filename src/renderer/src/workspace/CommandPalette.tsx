import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FileText, LayoutPanelTop, Search, SquareTerminal, Zap } from 'lucide-react'
import { joinNative, normPath, type FileIndex } from '@shared/files'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui-kit'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { guessWorkspace, openFile } from '@/state/editor'
import { useRecent } from '@/state/recent'
import { rootForSpace } from '@/state/sidebar'
import { FileIcon } from '@/lib/fileIcons'
import { revealSession, sessionList, STATUS_COLORS, STATUS_LABELS, useSessions } from '@/state/sessions'
import { useWorkspace } from '@/state/workspace'
import { dockRegistry } from './registry'

/** Un comando della palette (L7). */
export interface PaletteCommand {
  id: string
  title: string
  /** Testo a destra: scorciatoia o dettaglio. */
  hint?: string
  /** Parole in più per la ricerca (sinonimi). */
  keywords?: string
  run(): void
}

type Group = 'Comandi' | 'Sessioni' | 'Spazi' | 'File' | 'Recenti'

/**
 * `all` (Ctrl+K): comandi, sessioni, spazi e file. `files` (Ctrl+P): solo file, con i recenti quando non si è scritto nulla.
 * `recent` (Ctrl+E): solo i file aperti di recente.
 */
export type PaletteMode = 'all' | 'files' | 'recent'

const MODE_TEXT: Record<PaletteMode, { placeholder: string; title: string }> = {
  all: { placeholder: 'Cerca file, sessioni, spazi o comandi…', title: 'Palette comandi' },
  files: { placeholder: 'Vai al file… (nome o parte del percorso)', title: 'Vai al file' },
  recent: { placeholder: 'File aperti di recente…', title: 'File recenti' }
}

interface Item {
  key: string
  group: Group
  title: string
  detail?: string
  icon: ReactNode
  score: number
  run(): void
}

const LIMITS: Record<Group, number> = { Comandi: 40, Sessioni: 20, Spazi: 20, File: 60, Recenti: 40 }
const SEPARATORS = /[\\/ ._\-:·«»]/

/**
 * Corrispondenza approssimata: ogni parola cercata deve comparire nel testo, anche a lettere
 * sparse (es. «nterm» trova «Nuovo terminale»). Punteggio più alto per sottostringhe e inizi di parola.
 * `null` se non corrisponde.
 */
export function fuzzyScore(text: string, query: string): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 0
  const t = text.toLowerCase()
  let total = 0
  for (const w of words) {
    const s = wordScore(t, w)
    if (s === null) return null
    total += s
  }
  return total - t.length * 0.05
}

function wordScore(t: string, w: string): number | null {
  const at = t.indexOf(w)
  if (at >= 0) return 100 + (at === 0 ? 60 : SEPARATORS.test(t[at - 1]) ? 40 : 0) + w.length * 4
  // Lettere sparse: valgono solo se seguono gli inizi di parola (es. «nterm» → «Nuovo TERMinale»).
  // Più di un salto a metà parola è rumore (es. «ordini» non deve trovare «Ripristina layout predefinito»).
  let from = 0
  let last = -2
  let score = 0
  let jumps = 0
  for (const ch of w) {
    const found = t.indexOf(ch, from)
    if (found < 0) return null
    const wordStart = found === 0 || SEPARATORS.test(t[found - 1])
    if (found === last + 1) score += 5
    else if (wordStart) score += 8
    else if (++jumps > 1) return null
    last = found
    from = found + 1
  }
  return score
}

/** Punteggio di un file: conta di più la corrispondenza sul nome che sul percorso. */
function fileScore(rel: string, query: string): number | null {
  const name = rel.slice(rel.lastIndexOf('\\') + 1)
  const onName = fuzzyScore(name, query)
  const onPath = fuzzyScore(rel, query)
  if (onName === null && onPath === null) return null
  return Math.max(onName === null ? -Infinity : onName + 50, onPath ?? -Infinity)
}

/**
 * Palette comandi (L7): con Ctrl+K cerca tra comandi, sessioni, spazi e file del progetto dello spazio
 * attivo. Frecce per scegliere, Invio per eseguire, Esc per chiudere.
 */
export function CommandPalette({ open, onClose, commands, mode = 'all' }: { open: boolean; onClose(): void; commands: PaletteCommand[]; mode?: PaletteMode }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [index, setIndex] = useState<FileIndex | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const sessions = useSessions((s) => s.sessions)
  const spaces = useWorkspace((s) => s.spaces)
  const activeSpaceId = useWorkspace((s) => s.activeSpaceId)
  const listRef = useRef<HTMLDivElement>(null)
  const recent = useRecent((s) => s.files)

  // La cartella dei file è quella dello spazio attivo (esplora file o terminale), letta all'apertura.
  const [root, setRoot] = useState<string | undefined>()
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const dock = dockRegistry.get(activeSpaceId)
    setRoot(rootForSpace(activeSpaceId) || (dock ? guessWorkspace(dock) : undefined))
  }, [open, activeSpaceId])

  useEffect(() => {
    if (!open || !root || mode === 'recent') {
      setIndex(null)
      return
    }
    let alive = true
    setLoadingFiles(true)
    void api.files
      .index(root)
      .then((i) => alive && setIndex(i))
      .finally(() => alive && setLoadingFiles(false))
    return () => {
      alive = false
    }
  }, [open, root, mode])

  const items = useMemo(() => {
    const q = query.trim()
    const out: Item[] = []
    const push = (group: Group, list: Item[]) => {
      const sorted = q ? list.sort((a, b) => b.score - a.score) : list
      out.push(...sorted.slice(0, LIMITS[group]))
    }

    // Recenti: Ctrl+E sempre, Ctrl+P solo finché non si scrive (poi cerca in tutti i file).
    if (mode === 'recent' || (mode === 'files' && !q)) {
      const base = root ? normPath(root) + '\\' : ''
      const recents: Item[] = []
      for (const path of recent) {
        const inRoot = base && normPath(path).startsWith(base)
        const rel = inRoot ? path.slice(base.length) : path
        const score = q ? fileScore(rel, q) : 0
        if (score === null) continue
        const cut = rel.lastIndexOf('\\')
        const name = rel.slice(cut + 1)
        recents.push({
          key: `r:${path}`,
          group: 'Recenti',
          title: name,
          detail: cut > 0 ? rel.slice(0, cut) : undefined,
          icon: <FileIcon name={name} size={14} />,
          score,
          run: () => openFile(path, undefined, root)
        })
      }
      push('Recenti', recents)
    }
    if (mode !== 'all') {
      if (mode === 'files' && q && index) {
        const files: Item[] = []
        for (const rel of index.files) {
          const score = fileScore(rel, q)
          if (score === null) continue
          const cut = rel.lastIndexOf('\\')
          const name = rel.slice(cut + 1)
          files.push({
            key: `p:${rel}`,
            group: 'File',
            title: name,
            detail: cut > 0 ? rel.slice(0, cut) : undefined,
            icon: <FileIcon name={name} size={14} />,
            score,
            run: () => openFile(joinNative(index.root, rel), undefined, index.root)
          })
        }
        push('File', files)
      }
      return out
    }

    push(
      'Comandi',
      commands.flatMap((c) => {
        const score = fuzzyScore(`${c.title} ${c.keywords ?? ''}`, q)
        return score === null ? [] : [{ key: `c:${c.id}`, group: 'Comandi' as const, title: c.title, detail: c.hint, icon: <Zap size={14} />, score, run: c.run }]
      })
    )
    push(
      'Sessioni',
      sessionList(sessions).flatMap((s) => {
        const score = fuzzyScore(`${s.title} ${s.cwd}`, q)
        return score === null
          ? []
          : [
              {
                key: `s:${s.id}`,
                group: 'Sessioni' as const,
                title: s.title,
                detail: `${STATUS_LABELS[s.status]} · ${s.cwd}`,
                icon: <SquareTerminal size={14} style={{ color: STATUS_COLORS[s.status] }} />,
                score,
                run: () => revealSession(s.id)
              }
            ]
      })
    )
    push(
      'Spazi',
      spaces.flatMap((s) => {
        const score = fuzzyScore(`${s.name} spazio`, q)
        return score === null
          ? []
          : [
              {
                key: `f:${s.id}`,
                group: 'Spazi' as const,
                title: s.name,
                detail: s.id === activeSpaceId ? 'spazio attivo' : 'vai allo spazio',
                icon: <LayoutPanelTop size={14} />,
                score,
                run: () => useWorkspace.getState().setActive(s.id)
              }
            ]
      })
    )
    // I file solo quando si scrive qualcosa: sono troppi per elencarli tutti.
    if (q && index) {
      const files: Item[] = []
      for (const rel of index.files) {
        const score = fileScore(rel, q)
        if (score === null) continue
        const cut = rel.lastIndexOf('\\')
        files.push({
          key: `p:${rel}`,
          group: 'File',
          title: rel.slice(cut + 1),
          detail: cut > 0 ? rel.slice(0, cut) : undefined,
          icon: <FileText size={14} />,
          score,
          run: () => openFile(joinNative(index.root, rel), undefined, index.root)
        })
      }
      push('File', files)
    }
    return out
  }, [query, commands, sessions, spaces, activeSpaceId, index, mode, recent, root])

  useEffect(() => setActive(0), [query])

  // La voce scelta resta visibile scorrendo con le frecce.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (item: Item | undefined) => {
    if (!item) return
    onClose()
    // Dopo la chiusura: il comando può aprire un altro dialogo o spostare il focus.
    window.setTimeout(item.run, 0)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (items.length ? (a + 1) % items.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(items[active])
    }
  }

  const q = query.trim()
  let lastGroup: Group | null = null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        aria-label={MODE_TEXT[mode].title}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.querySelector('input')?.focus()
        }}
      >
        <DialogTitle className="sr-only">{MODE_TEXT[mode].title}</DialogTitle>
        <DialogDescription className="sr-only">Cerca tra comandi, sessioni, spazi e file. Frecce per scegliere, Invio per eseguire.</DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search size={15} className="shrink-0 text-text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={MODE_TEXT[mode].placeholder}
            aria-label={MODE_TEXT[mode].placeholder}
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `palette-item-${active}` : undefined}
            className="h-11 w-full bg-transparent text-[14px] text-foreground outline-none placeholder:text-text-faint"
          />
        </div>
        <div ref={listRef} id="palette-list" role="listbox" aria-label="Risultati" className="max-h-[min(60vh,480px)] overflow-y-auto p-1.5">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-text-subtle">
              {q ? `Nessun risultato per «${q}».` : mode === 'recent' ? 'Nessun file aperto di recente.' : mode === 'files' ? 'Scrivi il nome di un file.' : 'Nessun risultato.'}
            </p>
          )}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null
            lastGroup = item.group
            return (
              <div key={item.key}>
                {header && <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-text-faint uppercase">{header}</div>}
                <div
                  id={`palette-item-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => run(item)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5',
                    i === active ? 'bg-border text-foreground' : 'text-text-muted'
                  )}
                >
                  <span className="shrink-0 text-text-faint">{item.icon}</span>
                  <span className="shrink-0 truncate">{item.title}</span>
                  {item.detail && <span className="ml-auto min-w-0 truncate pl-3 text-right text-[12px] text-text-faint">{item.detail}</span>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-text-faint">
          <span className="shrink-0 whitespace-nowrap">↑↓ scegli · Invio {mode === 'all' ? 'esegue' : 'apre'} · Esc chiude</span>
          <span className="ml-auto truncate">
            {mode === 'recent'
              ? `${recent.length} file recenti`
              : !root
              ? 'Nessuna cartella di progetto nello spazio: apri un Esplora file o un terminale'
              : loadingFiles
                ? 'Lettura dei file…'
                : index
                  ? `${index.files.length}${index.truncated ? '+' : ''} file in ${root}`
                  : ''}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
