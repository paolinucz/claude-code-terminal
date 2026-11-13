import { useEffect, useRef, useState } from 'react'
import { CaseSensitive, ChevronDown, ChevronRight, Regex, WholeWord } from 'lucide-react'
import { joinNative } from '@shared/files'
import type { SearchOptions, SearchResult } from '@shared/search'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { FileIcon } from '@/lib/fileIcons'
import { openFile } from '@/state/editor'
import { rootForSpace, useSidebar } from '@/state/sidebar'
import { useWorkspace } from '@/state/workspace'

const OPTIONS_KEY = 'ui.searchOptions'

/** Ricerca nei file del progetto (Ctrl+Maiusc+F), nella barra laterale: risultati per file, clic per aprire alla riga. */
export function SearchView() {
  const spaceId = useWorkspace((s) => s.activeSpaceId)
  const focus = useSidebar((s) => s.searchFocus)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [include, setInclude] = useState('')
  const [opts, setOpts] = useState({ caseSensitive: false, wholeWord: false, regex: false })
  const [result, setResult] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const root = rootForSpace(spaceId)

  // Opzioni ricordate tra un avvio e l'altro.
  useEffect(() => {
    void api.settings.get(OPTIONS_KEY).then((v) => {
      const o = v as Partial<typeof opts> | null
      if (o && typeof o === 'object') setOpts({ caseSensitive: !!o.caseSensitive, wholeWord: !!o.wholeWord, regex: !!o.regex })
    })
  }, [])
  const setOption = (patch: Partial<typeof opts>) => {
    const next = { ...opts, ...patch }
    setOpts(next)
    void api.settings.set(OPTIONS_KEY, next)
  }

  // Ctrl+Maiusc+F: focus sulla casella e, se c'era del testo selezionato, lo si cerca.
  useEffect(() => {
    if (focus.text) setQuery(focus.text)
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focus])

  // Ricerca con un piccolo ritardo mentre si scrive; una ricerca nuova annulla la precedente.
  useEffect(() => {
    if (!query || !root) {
      setResult(null)
      setBusy(false)
      return
    }
    setBusy(true)
    let alive = true
    const timer = window.setTimeout(() => {
      const request: SearchOptions = { ...opts, include }
      void api.files.search(root, query, request).then((r) => {
        if (!alive || r.error === 'cancelled') return
        setResult(r)
        setCollapsed(new Set())
        setBusy(false)
      })
    }, 300)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query, include, opts, root])

  const toggle = (file: string) =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (!next.delete(file)) next.add(file)
      return next
    })

  const box = 'h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none placeholder:text-text-faint focus:border-brand'
  const toggleBtn = (on: boolean) =>
    cn('inline-flex size-6 shrink-0 items-center justify-center rounded', on ? 'bg-brand/25 text-foreground' : 'text-text-subtle hover:bg-border hover:text-foreground')

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-1.5 border-b border-border p-2">
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            spellCheck={false}
            placeholder="Cerca nei file"
            aria-label="Testo da cercare nei file"
            className={box}
          />
          <button type="button" aria-pressed={opts.caseSensitive} title="Maiuscole e minuscole" aria-label="Maiuscole e minuscole" onClick={() => setOption({ caseSensitive: !opts.caseSensitive })} className={toggleBtn(opts.caseSensitive)}>
            <CaseSensitive size={15} />
          </button>
          <button type="button" aria-pressed={opts.wholeWord} title="Parola intera" aria-label="Parola intera" onClick={() => setOption({ wholeWord: !opts.wholeWord })} className={toggleBtn(opts.wholeWord)}>
            <WholeWord size={15} />
          </button>
          <button type="button" aria-pressed={opts.regex} title="Espressione regolare" aria-label="Espressione regolare" onClick={() => setOption({ regex: !opts.regex })} className={toggleBtn(opts.regex)}>
            <Regex size={15} />
          </button>
        </div>
        <input
          value={include}
          onChange={(e) => setInclude(e.target.value)}
          spellCheck={false}
          placeholder="File da includere (es. *.ts, src/**)"
          aria-label="File da includere"
          className={cn(box, 'w-full flex-none')}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1" role="tree" aria-label="Risultati della ricerca">
        {!root && <p className="px-3 py-6 text-center text-[12px] text-text-faint">Nessuna cartella di progetto: apri un terminale o scegli una cartella nell&apos;Esplora file.</p>}
        {root && !query && <p className="px-3 py-6 text-center text-[12px] text-text-faint">Scrivi per cercare in tutti i file di «{root.split(/[\\/]/).filter(Boolean).pop()}».</p>}
        {result && !result.ok && <p className="px-3 py-3 text-[12px] text-danger">{result.error}</p>}
        {result?.ok && result.files.length === 0 && !busy && <p className="px-3 py-6 text-center text-[12px] text-text-faint">Nessun risultato per «{query}».</p>}
        {result?.ok &&
          result.files.map((f) => {
            const name = f.file.slice(f.file.lastIndexOf('\\') + 1)
            const dir = f.file.includes('\\') ? f.file.slice(0, f.file.lastIndexOf('\\')) : ''
            const open = !collapsed.has(f.file)
            return (
              <div key={f.file}>
                <button type="button" onClick={() => toggle(f.file)} title={f.file} className="flex h-6 w-full items-center gap-1 px-1.5 text-left text-[12px] hover:bg-surface-2">
                  {open ? <ChevronDown size={12} className="shrink-0 text-text-faint" /> : <ChevronRight size={12} className="shrink-0 text-text-faint" />}
                  <FileIcon name={name} size={14} />
                  <span className="truncate font-medium text-foreground">{name}</span>
                  {dir && <span className="min-w-0 truncate text-[11px] text-text-faint">{dir}</span>}
                  <span className="ml-auto shrink-0 rounded-full bg-border px-1.5 text-[10px] text-text-muted">{f.matches.length}</span>
                </button>
                {open &&
                  f.matches.map((m, i) => (
                    <button
                      key={`${m.line}:${m.column}:${i}`}
                      type="button"
                      role="treeitem"
                      onClick={() => openFile(joinNative(result.root, f.file), { line: m.line, column: m.column }, result.root)}
                      title={`Riga ${m.line}`}
                      className="flex h-[22px] w-full items-center gap-2 pr-2 pl-7 text-left font-mono text-[11px] text-text-muted hover:bg-surface-2 hover:text-foreground"
                    >
                      <span className="truncate whitespace-pre">
                        {m.text.slice(0, m.start).trimStart()}
                        <mark className="rounded-sm bg-brand/35 text-foreground">{m.text.slice(m.start, m.end)}</mark>
                        {m.text.slice(m.end)}
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] text-text-faint">{m.line}</span>
                    </button>
                  ))}
              </div>
            )
          })}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-2.5 py-1.5 text-[11px] text-text-subtle">
        {busy ? (
          <span>Ricerca in corso…</span>
        ) : result?.ok && query ? (
          <span>
            {result.total} {result.total === 1 ? 'risultato' : 'risultati'} in {result.files.length} {result.files.length === 1 ? 'file' : 'file'}
            {result.truncated ? ' (elenco troncato)' : ''}
          </span>
        ) : (
          <span>Ctrl+Maiusc+F</span>
        )}
      </div>
    </div>
  )
}
