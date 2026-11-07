import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { ChevronDown, ChevronRight, File, FolderClosed, FolderOpen, GitBranch, RefreshCw } from 'lucide-react'
import { normPath, type DirEntry, type GitMark, type GitStatus } from '@shared/files'
import { isOpen } from '@shared/changes'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { PanelParams } from '@/panels/kinds'
import { useChanges } from '@/state/changes'
import { openFile, useEditor } from '@/state/editor'
import { useSessions } from '@/state/sessions'
import { workdirForSheet } from '@/state/project'
import { sheetOfPanel } from '@/workspace/panels'
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
 * Esplora file (F1): albero del workspace e delle cartelle aggiuntive, con i file modificati segnati
 * M, A o D (stato git), quelli toccati da Claude in attesa di revisione e quelli con errori.
 */
export function ExplorerPanel(props: IDockviewPanelProps<PanelParams>) {
  const [cwd, setCwd] = useState(props.params.cwd ?? '')
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [git, setGit] = useState<GitStatus | null>(null)
  const sessions = useSessions((s) => s.sessions)
  const changes = useChanges((s) => s.changes)
  const diagnostics = useEditor((s) => s.diagnostics)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  // Cartella: quella del pannello, altrimenti un terminale aperto, altrimenti l'ultimo progetto.
  useEffect(() => {
    if (cwd) return
    // Con un progetto aperto: la cartella del contesto del foglio (J7).
    const workdir = workdirForSheet(sheetOfPanel(props.containerApi))
    if (workdir) {
      setCwd(workdir)
      return
    }
    const live = Object.values(sessions).find((s) => s.status !== 'exited')
    if (live) setCwd(live.cwd)
    else void api.env.recentProjects().then(async (list) => setCwd(list[0]?.cwd ?? (await api.env.homeDir())))
  }, [cwd, sessions])

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
    props.api.updateParameters({ ...props.params, cwd })
    props.api.setTitle(`Esplora · ${cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd}`)
    setExpanded(new Set(roots.map((r) => normPath(r.path))))
    for (const r of roots) {
      void loadDir(r.path)
      api.files.watch(r.path)
    }
    refreshGit()
    const off = api.files.onChanged((root, paths) => {
      if (!roots.some((r) => normPath(r.path) === normPath(root))) return
      // Si ricaricano solo le cartelle aperte che contengono qualcosa di cambiato.
      const dirs = new Set(paths.map((p) => normPath(p.replace(/[\\/][^\\/]*$/, ''))))
      for (const d of expandedRef.current) if (dirs.has(d)) void loadDir(d)
      refreshGit()
    })
    return () => {
      off()
      for (const r of roots) api.files.unwatch(r.path)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots.map((r) => r.path).join('|')])

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
    return list.map((e) => <Entry key={e.path} entry={e} depth={depth} />)
  }

  function Entry({ entry, depth }: { entry: DirEntry; depth: number }) {
    const key = normPath(entry.path)
    const open = expanded.has(key)
    const mark = markOf(entry.path, entry.dir)
    const claude = !entry.dir && pendingByClaude.has(key)
    const errors = !entry.dir ? errorsByFile.get(key) : undefined
    return (
      <>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              onClick={() => (entry.dir ? toggle(entry.path) : openFile(entry.path, undefined, cwd))}
              title={entry.path}
              className="flex h-[22px] w-full items-center gap-1 rounded pr-2 text-left text-[12px] text-text-muted hover:bg-surface-2 hover:text-foreground"
              style={{ paddingLeft: 6 + depth * 14 }}
            >
              {entry.dir ? (
                <>
                  {open ? <ChevronDown size={12} className="shrink-0 text-text-faint" /> : <ChevronRight size={12} className="shrink-0 text-text-faint" />}
                  {open ? <FolderOpen size={13} className="shrink-0 text-text-subtle" /> : <FolderClosed size={13} className="shrink-0 text-text-subtle" />}
                </>
              ) : (
                <>
                  <span className="w-3 shrink-0" />
                  <File size={13} className="shrink-0 text-text-faint" />
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
            <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(entry.path)}>Copia percorso</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {entry.dir && open && renderEntries(entry.path, depth + 1)}
      </>
    )
  }

  const errorTotal = [...errorsByFile.values()].reduce((a, b) => a + b, 0)
  const warnTotal = Object.values(diagnostics).reduce((a, d) => a + d.diagnostics.filter((x) => x.severity === 2).length, 0)

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
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
      <div className="min-h-0 flex-1 overflow-auto py-1" role="tree" aria-label="File del progetto">
        {roots.map((r) => {
          const key = normPath(r.path)
          const open = expanded.has(key)
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => toggle(r.path)}
                className="flex h-6 w-full items-center gap-1 px-1.5 text-left text-[12px] font-semibold text-foreground hover:bg-surface-2"
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
