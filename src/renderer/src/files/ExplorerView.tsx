import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen, FolderTree, GitBranch, LayoutList, RefreshCw } from 'lucide-react'
import { normPath, type DirEntry, type GitMark, type GitStatus } from '@shared/files'
import { isOpen } from '@shared/changes'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useChanges } from '@/state/changes'
import { openFile, useEditor } from '@/state/editor'
import { useSessions } from '@/state/sessions'
import { workdirForSpace } from '@/state/project'
import { useSidebar } from '@/state/sidebar'
import { useWorkspace } from '@/state/workspace'
import { isInside } from '@shared/textEdits'
import { moveInto, parentOf, relativeTo, requestMove, requestRename, topLevel } from '@/state/fileOps'
import { FileIcon } from '@/lib/fileIcons'
import { PluginFrame, type ExplorerDecor } from '@/plugins/PluginFrame'
import { menuItems, resourceContext, runMenuItem } from '@/plugins/extensions'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui-kit'

const MARK_COLORS: Record<GitMark, string> = {
  M: 'var(--cct-warn)',
  A: 'var(--cct-ok)',
  D: 'var(--cct-danger)',
  R: 'var(--cct-info)',
  U: 'var(--cct-danger)'
}

interface Root {
  path: string
  /** Cartella aggiuntiva (--add-dir di una sessione), non il progetto principale. */
  extra: boolean
}

/**
 * Esplora file (F1), nella barra laterale fissa: albero del workspace e delle cartelle aggiuntive, con i file
 * modificati segnati M, A o D (stato git), quelli toccati da Claude in attesa di revisione e quelli con errori.
 * Segue lo spazio attivo; la cartella scelta a mano si ricorda per spazio.
 */
export function ExplorerView() {
  const spaceId = useWorkspace((s) => s.activeSpaceId)
  const saved = useSidebar((s) => s.cwdBySheet[spaceId] ?? '')
  const [cwd, setCwdState] = useState(saved)
  const setCwd = (dir: string) => {
    setCwdState(dir)
    useSidebar.getState().setSpaceCwd(spaceId, dir)
  }
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [git, setGit] = useState<GitStatus | null>(null)
  const sessions = useSessions((s) => s.sessions)
  const changes = useChanges((s) => s.changes)
  const diagnostics = useEditor((s) => s.diagnostics)
  // Viste alternative portate dai plugin attivi (es. «Package» del plugin Java): l'app non sa cosa siano, mostra
  // la pagina del plugin in un iframe isolato. Senza plugin con viste, l'Esplora file è solo l'albero delle cartelle.
  const plugins = useEditor((s) => s.plugins)
  const contributed = useMemo(
    () =>
      plugins
        .filter((p) => p.enabled && p.state === 'ok')
        .flatMap((p) => (p.manifest.contributes?.explorerViews ?? []).map((v) => ({ key: `${p.manifest.id}:${v.id}`, pluginId: p.manifest.id, title: v.title, entry: v.entry }))),
    [plugins]
  )
  const [view, setViewState] = useState<string | null>(null)
  useEffect(() => {
    void api.settings.get('explorer.view').then((v) => typeof v === 'string' && setViewState(v))
  }, [])
  const setView = (v: string) => {
    setViewState(v)
    void api.settings.set('explorer.view', v)
  }
  // Scelta salvata se esiste ancora; altrimenti la prima vista dei plugin (se ce ne sono) o l'albero.
  const active = view === 'files' ? null : (contributed.find((c) => c.key === view) ?? (view === null ? contributed[0] : undefined) ?? null)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  // Cartella: quella del pannello, altrimenti un terminale aperto, altrimenti l'ultimo progetto.
  // Al cambio di spazio si passa alla cartella di quel spazio (quella scelta a mano, se c'è).
  useEffect(() => {
    setCwdState(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId])
  useEffect(() => {
    if (cwd) return
    // Con un progetto aperto: la cartella del contesto dello spazio (J7).
    const workdir = workdirForSpace(spaceId)
    if (workdir) {
      setCwdState(workdir)
      return
    }
    const live = Object.values(sessions).find((s) => s.status !== 'exited')
    if (live) setCwdState(live.cwd)
    else void api.env.recentProjects().then(async (list) => setCwdState(list[0]?.cwd ?? (await api.env.homeDir())))
  }, [cwd, sessions, spaceId])

  // Cartelle aggiuntive delle sessioni aperte su questo progetto.
  const roots: Root[] = useMemo(() => {
    if (!cwd) return []
    const extra = new Set<string>()
    for (const s of Object.values(sessions)) {
      if (s.status === 'exited' || normPath(s.cwd) !== normPath(cwd)) continue
      for (const d of s.addDirs ?? []) extra.add(/^[a-zA-Z]:|^\\\\/.test(d) ? d : `${cwd}\\${d}`)
    }
    return [{ path: cwd, extra: false }, ...[...extra].map((path) => ({ path, extra: true }))]
  }, [cwd, sessions])

  const loadDir = useCallback(async (dir: string) => {
    try {
      const list = await api.files.list(dir)
      setChildren((c) => ({ ...c, [normPath(dir)]: list }))
    } catch {
      setChildren((c) => ({ ...c, [normPath(dir)]: [] }))
    }
  }, [])

  const refreshGit = useCallback(() => {
    if (cwd) void api.files.gitStatus(cwd).then(setGit)
  }, [cwd])

  // Avvio: radici aperte, stato git, osservazione delle modifiche.
  useEffect(() => {
    if (!cwd) return
    useSidebar.getState().setExplorerCwd(cwd)
    setExpanded(new Set(roots.map((r) => normPath(r.path))))
    for (const r of roots) {
      void loadDir(r.path)
      api.files.watch(r.path)
    }
    refreshGit()
    const off = api.files.onChanged((root, paths) => {
      if (!roots.some((r) => normPath(r.path) === normPath(root))) return
      // Si ricaricano solo le cartelle aperte che contengono qualcosa di cambiato.
      // Si usa il percorso reale della cartella (con le sue maiuscole), non la chiave normalizzata: altrimenti le voci
      // ricaricate avrebbero percorsi in minuscolo.
      const dirs = new Map(paths.map((p) => p.replace(/[\\/][^\\/]*$/, '')).map((d) => [normPath(d), d] as const))
      for (const d of expandedRef.current) {
        const real = dirs.get(d)
        if (real) void loadDir(real)
      }
      refreshGit()
    })
    return () => {
      off()
      for (const r of roots) api.files.unwatch(r.path)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots.map((r) => r.path).join('|')])

  // ---- Selezione, trascinamento e operazioni sui file (rinomina, sposta, copia) ----
  const [selected, setSelected] = useState<string[]>([])
  const isSelected = (path: string) => selected.some((p) => normPath(p) === normPath(path))
  const rootOf = (path: string) => roots.find((r) => isInside(path, r.path))?.path ?? cwd
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const dragging = useRef<string[]>([])
  const hoverTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])

  const select = (e: React.MouseEvent, path: string) => {
    if (e.ctrlKey || e.metaKey) setSelected((s) => (s.some((p) => normPath(p) === normPath(path)) ? s.filter((p) => normPath(p) !== normPath(path)) : [...s, path]))
    else setSelected([path])
  }
  /** Gli elementi su cui agiscono i comandi: la selezione, senza quelli dentro un'altra cartella selezionata. */
  const targets = (entry?: DirEntry) => topLevel(entry && !isSelected(entry.path) ? [entry.path] : selected)
  const afterOp = (p: Promise<boolean>) => void p.then((ok) => ok && setSelected([]))
  const rename = (entry: DirEntry) => requestRename(entry.path, rootOf(entry.path), entry.dir)
  const entryAt = (path: string): DirEntry | undefined => Object.values(children).flat().find((e) => normPath(e.path) === normPath(path))

  const onTreeKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || !selected.length) return
    if (e.key === 'F2' && selected.length === 1) {
      const entry = entryAt(selected[0])
      if (entry) rename(entry)
    } else if (e.key === 'F6' || e.key === 'F5') {
      requestMove(topLevel(selected), rootOf(selected[0]), e.key === 'F5')
    } else return
    e.preventDefault()
    e.stopPropagation()
  }

  /** Cartella che riceve il rilascio: l'elemento stesso se è una cartella, altrimenti quella che lo contiene. */
  const dropDirFor = (entry: DirEntry) => (entry.dir ? entry.path : parentOf(entry.path))
  const dragOverDir = (e: React.DragEvent, dir: string, autoOpen: boolean) => {
    if (!dragging.current.length) return
    e.preventDefault()
    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'
    if (dropTarget !== dir) {
      setDropTarget(dir)
      window.clearTimeout(hoverTimer.current)
      // Una cartella chiusa si apre dopo un po', per arrivare alle sottocartelle.
      if (autoOpen && !expandedRef.current.has(normPath(dir))) hoverTimer.current = window.setTimeout(() => toggle(dir), 700)
    }
  }
  const dropOnDir = (e: React.DragEvent, dir: string) => {
    if (!dragging.current.length) return
    e.preventDefault()
    window.clearTimeout(hoverTimer.current)
    setDropTarget(null)
    const paths = dragging.current
    dragging.current = []
    afterOp(moveInto(paths, dir, rootOf(dir), e.ctrlKey))
  }

  const toggle = (path: string) => {
    const key = normPath(path)
    const next = new Set(expanded)
    if (next.has(key)) next.delete(key)
    else {
      next.add(key)
      if (!children[key]) void loadDir(path)
    }
    setExpanded(next)
  }

  // File con modifiche di Claude in attesa (dal pannello Modifiche).
  const pendingByClaude = useMemo(() => new Set(changes.filter(isOpen).map((c) => normPath(c.filePath))), [changes])
  const errorsByFile = useMemo(() => {
    const m = new Map<string, number>()
    for (const [k, d] of Object.entries(diagnostics)) {
      const n = d.diagnostics.filter((x) => x.severity === 1).length
      if (n) m.set(k, n)
    }
    return m
  }, [diagnostics])
  // Una cartella è «segnata» se contiene file segnati.
  const markOf = (path: string, dir: boolean): GitMark | null => {
    const key = normPath(path)
    if (!git) return null
    if (!dir) return git.files[key] ?? null
    const prefix = key + '\\'
    return Object.keys(git.files).some((f) => f.startsWith(prefix)) ? 'M' : null
  }

  const renderEntries = (dir: string, depth: number) => {
    const list = children[normPath(dir)]
    if (!list) return <div style={{ paddingLeft: 12 + depth * 14 }} className="py-0.5 text-[12px] text-text-faint">…</div>
    if (!list.length) return <div style={{ paddingLeft: 12 + depth * 14 }} className="py-0.5 text-[12px] text-text-faint">vuota</div>
    return list.map((e) => renderEntry(e, depth))
  }

  // Voci dei plugin nel menu del tasto destro (`contributes.menus['explorer/context']`). Funzione che restituisce JSX, non componente.
  function pluginMenu(entry: DirEntry) {
    const paths = targets(entry)
    const ctx = { ...resourceContext(entry.path), isDir: entry.dir, multiple: paths.length > 1, selection: paths.join('\n') }
    const items = menuItems(plugins, 'explorer/context', ctx)
    if (!items.length) return null
    return (
      <>
        <ContextMenuSeparator />
        {items.map((it) => (
          <ContextMenuItem key={it.key} onSelect={() => runMenuItem(it, ctx)} title={it.pluginName}>
            {it.command.title}
          </ContextMenuItem>
        ))}
      </>
    )
  }

  // Funzione e non componente: se fosse un componente definito qui dentro, a ogni disegno dell'Esplora file
  // React lo vedrebbe come un tipo nuovo e lo ricreerebbe, chiudendo il menu del tasto destro appena aperto.
  function renderEntry(entry: DirEntry, depth: number) {
    const key = normPath(entry.path)
    const open = expanded.has(key)
    const mark = markOf(entry.path, entry.dir)
    const claude = !entry.dir && pendingByClaude.has(key)
    const errors = !entry.dir ? errorsByFile.get(key) : undefined
    return (
      <Fragment key={entry.path}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              draggable
              onClick={(e) => {
                select(e, entry.path)
                if (e.ctrlKey || e.metaKey) return
                if (entry.dir) toggle(entry.path)
                else openFile(entry.path, undefined, cwd)
              }}
              onContextMenu={() => !isSelected(entry.path) && setSelected([entry.path])}
              onDragStart={(e) => {
                const paths = topLevel(isSelected(entry.path) ? selected : [entry.path])
                if (!isSelected(entry.path)) setSelected([entry.path])
                dragging.current = paths
                e.dataTransfer.effectAllowed = 'copyMove'
                e.dataTransfer.setData('text/plain', paths.join('\n'))
              }}
              onDragEnd={() => {
                dragging.current = []
                window.clearTimeout(hoverTimer.current)
                setDropTarget(null)
              }}
              onDragOver={(e) => dragOverDir(e, dropDirFor(entry), entry.dir)}
              onDrop={(e) => dropOnDir(e, dropDirFor(entry))}
              title={entry.path}
              className={cn(
                'flex h-[22px] w-full items-center gap-1 rounded pr-2 text-left text-[12px] text-text-muted hover:bg-surface-2 hover:text-foreground',
                isSelected(entry.path) && 'bg-border text-foreground',
                dropTarget && normPath(dropTarget) === normPath(dropDirFor(entry)) && entry.dir && 'bg-brand/25 ring-1 ring-brand'
              )}
              style={{ paddingLeft: 6 + depth * 14 }}
            >
              {entry.dir ? (
                <>
                  {open ? <ChevronDown size={12} className="shrink-0 text-text-faint" /> : <ChevronRight size={12} className="shrink-0 text-text-faint" />}
                  <FileIcon name={entry.name} dir open={open} size={16} />
                </>
              ) : (
                <>
                  <span className="w-3 shrink-0" />
                  <FileIcon name={entry.name} size={16} />
                </>
              )}
              <span className="min-w-0 truncate" style={mark && !entry.dir ? { color: MARK_COLORS[mark] } : undefined}>
                {entry.name}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[10px]">
                {claude && <span className="rounded bg-info/15 px-1 text-info" title="Modifica di Claude in attesa di revisione">Claude</span>}
                {errors && <span className="text-danger" title={`${errors} errori`}>{errors}</span>}
                {mark && (entry.dir ? <span className="size-1.5 rounded-full" style={{ background: MARK_COLORS[mark] }} /> : <span style={{ color: MARK_COLORS[mark] }}>{mark}</span>)}
              </span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {!entry.dir && <ContextMenuItem onSelect={() => openFile(entry.path, undefined, cwd)}>Apri</ContextMenuItem>}
            <ContextMenuItem onSelect={() => void api.files.reveal(entry.path)}>Mostra in Esplora risorse</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={selected.length > 1 && isSelected(entry.path)} onSelect={() => rename(entry)}>
              Rinomina…
              <span className="ml-auto pl-6 font-mono text-[10px] text-text-faint">F2</span>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => requestMove(targets(entry), rootOf(entry.path), false)}>
              Sposta in…
              <span className="ml-auto pl-6 font-mono text-[10px] text-text-faint">F6</span>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => requestMove(targets(entry), rootOf(entry.path), true)}>
              Copia in…
              <span className="ml-auto pl-6 font-mono text-[10px] text-text-faint">F5</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(entry.path)}>Copia percorso</ContextMenuItem>
            <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(relativeTo(rootOf(entry.path), entry.path))}>Copia percorso relativo</ContextMenuItem>
            {pluginMenu(entry)}
          </ContextMenuContent>
        </ContextMenu>
        {entry.dir && open && renderEntries(entry.path, depth + 1)}
      </Fragment>
    )
  }

  // Stato dei file per le viste dei plugin: le stesse informazioni dell'albero, in chiavi normalizzate.
  const decorForPlugin = useMemo<ExplorerDecor>(
    () => ({ git: git?.files ?? {}, claude: [...pendingByClaude], errors: Object.fromEntries(errorsByFile) }),
    [git, pendingByClaude, errorsByFile]
  )
  const errorTotal = [...errorsByFile.values()].reduce((a, b) => a + b, 0)
  const warnTotal = Object.values(diagnostics).reduce((a, d) => a + d.diagnostics.filter((x) => x.severity === 2).length, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
        <input
          value={cwd}
          onChange={(e) => setCwdState(e.target.value)}
          onBlur={() => useSidebar.getState().setSpaceCwd(spaceId, cwd)}
          spellCheck={false}
          aria-label="Cartella del progetto"
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-brand"
        />
        <button
          type="button"
          title="Scegli la cartella"
          onClick={async () => {
            const dir = await api.env.pickFolder(cwd)
            if (dir) setCwd(dir)
          }}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-subtle hover:bg-border hover:text-foreground"
        >
          <FolderOpen size={13} />
        </button>
        <button
          type="button"
          title="Aggiorna"
          onClick={() => {
            for (const d of expanded) void loadDir(d)
            refreshGit()
          }}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-subtle hover:bg-border hover:text-foreground"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {contributed.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1" role="group" aria-label="Vista dell'Esplora file">
          {[...contributed.map((c) => ({ key: c.key, title: c.title, icon: LayoutList })), { key: 'files', title: 'File', icon: FolderTree }].map(({ key, title, icon: Icon }) => {
            const on = key === 'files' ? active === null : active?.key === key
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => setView(key)}
                className={cn('inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px]', on ? 'bg-border text-foreground' : 'text-text-subtle hover:text-foreground')}
              >
                <Icon size={12} /> {title}
              </button>
            )
          })}
        </div>
      )}
      {active && cwd ? (
        <div className="min-h-0 flex-1">
          <PluginFrame pluginId={active.pluginId} entry={active.entry} cwd={cwd} decor={decorForPlugin} />
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-auto py-1 outline-none" role="tree" aria-label="File del progetto" tabIndex={0} onKeyDown={onTreeKey}>
        {roots.map((r) => {
          const key = normPath(r.path)
          const open = expanded.has(key)
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => toggle(r.path)}
                onDragOver={(e) => dragOverDir(e, r.path, true)}
                onDrop={(e) => dropOnDir(e, r.path)}
                className={cn(
                  'flex h-6 w-full items-center gap-1 px-1.5 text-left text-[12px] font-semibold text-foreground hover:bg-surface-2',
                  dropTarget && normPath(dropTarget) === key && 'bg-brand/25 ring-1 ring-brand'
                )}
                title={r.path}
              >
                {open ? <ChevronDown size={12} className="text-text-faint" /> : <ChevronRight size={12} className="text-text-faint" />}
                <span className="truncate">{r.path.split(/[\\/]/).filter(Boolean).pop()}</span>
                {r.extra && <span className="ml-1 rounded border border-border px-1 font-mono text-[10px] font-normal text-text-faint">add-dir</span>}
              </button>
              {open && renderEntries(r.path, 1)}
            </div>
          )
        })}
      </div>
      )}
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-2.5 py-1.5 text-[11px] text-text-subtle">
        {git?.branch && (
          <span className="inline-flex min-w-0 items-center gap-1 truncate">
            <GitBranch size={11} /> {git.branch}
          </span>
        )}
        <span className={cn('ml-auto shrink-0', errorTotal ? 'text-danger' : '')}>
          {errorTotal} {errorTotal === 1 ? 'errore' : 'errori'}
        </span>
        <span className={cn('shrink-0', warnTotal ? 'text-warn' : '')}>
          {warnTotal} {warnTotal === 1 ? 'avviso' : 'avvisi'}
        </span>
      </div>
    </div>
  )
}
