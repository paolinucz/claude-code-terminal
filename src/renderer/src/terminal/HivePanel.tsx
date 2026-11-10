import { useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { Maximize2, Minimize2, Square } from 'lucide-react'
import type { SessionInfo } from '@shared/sessions'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { PanelParams } from '@/panels/kinds'
import { gridFor, useHives } from '@/state/hives'
import { useSessions } from '@/state/sessions'
import { TerminalView } from './TerminalView'

/**
 * Vista «alveare»: più terminali insieme in un mosaico che si riorganizza in base al numero di celle e alle dimensioni del
 * pannello. Ogni cella si può ingrandire (doppio clic sulla testata o pulsante): le altre restano in esecuzione, nascoste, e
 * si passa dall'una all'altra dalle linguette in alto. Il contenuto lo decide chi apre il pannello (un plugin), qui c'è solo la vista.
 */
export function HivePanel(props: IDockviewPanelProps<PanelParams>) {
  const key = props.params.hiveKey ?? ''
  const hive = useHives((s) => s.hives[key])
  const sessions = useSessions((s) => s.sessions)
  const [maximized, setMaximized] = useState<string | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const ids = useMemo(() => hive?.sessionIds ?? [], [hive])

  useEffect(() => {
    const el = grid.current
    if (!el) return
    const watch = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  // La scheda segue il titolo del gruppo.
  useEffect(() => {
    if (hive && props.api.title !== hive.title) props.api.setTitle(hive.title)
  }, [hive, props.api])

  // Una cella ingrandita che sparisce dal gruppo: si torna al mosaico.
  useEffect(() => {
    if (maximized && !ids.includes(maximized)) setMaximized(null)
  }, [ids, maximized])

  const running = ids.filter((id) => sessions[id] && sessions[id].status !== 'exited')
  const { cols, rows } = gridFor(maximized ? 1 : ids.length, size.w, size.h)

  if (!hive) {
    return <div className="flex h-full items-center justify-center bg-surface p-5 text-text-subtle">Gruppo di terminali non più disponibile.</div>
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-2.5 text-[12px]">
        <span className="font-semibold text-foreground">{hive.title}</span>
        <span className="text-text-faint">
          {ids.length} {ids.length === 1 ? 'terminale' : 'terminali'} · {running.length} in esecuzione
        </span>
        <nav className="ml-2 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Terminali del gruppo">
          {maximized &&
            ids.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setMaximized(id)}
                className={cn(
                  'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px]',
                  id === maximized ? 'border-brand/60 bg-brand/15 text-foreground' : 'border-border text-text-muted hover:text-foreground'
                )}
              >
                <StatusDot session={sessions[id]} />
                {sessions[id]?.title ?? 'Terminale'}
              </button>
            ))}
        </nav>
        {maximized && (
          <button type="button" onClick={() => setMaximized(null)} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-muted hover:text-foreground">
            <Minimize2 size={12} /> Mosaico
          </button>
        )}
        <button
          type="button"
          disabled={!running.length}
          onClick={() => running.forEach((id) => void api.sessions.kill(id))}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-text-muted hover:text-danger disabled:opacity-40"
        >
          <Square size={11} /> Ferma tutti
        </button>
      </header>

      <div
        ref={grid}
        className="grid min-h-0 flex-1 gap-2 p-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
        data-cols={cols}
        data-rows={rows}
      >
        {ids.map((id) => (
          <HiveCell
            key={id}
            sessionId={id}
            session={sessions[id]}
            viewPrefix={props.api.id}
            maximized={maximized === id}
            hidden={maximized !== null && maximized !== id}
            onToggle={() => setMaximized((m) => (m === id ? null : id))}
          />
        ))}
        {!ids.length && <p className="col-span-full self-center text-center text-text-subtle">Nessun terminale ancora: compariranno qui man mano che partono.</p>}
      </div>
    </div>
  )
}

function StatusDot({ session }: { session?: SessionInfo }) {
  const exited = session?.status === 'exited'
  const failed = exited && (session?.exitCode ?? 0) !== 0
  return <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', !session ? 'bg-text-faint' : failed ? 'bg-danger' : exited ? 'bg-text-faint' : 'bg-ok')} />
}

/** Una cella dell'alveare: testata con nome, stato e comandi, e sotto il terminale. */
function HiveCell({
  sessionId,
  session,
  viewPrefix,
  maximized,
  hidden,
  onToggle
}: {
  sessionId: string
  session?: SessionInfo
  viewPrefix: string
  maximized: boolean
  hidden: boolean
  onToggle(): void
}) {
  const [missing, setMissing] = useState(false)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const exited = session?.status === 'exited' || exitCode !== null
  const code = session?.exitCode ?? exitCode
  return (
    <section
      aria-label={session?.title ?? 'Terminale'}
      className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background', hidden && 'hidden', maximized && 'border-brand/50')}
    >
      <header onDoubleClick={onToggle} className="flex h-7 shrink-0 select-none items-center gap-2 border-b border-border bg-surface px-2.5 text-[12px]">
        <StatusDot session={session} />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={session?.command}>
          {session?.title ?? 'Terminale'}
        </span>
        {exited && <span className={cn('shrink-0 text-[11px]', code ? 'text-danger' : 'text-text-faint')}>{code ? `uscito (${code})` : 'terminato'}</span>}
        {!exited && session && (
          <button type="button" title="Ferma" aria-label={`Ferma ${session.title}`} onClick={() => void api.sessions.kill(sessionId)} className="text-text-faint hover:text-danger">
            <Square size={12} />
          </button>
        )}
        <button
          type="button"
          title={maximized ? 'Torna al mosaico' : 'Ingrandisci'}
          aria-label={maximized ? 'Torna al mosaico' : `Ingrandisci ${session?.title ?? 'il terminale'}`}
          onClick={onToggle}
          className="text-text-faint hover:text-foreground"
        >
          {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </header>
      {/* Colonna flex: TerminalView riempie l'altezza con flex-1, come nel pannello terminale. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {missing ? (
          <p className="p-3 text-text-subtle">La sessione non è più attiva.</p>
        ) : (
          <TerminalView sessionId={sessionId} viewId={`${viewPrefix}:${sessionId}`} active={maximized} onMissing={() => setMissing(true)} onExit={(c) => setExitCode(c)} />
        )}
      </div>
    </section>
  )
}
