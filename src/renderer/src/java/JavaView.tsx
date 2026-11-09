import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Bug, ChevronDown, ChevronRight, CircleDot, Download, Pause, Pencil, Play, Plus, RefreshCw, RotateCcw, SkipForward, Square, Trash2, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui-kit'
import type { DebugVariable, IdeaImportResult, JdkInfo, RunConfig } from '@shared/java'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { openFile, openPluginsPanel } from '@/state/editor'
import { useJavaDev } from '@/state/javaDev'
import { rootForSheet } from '@/state/sidebar'
import { useWorkspace } from '@/state/workspace'
import { ConfigDialog } from './ConfigDialog'

const TEMURIN = [8, 11, 17, 21, 25]
const sel = 'h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-[12px] text-foreground outline-none focus:border-brand'
const iconBtn = 'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-subtle hover:bg-border hover:text-foreground disabled:opacity-40'

function Section({ title, right, defaultOpen = true, children }: { title: string; right?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-border">
      <div className="flex h-7 items-center gap-1 px-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold tracking-wide text-text-subtle uppercase">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
        </button>
        {right}
      </div>
      {open && <div className="pb-2">{children}</div>}
    </section>
  )
}

/** Albero delle variabili: i figli si caricano quando si apre il nodo. */
function VarNode({ v, depth }: { v: DebugVariable; depth: number }) {
  const [open, setOpen] = useState(false)
  const [kids, setKids] = useState<DebugVariable[] | null>(null)
  const toggle = () => {
    if (!v.ref) return
    if (!open && !kids) void api.java.variables(v.ref).then(setKids)
    setOpen((o) => !o)
  }
  return (
    <>
      <button type="button" onClick={toggle} title={v.type} className="flex h-[21px] w-full items-center gap-1 pr-2 text-left font-mono text-[11px] hover:bg-surface-2" style={{ paddingLeft: 6 + depth * 12 }}>
        <span className="w-3 shrink-0 text-text-faint">{v.ref ? open ? <ChevronDown size={11} /> : <ChevronRight size={11} /> : null}</span>
        <span className="shrink-0 text-info">{v.name}</span>
        <span className="text-text-faint">=</span>
        <span className="min-w-0 truncate text-text-muted">{v.value}</span>
      </button>
      {open && kids?.map((k, i) => <VarNode key={`${k.name}:${i}`} v={k} depth={depth + 1} />)}
    </>
  )
}

function Variables({ frameId, version }: { frameId: number | undefined; version: string }) {
  const [vars, setVars] = useState<DebugVariable[]>([])
  useEffect(() => {
    let alive = true
    setVars([])
    if (frameId === undefined) return
    void api.java.scopes(frameId).then(async (scopes) => {
      const all: DebugVariable[] = []
      for (const s of scopes) all.push(...(await api.java.variables(s.ref)))
      if (alive) setVars(all)
    })
    return () => {
      alive = false
    }
  }, [frameId, version])
  if (!vars.length) return <p className="px-3 py-1 text-[11px] text-text-faint">Nessuna variabile.</p>
  return <>{vars.map((v, i) => <VarNode key={`${v.name}:${i}`} v={v} depth={0} />)}</>
}

function ImportDialog({ result, onClose, onImport }: { result: IdeaImportResult | null; onClose(): void; onImport(list: RunConfig[]): void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  useEffect(() => setPicked(new Set(result?.configs.map((c) => c.id) ?? [])), [result])
  return (
    <Dialog open={result !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogTitle>Importa da IntelliJ IDEA</DialogTitle>
        <DialogDescription className="text-[12px] text-text-subtle">Run configuration trovate nel progetto (.idea/runConfigurations, .run, workspace.xml).</DialogDescription>
        <div className="mt-3 space-y-1">
          {result?.configs.length === 0 && <p className="text-[12px] text-text-subtle">Nessuna configurazione importabile.</p>}
          {result?.configs.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => setPicked((p) => (p.delete(c.id) || p.add(c.id) ? new Set(p) : new Set(p)))} className="mt-0.5" />
              <span className="min-w-0 text-[12px]">
                <span className="font-medium text-foreground">{c.name}</span> <span className="text-text-faint">· {c.type}</span>
                <span className="block truncate font-mono text-[11px] text-text-subtle">{c.goals ?? c.tasks ?? c.mainClass ?? `${c.host}:${c.port}`}</span>
                <span className="block truncate font-mono text-[10.5px] text-text-faint">{c.root}</span>
              </span>
            </label>
          ))}
        </div>
        {result && result.warnings.length > 0 && (
          <ul className="mt-3 space-y-0.5 rounded-md border border-warn/40 bg-warn/10 p-2 text-[11px] text-warn">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 rounded-md px-3 text-[12px] text-text-subtle hover:bg-border hover:text-foreground">
            Annulla
          </button>
          <button type="button" disabled={!picked.size} onClick={() => result && onImport(result.configs.filter((c) => picked.has(c.id)))} className="h-8 rounded-md bg-brand px-4 text-[12px] font-semibold text-on-brand disabled:opacity-40">
            Importa {picked.size || ''}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** «Esegui e debug»: configurazioni, servizi e JDK, e durante il debug stack, variabili, espressioni e console. */
export function JavaView() {
  const sheetId = useWorkspace((s) => s.activeSheetId)
  const state = useJavaDev((s) => s.state)
  const debug = useJavaDev((s) => s.debug)
  const output = useJavaDev((s) => s.output)
  const progress = useJavaDev((s) => s.progress)
  const breakpoints = useJavaDev((s) => s.breakpoints)
  const root = rootForSheet(sheetId)
  const [selected, setSelected] = useState('')
  const [editing, setEditing] = useState<{ cfg: RunConfig | null } | null>(null)
  const [imported, setImported] = useState<IdeaImportResult | null>(null)
  const [note, setNote] = useState('')
  const [frameIdx, setFrameIdx] = useState(0)
  const [expr, setExpr] = useState('')
  const [evals, setEvals] = useState<{ expr: string; text: string; error?: boolean }[]>([])
  const outRef = useRef<HTMLDivElement>(null)

  useEffect(() => void useJavaDev.getState().refresh(root), [sheetId, root])
  useEffect(() => setFrameIdx(0), [debug.frames[0]?.id])
  // Con le parentesi graffe: scrollTo() restituisce una Promise e un effetto che restituisce un valore diverso da una funzione
  // fa fallire React alla chiusura («destroy is not a function») e smonta tutta l'interfaccia (finestra nera).
  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight })
  }, [output.length])

  const configs = state?.configs ?? []
  const current = configs.find((c) => c.id === selected) ?? configs[0]
  const active = debug.status === 'starting' || debug.status === 'running' || debug.status === 'paused'
  const frame = debug.frames[frameIdx]
  const jdkLabel = (j: JdkInfo) => `${j.vendor || 'JDK'} ${j.version}${j.source === 'temurin' ? ' (scaricato)' : ''}`
  const bpList = useMemo(() => Object.entries(breakpoints).flatMap(([file, list]) => list.map((b) => ({ file, key: file, ...b }))), [breakpoints])

  if (!state) return <p className="p-4 text-[12px] text-text-faint">Caricamento…</p>
  if (!state.enabled) {
    return (
      <div className="space-y-3 p-4 text-[12px] text-text-subtle">
        <p>Il <b className="text-foreground">Java development pack</b> non è installato.</p>
        <p>Porta il debugger Java (anche per Quarkus, Maven e Gradle), le run configuration, l&apos;importazione da IntelliJ e il supporto a Lombok. Richiede il plugin Java.</p>
        <button type="button" onClick={openPluginsPanel} className="h-8 rounded-md bg-brand px-3 font-semibold text-on-brand">
          Apri i plugin
        </button>
      </div>
    )
  }

  const run = async (mode: 'run' | 'debug') => {
    if (!current) return
    setNote('')
    const r = mode === 'run' ? await api.java.run(current.id, root) : await api.java.debug(current.id, root)
    if (!r.ok && r.error) setNote(r.error)
  }
  const control = async (a: 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut') => {
    const r = await api.java.control(a)
    if (!r.ok && r.error) setNote(r.error)
  }
  const doEval = async () => {
    const e = expr.trim()
    if (!e) return
    setExpr('')
    const r = await api.java.evaluate(e, frame?.id)
    setEvals((l) => [...l, { expr: e, text: r.ok ? (r.result ?? '') : (r.error ?? 'Errore'), error: !r.ok }].slice(-40))
  }
  const startImport = async () => setImported(await api.java.importIdea(root))

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface text-[12px]">
      {/* Barra di esecuzione */}
      <div className="space-y-1.5 border-b border-border p-2">
        <div className="flex items-center gap-1">
          <select aria-label="Configurazione" value={current?.id ?? ''} onChange={(e) => setSelected(e.target.value)} disabled={active || !configs.length} className={sel}>
            {!configs.length && <option value="">Nessuna configurazione</option>}
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" aria-label="Esegui" title="Esegui (senza debug)" disabled={!current || active || current.type === 'attach'} onClick={() => void run('run')} className={cn(iconBtn, 'text-ok')}>
            <Play size={15} />
          </button>
          <button type="button" aria-label="Debug" title="Avvia in debug" disabled={!current || active} onClick={() => void run('debug')} className={cn(iconBtn, 'text-brand')}>
            <Bug size={15} />
          </button>
        </div>
        {active && (
          <div className="flex items-center gap-0.5" role="toolbar" aria-label="Controlli del debug">
            <button type="button" aria-label="Continua" title="Continua" disabled={debug.status !== 'paused'} onClick={() => void control('continue')} className={iconBtn}>
              <Play size={14} />
            </button>
            <button type="button" aria-label="Pausa" title="Pausa" disabled={debug.status !== 'running'} onClick={() => void control('pause')} className={iconBtn}>
              <Pause size={14} />
            </button>
            <button type="button" aria-label="Passo successivo" title="Passo successivo (step over)" disabled={debug.status !== 'paused'} onClick={() => void control('next')} className={iconBtn}>
              <SkipForward size={14} />
            </button>
            <button type="button" aria-label="Entra" title="Entra (step into)" disabled={debug.status !== 'paused'} onClick={() => void control('stepIn')} className={iconBtn}>
              <ArrowDownToLine size={14} />
            </button>
            <button type="button" aria-label="Esci" title="Esci (step out)" disabled={debug.status !== 'paused'} onClick={() => void control('stepOut')} className={iconBtn}>
              <ArrowUpFromLine size={14} />
            </button>
            <button type="button" aria-label="Riavvia" title="Riavvia" onClick={() => void api.java.restart()} className={iconBtn}>
              <RotateCcw size={14} />
            </button>
            <button type="button" aria-label="Ferma" title="Ferma il debug" onClick={() => void api.java.stop()} className={cn(iconBtn, 'text-danger')}>
              <Square size={14} />
            </button>
          </div>
        )}
        <p className={cn('min-h-4 text-[11px]', note || debug.status === 'terminated' && debug.message ? 'text-danger' : 'text-text-subtle')} role="status">
          {note || debug.message || (debug.status === 'paused' ? `Fermo${debug.reason ? ` (${debug.reason})` : ''}${frame ? ` · ${frame.name}` : ''}` : debug.status === 'running' ? 'In esecuzione' : '')}
        </p>
      </div>

      {progress && !progress.done && (
        <div className="border-b border-border px-3 py-1.5 text-[11px] text-text-subtle" role="status">
          {progress.error ? <span className="text-danger">{progress.error}</span> : `${progress.step} · ${Math.round(progress.progress * 100)}%`}
        </div>
      )}

      {active && debug.status === 'paused' && (
        <>
          <Section title="Stack">
            {debug.frames.map((f, i) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setFrameIdx(i)
                  if (f.path) openFile(f.path, { line: f.line, column: f.column ?? 1 })
                }}
                className={cn('flex h-[21px] w-full items-center gap-2 px-3 text-left font-mono text-[11px] hover:bg-surface-2', i === frameIdx ? 'bg-border text-foreground' : 'text-text-muted')}
              >
                <span className="min-w-0 truncate">{f.name}</span>
                <span className="ml-auto shrink-0 text-text-faint">{f.path ? `${f.path.split(/[\\/]/).pop()}:${f.line}` : f.line}</span>
              </button>
            ))}
          </Section>
          <Section title="Variabili">
            <Variables frameId={frame?.id} version={`${debug.frames[0]?.id}:${debug.frames[0]?.line}`} />
          </Section>
        </>
      )}

      {active && (
        <Section title="Console di debug">
          <div ref={outRef} className="max-h-40 overflow-auto px-3 font-mono text-[11px] whitespace-pre-wrap text-text-muted">
            {output.map((line, i) => (
              <div key={i} className={line.startsWith('●') ? 'text-text-subtle' : ''}>
                {line}
              </div>
            ))}
            {evals.map((e, i) => (
              <div key={`e${i}`} className={e.error ? 'text-danger' : 'text-info'}>
                {'> '}
                {e.expr}
                <div className="pl-3 text-text-muted">{e.text}</div>
              </div>
            ))}
          </div>
          <div className="px-2 pt-1.5">
            <input
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void doEval()}
              disabled={debug.status !== 'paused'}
              placeholder={debug.status === 'paused' ? 'Valuta un\'espressione…' : 'Disponibile quando il programma è fermo'}
              aria-label="Espressione da valutare"
              spellCheck={false}
              className={cn(sel, 'w-full flex-none font-mono')}
            />
          </div>
        </Section>
      )}

      <Section
        title="Breakpoint"
        defaultOpen={bpList.length > 0}
        right={
          bpList.length > 0 && (
            <button type="button" title="Togli tutti" aria-label="Togli tutti i breakpoint" className={iconBtn} onClick={() => bpList.forEach((b) => void useJavaDev.getState().toggleBreakpoint(b.file, b.line))}>
              <Trash2 size={12} />
            </button>
          )
        }
      >
        {bpList.length === 0 && <p className="px-3 py-1 text-[11px] text-text-faint">Clicca nel margine sinistro di un file .java per metterne uno.</p>}
        {bpList.map((b) => (
          <div key={`${b.key}:${b.line}`} className="group flex h-[22px] items-center gap-2 px-3 hover:bg-surface-2">
            <CircleDot size={11} className="shrink-0 text-danger" />
            <button type="button" onClick={() => openFile(b.file, { line: b.line, column: 1 })} className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-text-muted">
              {b.file.split(/[\\/]/).pop()}:{b.line}
            </button>
            <button type="button" aria-label="Togli il breakpoint" onClick={() => useJavaDev.getState().toggleBreakpoint(b.file, b.line)} className="hidden text-text-faint group-hover:inline-flex hover:text-foreground">
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </Section>

      <Section
        title="Configurazioni"
        right={
          <>
            <button type="button" title="Importa da IntelliJ IDEA" aria-label="Importa da IntelliJ" className={iconBtn} onClick={() => void startImport()}>
              <Upload size={13} />
            </button>
            <button type="button" title="Nuova configurazione" aria-label="Nuova configurazione" className={iconBtn} onClick={() => setEditing({ cfg: null })}>
              <Plus size={14} />
            </button>
          </>
        }
      >
        {configs.length === 0 && <p className="px-3 py-1 text-[11px] text-text-faint">Nessuna configurazione: creane una con «+» o importale da IntelliJ.</p>}
        {configs.map((c) => (
          <div key={c.id} className={cn('group flex h-[26px] items-center gap-1.5 px-3 hover:bg-surface-2', c.id === current?.id && 'bg-surface-2')}>
            <button type="button" onClick={() => setSelected(c.id)} className="min-w-0 flex-1 truncate text-left text-foreground" title={c.root}>
              {c.name}
              <span className="ml-1.5 text-[10.5px] text-text-faint">{c.type}{c.origin === 'intellij' ? ' · IntelliJ' : ''}</span>
            </button>
            <button type="button" aria-label={`Modifica ${c.name}`} onClick={() => setEditing({ cfg: c })} className="hidden text-text-faint group-hover:inline-flex hover:text-foreground">
              <Pencil size={12} />
            </button>
            <button type="button" aria-label={`Elimina ${c.name}`} onClick={() => void api.java.deleteConfig(c.id)} className="hidden text-text-faint group-hover:inline-flex hover:text-danger">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </Section>

      <Section title="Servizi Java" defaultOpen right={<button type="button" title="Cerca di nuovo" aria-label="Cerca di nuovo i servizi" className={iconBtn} onClick={() => void useJavaDev.getState().refresh(root, true)}><RefreshCw size={12} /></button>}>
        {state.services.length === 0 && <p className="px-3 py-1 text-[11px] text-text-faint">Nessun pom.xml o build.gradle in questa cartella.</p>}
        {state.services.map((s) => (
          <div key={s.id} className="px-3 py-1" style={{ paddingLeft: s.parent ? 22 : 12 }}>
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 truncate font-medium text-foreground" title={s.root}>
                {s.name}
              </span>
              <span className="shrink-0 rounded border border-border px-1 text-[10px] text-text-subtle">{s.build}</span>
              {s.framework !== 'plain' && <span className="shrink-0 rounded border border-brand/50 px-1 text-[10px] text-brand">{s.framework}</span>}
              {s.aggregator && <span className="shrink-0 text-[10px] text-text-faint">contenitore</span>}
              {s.javaVersion && <span className="ml-auto shrink-0 text-[10px] text-text-faint">Java {s.javaVersion}</span>}
            </div>
            {!s.aggregator && (
              <select aria-label={`JDK di ${s.name}`} value={state.serviceJdk[s.id] ?? ''} onChange={(e) => void api.java.setServiceJdk(s.root, e.target.value || null)} className={cn(sel, 'mt-1 w-full flex-none')}>
                <option value="">JDK predefinito</option>
                {state.jdks.map((j) => (
                  <option key={j.id} value={j.id}>
                    {jdkLabel(j)}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </Section>

      <Section title="JDK" defaultOpen={state.jdks.length === 0}>
        <div className="px-3 pb-1">
          <select aria-label="JDK predefinito" value={state.defaultJdk ?? ''} onChange={(e) => void api.java.setDefaultJdk(e.target.value || null)} className={cn(sel, 'w-full flex-none')}>
            <option value="">Predefinito: il più adatto al servizio</option>
            {state.jdks.map((j) => (
              <option key={j.id} value={j.id}>
                {jdkLabel(j)}
              </option>
            ))}
          </select>
        </div>
        {state.jdks.map((j) => (
          <div key={j.id} className="group flex h-6 items-center gap-2 px-3 text-text-muted">
            <span className="min-w-0 flex-1 truncate" title={j.path}>
              {jdkLabel(j)}
            </span>
            <span className="shrink-0 text-[10px] text-text-faint">{j.source === 'temurin' ? 'app' : j.source}</span>
            {j.source === 'temurin' && (
              <button type="button" aria-label={`Rimuovi ${jdkLabel(j)}`} onClick={() => void api.java.removeJdk(j.id)} className="hidden text-text-faint group-hover:inline-flex hover:text-danger">
                <Trash2 size={11} />
              </button>
            )}
          </div>
        ))}
        <p className="px-3 pt-1.5 pb-1 text-[11px] text-text-subtle">Scarica Eclipse Temurin:</p>
        <div className="flex flex-wrap gap-1 px-3">
          {TEMURIN.map((m) => {
            const have = state.jdks.some((j) => j.source === 'temurin' && j.major === m)
            return (
              <button key={m} type="button" disabled={have || (!!progress && !progress.done && !progress.error)} onClick={() => void api.java.downloadJdk(m)} className="inline-flex h-6 items-center gap-1 rounded border border-border px-2 text-[11px] text-text-muted hover:bg-border hover:text-foreground disabled:opacity-40">
                <Download size={11} /> {m}
              </button>
            )
          })}
        </div>
      </Section>

      <ConfigDialog
        open={editing !== null}
        initial={editing?.cfg ?? null}
        services={state.services}
        jdks={state.jdks}
        defaultRoot={root}
        onClose={() => setEditing(null)}
        onSave={(cfg) => {
          void api.java.saveConfig(cfg).then((saved) => setSelected(saved.id))
          setEditing(null)
        }}
      />
      <ImportDialog
        result={imported}
        onClose={() => setImported(null)}
        onImport={(list) => {
          for (const c of list) void api.java.saveConfig(c)
          setImported(null)
        }}
      />
    </div>
  )
}

