import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { AlertTriangle, FilePlus, FileText, Pencil, Plus, Search, X } from 'lucide-react'
import { CLAUDE_MD, joinRel } from '@shared/project'
import { renderMarkdown } from './markdown'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { PanelParams } from '@/panels/kinds'
import { openFile } from '@/state/editor'
import { useDocs } from '@/state/docs'
import { useProject } from '@/state/project'
import { useWorkspace } from '@/state/workspace'
import { addPanel, spaceOfPanel } from '@/workspace/panels'
import { dockRegistry } from '@/workspace/registry'

type Source = 'claude' | 'global' | 'context'

interface DocEntry {
  /** Percorso relativo alla radice, come nel file di progetto. */
  rel: string
  abs: string
  source: Source
}

interface Loaded {
  text: string | null
  error?: string
}

/** Limite di lettura: un Markdown più grande non è documentazione da leggere qui. */
const MAX_DOC_BYTES = 1_000_000

const dirOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')

/** Porta in primo piano il pannello Documentazione dello spazio attivo, o lo aggiunge (J8). */
export function openDocsPanel(): void {
  const dock = dockRegistry.get(useWorkspace.getState().activeSpaceId)
  if (!dock) return
  const existing = dock.panels.find((p) => (p.params as PanelParams | undefined)?.kind === 'docs')
  if (existing) existing.api.setActive()
  else addPanel(dock, 'docs')
}

/**
 * Documentazione del progetto (J8): `CLAUDE.md` rilevato da solo, riferimenti globali scelti a mano e documentazione
 * del contesto dello spazio. Lettura con indice delle sezioni e ricerca; «Modifica» apre il file nell'editor.
 */
export function DocsPanel(props: IDockviewPanelProps<PanelParams>) {
  const active = useProject((s) => s.active)
  const spaces = useWorkspace((s) => s.spaces)
  const claudeMd = useDocs((s) => s.claudeMd)
  const docsVersion = useDocs((s) => s.version)

  // Il contesto è quello dello spazio che contiene il pannello, non per forza quello attivo.
  const spaceId = spaceOfPanel(props.containerApi)
  const contextId = useMemo(() => spaces.find((s) => s.id === spaceId)?.contextId ?? null, [spaces, spaceId])
  const context = active?.data.contexts.find((c) => c.id === contextId)

  const entries = useMemo<DocEntry[]>(() => {
    if (!active) return []
    const make = (rel: string, source: Source): DocEntry => ({ rel, abs: joinRel(active.root, rel), source })
    return [
      ...(claudeMd === 'present' ? [make(CLAUDE_MD, 'claude')] : []),
      ...active.data.docs.global.filter((p) => p.toLowerCase() !== CLAUDE_MD.toLowerCase()).map((p) => make(p, 'global' as const)),
      ...(context?.docs ?? []).map((p) => make(p, 'context' as const))
    ]
  }, [active, claudeMd, context])

  const [selected, setSelected] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({})
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (list: DocEntry[]) => {
    const next: Record<string, Loaded> = {}
    await Promise.all(
      list.map(async (e) => {
        try {
          const f = await api.files.read(e.abs)
          next[e.abs] = f.binary ? { text: null, error: 'Non è un file di testo' } : f.tooLarge || f.text.length > MAX_DOC_BYTES ? { text: null, error: 'File troppo grande' } : { text: f.text }
        } catch {
          next[e.abs] = { text: null, error: 'File non trovato' }
        }
      })
    )
    setLoaded(next)
  }, [])

  // Rilegge i documenti quando cambia l'elenco o il disco (J3: il rilevamento segue le modifiche).
  useEffect(() => {
    void load(entries)
  }, [entries, docsVersion, load])

  useEffect(() => {
    if (!selected || !entries.some((e) => e.abs === selected)) setSelected(entries[0]?.abs ?? null)
  }, [entries, selected])

  const current = entries.find((e) => e.abs === selected)
  const text = current ? loaded[current.abs]?.text : null
  const rendered = useMemo(
    () => (current && text != null ? renderMarkdown(text, dirOf(current.abs), query) : null),
    [current, text, query]
  )

  // Con una ricerca attiva, la vista salta alla prima occorrenza.
  useEffect(() => {
    if (!query.trim()) return
    contentRef.current?.querySelector('mark')?.scrollIntoView({ block: 'center' })
  }, [rendered, query])

  const matches = (e: DocEntry) => {
    const q = query.trim().toLowerCase()
    return !q || (loaded[e.abs]?.text ?? '').toLowerCase().includes(q) || e.rel.toLowerCase().includes(q)
  }

  const add = async (scope: 'global' | { contextId: string }) => {
    if (!active) return
    const res = await api.project.pickRelative(active.root, 'docs')
    setNotice(res.skipped > 0 ? `${res.skipped} file su un altro disco: nel file di progetto servono percorsi relativi.` : '')
    await useProject.getState().addDocs(scope, res.paths)
  }

  const onContentClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const file = a.getAttribute('data-file')
    const anchor = a.getAttribute('data-anchor')
    if (file) openFile(file)
    else if (anchor) {
      const target = [...(contentRef.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? [])].find(
        (h) => (h.textContent ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') === anchor.toLowerCase()
      )
      target?.scrollIntoView({ block: 'start' })
    }
  }

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-faint">
        Apri o crea un progetto dal menu «Progetto» nella barra in alto per vedere la sua documentazione.
      </div>
    )
  }

  const sectionTitle = 'px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-text-faint uppercase'
  const groups: { source: Source; title: string; scope?: 'global' | { contextId: string } }[] = [
    { source: 'claude', title: 'Claude Code' },
    { source: 'global', title: 'Globale', scope: 'global' },
    ...(context ? [{ source: 'context' as const, title: `Contesto «${context.name}»`, scope: { contextId: context.id } }] : [])
  ]

  return (
    <div className="flex h-full min-h-0 text-[13px]">
      <aside className="mg-bar flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border">
        <div className="relative p-2">
          <Search size={13} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca nei documenti…"
            aria-label="Cerca nei documenti"
            className="h-8 w-full rounded-lg border border-border bg-background pr-7 pl-7 text-[12px] text-foreground outline-none focus:border-brand"
          />
          {query && (
            <button type="button" aria-label="Svuota la ricerca" onClick={() => setQuery('')} className="absolute top-1/2 right-4 -translate-y-1/2 text-text-faint hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>

        {groups.map((g) => {
          const list = entries.filter((e) => e.source === g.source)
          return (
            <section key={g.source}>
              <div className={cn(sectionTitle, 'flex items-center justify-between')}>
                <span className="truncate">{g.title}</span>
                {g.scope && (
                  <button type="button" title="Aggiungi documenti Markdown" aria-label={`Aggiungi documenti a ${g.title}`} onClick={() => void add(g.scope!)} className="rounded p-0.5 text-text-faint hover:bg-border hover:text-foreground">
                    <Plus size={13} />
                  </button>
                )}
              </div>
              {g.source === 'claude' && claudeMd === 'missing' && (
                <p className="px-3 pb-1 text-[12px] text-warn">{CLAUDE_MD} non trovato nella radice.</p>
              )}
              {list.filter(matches).map((e) => (
                <div
                  key={e.abs}
                  className={cn('group flex items-center gap-1 pr-2 pl-3 hover:bg-surface-2', e.abs === selected && 'bg-background')}
                >
                  <button
                    type="button"
                    onClick={() => setSelected(e.abs)}
                    title={e.abs}
                    className={cn('flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left', e.abs === selected ? 'text-foreground' : 'text-text-muted')}
                  >
                    <FileText size={13} className="shrink-0 text-text-faint" />
                    <span className="truncate">{e.rel}</span>
                  </button>
                  {loaded[e.abs]?.error && <AlertTriangle size={13} className="shrink-0 text-warn" aria-label={loaded[e.abs]?.error} />}
                  {g.scope && (
                    <button type="button" aria-label={`Togli ${e.rel}`} title="Togli dall'elenco (il file non si cancella)" onClick={() => void useProject.getState().removeDoc(g.scope!, e.rel)} className="shrink-0 rounded p-0.5 text-text-faint opacity-0 group-hover:opacity-100 hover:bg-border hover:text-foreground">
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
              {g.scope && list.length === 0 && <p className="px-3 pb-1 text-[12px] text-text-faint">Nessun documento.</p>}
            </section>
          )
        })}
        {notice && <p className="px-3 pt-2 text-[12px] text-warn">{notice}</p>}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {claudeMd === 'missing' && (
          <div className="flex items-start gap-3 border-b border-border bg-surface-2 px-4 py-3" role="alert">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">Manca il file {CLAUDE_MD}</p>
              <p className="mt-0.5 text-text-muted">
                Claude Code lo legge a ogni sessione per conoscere il progetto: comandi, regole, struttura. Crealo e completalo.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                const err = await useDocs.getState().createClaudeMd()
                if (err) setNotice(err)
                else {
                  const root = useProject.getState().active?.root
                  if (root) openFile(joinRel(root, CLAUDE_MD))
                }
              }}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 font-semibold text-on-brand"
            >
              <FilePlus size={14} /> Crea {CLAUDE_MD}
            </button>
          </div>
        )}

        {current && rendered ? (
          <>
            <header className="flex items-center gap-2 border-b border-border px-4 py-2">
              <h2 className="min-w-0 flex-1 truncate font-semibold text-foreground" title={current.abs}>
                {current.rel}
              </h2>
              <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-text-faint">
                {current.source === 'claude' ? 'automatico' : current.source === 'global' ? 'globale' : 'contesto'}
              </span>
              <button type="button" onClick={() => openFile(current.abs)} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-text-muted transition-colors hover:bg-border hover:text-foreground">
                <Pencil size={13} /> Modifica
              </button>
            </header>
            <div className="flex min-h-0 flex-1">
              <div ref={contentRef} onClick={onContentClick} className="cct-md min-w-0 flex-1 overflow-y-auto px-6 py-4" dangerouslySetInnerHTML={{ __html: rendered.html }} />
              {rendered.outline.length > 1 && (
                <nav aria-label="Sezioni" className="hidden w-52 shrink-0 overflow-y-auto border-l border-border py-3 xl:block">
                  <p className={sectionTitle}>Sezioni</p>
                  {rendered.outline.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => contentRef.current?.querySelector(`#${h.id}`)?.scrollIntoView({ block: 'start' })}
                      style={{ paddingLeft: 12 + (h.level - 1) * 10 }}
                      className="block w-full truncate py-1 pr-3 text-left text-[12px] text-text-muted hover:bg-surface-2 hover:text-foreground"
                    >
                      {h.text}
                    </button>
                  ))}
                </nav>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-text-faint">
            {current && loaded[current.abs]?.error
              ? `${current.rel}: ${loaded[current.abs]?.error}`
              : entries.length === 0
                ? 'Nessun documento. Aggiungi i Markdown di riferimento con il pulsante + nell’elenco.'
                : 'Scegli un documento.'}
          </div>
        )}
      </div>
    </div>
  )
}
