import { useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { AArrowDown, AArrowUp, ChevronDown, GitBranch, Layers, MessagesSquare, MoreHorizontal, Power, RotateCcw, Square, SquareTerminal } from 'lucide-react'
import { MAX_FONT_SIZE, MIN_FONT_SIZE, useTerminalSettings } from '@/state/terminalSettings'
import { CLAUDE_EFFORTS, CLAUDE_MODELS, type SessionInfo } from '@shared/sessions'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { PanelParams } from '@/panels/kinds'
import { menuItems, runMenuItem } from '@/plugins/extensions'
import { useEditor } from '@/state/editor'
import { useSessions } from '@/state/sessions'
import { useWorkspace } from '@/state/workspace'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui-kit'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { bindPanelToSession, hintOf, spaceOfPanel } from '@/workspace/panels'
import { NewSessionForm } from './NewSessionForm'
import { ConversationView } from './ConversationView'
import { PromptBox } from './PromptBox'
import { useBot, useBots } from '@/state/bots'
import { isBubbleMode } from '@/state/appearance'
import { ReviewDock } from '@/changes/ReviewDrawer'
import { useChanges } from '@/state/changes'
import { useReviewUi } from '@/state/review'
import { TerminalView } from './TerminalView'

/** Pannello terminale: una vista su una sessione, oppure la scelta della sessione da aprire. */
export function TerminalPanel(props: IDockviewPanelProps<PanelParams>) {
  const { sessionId, hint } = props.params
  const session = useSessions((s) => (sessionId ? s.sessions[sessionId] : undefined))
  const bot = useBot(sessionId)
  const [missing, setMissing] = useState(false)
  const [active, setActive] = useState(props.api.isActive)
  // Spostato in una finestra staccata o fluttuante: si ricrea la vista nel nuovo documento.
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    const a = props.api.onDidActiveChange((e) => setActive(e.isActive))
    const l = props.api.onDidLocationChange(() => setGeneration((g) => g + 1))
    return () => {
      a.dispose()
      l.dispose()
    }
  }, [props.api])

  useEffect(() => {
    setMissing(false)
  }, [sessionId])

  // Il titolo della scheda segue quello della sessione.
  useEffect(() => {
    const title = session?.kind === 'claude' && bot ? bot.name : session?.title
    if (session && title && props.api.title !== title) props.api.setTitle(title)
  }, [session?.title, props.api, session, bot?.name])

  // S7: guardare la sessione (scheda attiva nello spazio aperto, finestra in primo piano) toglie il segnale di attenzione.
  const spaceActive = useWorkspace((s) => s.activeSpaceId === spaceOfPanel(props.containerApi))
  const hasAttention = useSessions((s) => (sessionId ? Boolean(s.attention[sessionId]) : false))
  useEffect(() => {
    if (!sessionId || !hasAttention) return
    const check = () => {
      if (active && spaceActive && props.api.isVisible && document.hasFocus()) useSessions.getState().seen(sessionId)
    }
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [sessionId, hasAttention, active, spaceActive, props.api])

  if (!sessionId || missing) {
    return (
      <div className="h-full overflow-auto p-5">
        <div className="mx-auto max-w-xl">
          <p className="text-[14px] font-semibold text-foreground">{hint ? 'Sessione non più attiva' : 'Nuovo terminale'}</p>
          <p className="mt-1 mb-4 text-text-subtle">
            {hint
              ? `«${hint.title}» non è più in esecuzione (per esempio dopo un riavvio dell'app). Riprendila o aprine un'altra.`
              : 'Scegli cosa aprire in questo pannello.'}
          </p>
          <NewSessionForm
            variant="inline"
            hint={hint}
            onDone={(s) => {
              // In modalità Bolle le sessioni di Claude non stanno nelle schede: il pannello si chiude e si apre la bolla.
              if (isBubbleMode() && s.kind === 'claude') {
                props.api.close()
                useBots.getState().open(s.id)
                return
              }
              setMissing(false)
              bindPanelToSession(props.api, s)
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <SessionView
      sessionId={sessionId}
      viewKey={props.api.id}
      viewId={`${props.api.id}#${generation}`}
      active={active}
      hint={hint}
      onMissing={() => setMissing(true)}
      onClose={() => props.api.close()}
      onRestarted={(s) => bindPanelToSession(props.api, s)}
    />
  )
}

/**
 * La vista di una sessione: terminale, vista grafica, casella di input, barra di stato e cassetto di revisione. La usano il
 * pannello Dockview (`TerminalPanel`) e la bolla ampliata (`BotExpanded`): chi la ospita decide cosa fare se la sessione
 * manca, si chiude o viene ripresa.
 */
export function SessionView({
  sessionId,
  viewKey,
  viewId,
  active,
  hint,
  onMissing,
  onClose,
  onRestarted
}: {
  sessionId: string
  /** Chiave della vista per la casella di input (la sua bozza). */
  viewKey: string
  /** Id della vista del terminale (cambia quando il pannello cambia documento). */
  viewId: string
  active: boolean
  hint?: PanelParams['hint']
  onMissing(): void
  onClose(): void
  onRestarted(session: SessionInfo): void
}) {
  const session = useSessions((s) => s.sessions[sessionId])
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)
  // Vista grafica della conversazione: sovrapposta al terminale, che resta in esecuzione (e delle sue dimensioni) sotto.
  const [graphic, setGraphicState] = useState(false)
  // La scelta si ricorda: chi preferisce la vista grafica la ritrova nei terminali nuovi.
  useEffect(() => {
    void api.settings.get('ui.graphicView').then((v) => v === true && setGraphicState(true))
  }, [])
  const setGraphic = (value: boolean | ((g: boolean) => boolean)) =>
    setGraphicState((g) => {
      const next = typeof value === 'function' ? value(g) : value
      void api.settings.set('ui.graphicView', next)
      return next
    })

  useEffect(() => {
    setExitCode(null)
  }, [sessionId])
  const exited = session?.status === 'exited' || exitCode !== null

  return (
    // Riga: a sinistra terminale, casella di input e barra di stato; a destra il cassetto di revisione della sessione.
    <div ref={wrapperRef} className="relative flex h-full">
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Con la vista grafica attiva il terminale resta in esecuzione (e delle sue dimensioni) ma non si vede: sotto il vetro il suo testo traspariva. */}
      <div className="relative flex min-h-0 flex-1 flex-col" data-graphic={graphic && session?.kind === 'claude' ? 'on' : 'off'}>
        <TerminalView
          key={viewId}
          sessionId={sessionId}
          viewId={viewId}
          active={active}
          onMissing={onMissing}
          onExit={(code) => setExitCode(code)}
        />
        {graphic && session?.kind === 'claude' && <ConversationView session={session} onShowTerminal={() => setGraphic(false)} />}
      </div>
      {session?.kind === 'claude' && !exited && (
        <PromptBox
          session={session}
          viewKey={viewKey}
          graphic={graphic}
          focusTerminal={() => wrapperRef.current?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus()}
        />
      )}
      {exited && (
        <ExitedBar
          code={session?.exitCode ?? exitCode}
          onRestart={async () => {
            const h = session ? hintOf(session) : hint
            if (!h) return
            const s =
              h.kind === 'claude'
                ? await api.sessions.create({
                    kind: 'claude',
                    claude: {
                      cwd: h.cwd,
                      model: h.model ?? 'default',
                      effort: h.effort ?? 'default',
                      addDirs: h.addDirs ?? [],
                      resumeId: h.claudeSessionId,
                      title: h.title
                    }
                  })
                : await api.sessions.create({ kind: 'shell', shell: h.shell ?? 'powershell', cwd: h.cwd })
            onRestarted(s)
          }}
          onClose={onClose}
        />
      )}
      {session && <StatusBar session={session} graphic={graphic} onToggleGraphic={() => setGraphic((g) => !g)} />}
    </div>
    {session?.kind === 'claude' && <ReviewDock sessionId={session.id} />}
    </div>
  )
}

/** Contesto usato (W5), dalla status line di Claude Code. Giallo oltre il 70%, rosso oltre l'85%. */
function ContextMeter({ session }: { session: SessionInfo }) {
  const p = session.contextPercent
  if (p === undefined) {
    return (
      <span title={session.hooks ? 'In attesa del primo aggiornamento di Claude Code' : 'Disponibile dopo il primo messaggio'}>
        Contesto —
      </span>
    )
  }
  const color = p >= 85 ? 'var(--cct-danger)' : p >= 70 ? 'var(--cct-warn)' : 'var(--cct-ok)'
  const cost = session.costUsd !== undefined ? ` · costo stimato $${session.costUsd.toFixed(2)}` : ''
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5" title={`Contesto usato: ${p}%${cost}`}>
      Contesto
      <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label="Contesto usato">
        <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, p)}%`, background: color }} />
      </span>
      <span style={{ color: p >= 70 ? color : undefined }}>{p}%</span>
    </span>
  )
}

/** Colore della barra secondo quanto è piena: giallo oltre il 70%, rosso oltre l'85%. */
const meterColor = (p: number) => (p >= 85 ? 'var(--cct-danger)' : p >= 70 ? 'var(--cct-warn)' : 'var(--cct-ok)')

/** «tra 2 h 10 min» / «tra 3 g 4 h» dal momento in cui si azzera la finestra. */
function resetIn(resetsAt?: number): string {
  if (!resetsAt) return ''
  const min = Math.round((resetsAt * 1000 - Date.now()) / 60000)
  if (min <= 0) return 'si azzera a breve'
  if (min < 60) return `si azzera tra ${min} min`
  if (min < 48 * 60) return `si azzera tra ${Math.floor(min / 60)} h ${min % 60} min`
  return `si azzera tra ${Math.floor(min / 1440)} g ${Math.floor((min % 1440) / 60)} h`
}

/**
 * Utilizzo dell'abbonamento: finestra di 5 ore («sessione») e settimana. I limiti sono dell'account, non della singola
 * sessione: si mostrano gli ultimi dati arrivati da qualsiasi sessione. Compaiono solo per Pro, Max e Ultra, dopo la
 * prima risposta di Claude.
 */
function UsageMeters({ session }: { session: SessionInfo }) {
  const all = useSessions((s) => s.sessions)
  const usage = useMemo(() => {
    let best = session.usage
    for (const s of Object.values(all)) if (s.usage && (!best || s.usage.at > best.at)) best = s.usage
    return best
  }, [all, session.usage])
  const now = Date.now() / 1000
  // Una finestra già scaduta non vale più: Claude Code la toglie al prossimo aggiornamento.
  const items = [
    { label: 'Sessione', title: 'Limite di 5 ore', w: usage?.fiveHour },
    { label: 'Settimana', title: 'Limite settimanale', w: usage?.sevenDay }
  ].filter((x): x is { label: string; title: string; w: NonNullable<typeof x.w> } => Boolean(x.w) && !(x.w!.resetsAt && x.w!.resetsAt < now))
  if (!items.length) return null
  return (
    <>
      {items.map(({ label, title, w }) => (
        <span key={label} className="inline-flex shrink-0 items-center gap-1.5" title={`${title}: ${w.percent}% usato${w.resetsAt ? ` · ${resetIn(w.resetsAt)}` : ''}`}>
          {label}
          <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={w.percent} aria-valuemin={0} aria-valuemax={100} aria-label={title}>
            <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, w.percent)}%`, background: meterColor(w.percent) }} />
          </span>
          <span style={{ color: w.percent >= 70 ? meterColor(w.percent) : undefined }}>{w.percent}%</span>
        </span>
      ))}
    </>
  )
}

/** Dimensione del carattere dei terminali (vale per tutti). Anche con Ctrl +, Ctrl −, Ctrl 0 e Ctrl + rotellina. */
function FontSizeControl() {
  const { fontSize, bigger, smaller, reset } = useTerminalSettings()
  const btn =
    'inline-flex h-5 min-w-5 items-center justify-center rounded px-1 hover:bg-border hover:text-foreground disabled:opacity-40'
  return (
    <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Dimensione del carattere">
      <button type="button" className={btn} onClick={smaller} disabled={fontSize <= MIN_FONT_SIZE} title="Riduci il carattere (Ctrl −)" aria-label="Riduci il carattere">
        <AArrowDown size={13} />
      </button>
      <button type="button" className={`${btn} tabular-nums`} onClick={reset} title="Dimensione predefinita (Ctrl 0)">
        {fontSize}px
      </button>
      <button type="button" className={btn} onClick={bigger} disabled={fontSize >= MAX_FONT_SIZE} title="Ingrandisci il carattere (Ctrl +)" aria-label="Ingrandisci il carattere">
        <AArrowUp size={13} />
      </button>
    </div>
  )
}

function ExitedBar({ code, onRestart, onClose }: { code: number | null | undefined; onRestart(): void; onClose(): void }) {
  return (
    <div className="mg-bar flex items-center gap-3 border-t border-border px-3 py-2 text-[12px]">
      <span className="text-text-subtle">Sessione terminata{code !== null && code !== undefined ? ` · codice ${code}` : ''}</span>
      <button
        type="button"
        onClick={onRestart}
        className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-text-muted hover:bg-border hover:text-foreground"
      >
        <RotateCcw size={13} /> Riprendi
      </button>
      <button type="button" onClick={onClose} className="h-7 rounded-md px-2.5 text-text-subtle hover:bg-border hover:text-foreground">
        Chiudi pannello
      </button>
    </div>
  )
}

/** Barra di stato del terminale (W5): modello, effort, contesto, branch git. */
function StatusBar({ session, graphic, onToggleGraphic }: { session: SessionInfo; graphic: boolean; onToggleGraphic(): void }) {
  const setStatus = useWorkspace((s) => s.setStatus)
  const [confirmKill, setConfirmKill] = useState(false)
  const isClaude = session.kind === 'claude'
  // Con la status line (fase 3) modello ed effort sono quelli veri, anche dopo un /model scritto a mano.
  const modelLabel = session.modelLabel ?? CLAUDE_MODELS.find((m) => m.id === session.model)?.label ?? 'Predefinito'
  const effortLabel = session.effortLevel ?? CLAUDE_EFFORTS.find((m) => m.id === session.effort)?.label ?? 'Predefinito'
  const live = session.status !== 'exited'
  const reviewPending = useChanges((s) => s.changes.filter((c) => c.sessionId === session.id && c.status === 'pending').length)
  const reviewOpen = useReviewUi((s) => Boolean(s.sessions[session.id]?.open))
  const plugins = useEditor((s) => s.plugins)
  const pluginCtx = { sessionId: session.id, sessionKind: session.kind, sessionStatus: session.status, cwd: session.cwd }
  const pluginItems = useMemo(() => menuItems(plugins, 'terminal/toolbar', pluginCtx), [plugins, session.id, session.kind, session.status, session.cwd]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mg-bar flex h-7 shrink-0 items-center gap-3 border-t border-border px-2 font-mono text-[11px] text-text-subtle">
      {isClaude ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!live}>
            <button
              type="button"
              title="Cambia modello ed effort (W3)"
              className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-text-muted hover:bg-border hover:text-foreground disabled:opacity-60"
            >
              {modelLabel} · effort {effortLabel.toLowerCase()} <ChevronDown size={11} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56 font-sans">
            <DropdownMenuLabel>Modello</DropdownMenuLabel>
            {CLAUDE_MODELS.filter((m) => m.id !== 'default').map((m) => (
              <DropdownMenuItem
                key={m.id}
                onSelect={() => {
                  void api.sessions.setModel(session.id, m.id, session.effort ?? 'default')
                  setStatus(`«${session.title}»: modello ${m.label}`)
                }}
              >
                <span className="flex-1">{m.label}</span>
                {session.model === m.id && <span className="text-brand">●</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Effort</DropdownMenuLabel>
            {CLAUDE_EFFORTS.filter((m) => m.id !== 'default').map((m) => (
              <DropdownMenuItem
                key={m.id}
                onSelect={() => {
                  void api.sessions.setModel(session.id, session.model ?? 'default', m.id)
                  setStatus(`«${session.title}»: effort ${m.label}`)
                }}
              >
                <span className="flex-1">{m.label}</span>
                {session.effort === m.id && <span className="text-brand">●</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="px-1.5 text-text-muted">{session.title}</span>
      )}

      {isClaude && <ContextMeter session={session} />}
      {isClaude && <UsageMeters session={session} />}

      {session.gitBranch && (
        <span className="inline-flex items-center gap-1" title="Branch git">
          <GitBranch size={11} /> {session.gitBranch}
        </span>
      )}

      <span className="min-w-0 truncate" title={[session.cwd, ...(session.addDirs ?? [])].join('\n')}>
        {session.cwd}
        {session.addDirs?.length ? ` +${session.addDirs.length}` : ''}
      </span>

      {session.views > 1 && (
        <span className="inline-flex shrink-0 items-center gap-1 text-info" title="Viste collegate alla stessa sessione (S3)">
          <Layers size={11} /> {session.views} viste
        </span>
      )}

      {!isClaude && <span className="ml-auto" />}
      {isClaude && (
        <button
          type="button"
          onClick={onToggleGraphic}
          aria-pressed={graphic}
          title={graphic ? 'Torna al terminale' : 'Mostra la conversazione impaginata (il terminale resta attivo sotto)'}
          className={cn('ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 hover:bg-border hover:text-foreground', graphic ? 'bg-border text-foreground' : 'text-text-muted')}
        >
          {graphic ? <SquareTerminal size={12} /> : <MessagesSquare size={12} />} {graphic ? 'Terminale' : 'Vista grafica'}
        </button>
      )}
      {/* Programma lanciato da una run configuration (anche in debug): si interrompe con un clic, senza passare dal menu. */}
      {session.kind === 'task' && live && (
        <button
          type="button"
          onClick={() => void api.sessions.kill(session.id)}
          title="Interrompe l'esecuzione (e il debug, se è in debug)"
          className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-danger/15 px-2 font-sans text-[11px] font-semibold text-danger transition-colors hover:bg-danger/25"
        >
          <Square size={10} fill="currentColor" /> Ferma
        </button>
      )}
      {/* Revisione delle modifiche di Claude: il cassetto accanto al terminale (si apre da solo alla prima modifica). */}
      {isClaude && (
        <button
          type="button"
          onClick={() => useReviewUi.getState().toggleReview(session.id)}
          aria-pressed={reviewOpen}
          title={reviewOpen ? 'Chiudi la revisione delle modifiche' : 'Apri la revisione delle modifiche di questa sessione'}
          className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 font-sans text-[11px] transition-colors hover:bg-border hover:text-foreground', reviewOpen ? 'bg-border text-foreground' : 'text-text-muted')}
        >
          Revisione
          {reviewPending > 0 && <span className="rounded-full px-1.5 font-mono font-semibold text-on-brand" style={{ background: 'var(--cct-warn)' }}>{reviewPending}</span>}
        </button>
      )}
      {/* Pulsanti dei plugin (`contributes.menus['terminal/toolbar']`): l'app li disegna, il plugin decide solo se e cosa fanno. */}
      {pluginItems.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => runMenuItem(it, pluginCtx)}
          title={`${it.pluginName}: ${it.command.title}`}
          className="inline-flex h-5 shrink-0 items-center rounded px-1.5 font-sans text-[11px] text-text-muted transition-colors hover:bg-border hover:text-foreground"
        >
          {it.command.title}
        </button>
      ))}
      <FontSizeControl />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Altre azioni sulla sessione"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-border hover:text-foreground"
          >
            <MoreHorizontal size={13} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-64 font-sans">
          <DropdownMenuLabel className="font-mono">{session.command}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!live} onSelect={() => setConfirmKill(true)} className="text-danger">
            <Power size={13} /> Termina sessione
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmKill}
        title={`Terminare «${session.title}»?`}
        description={
          session.kind === 'claude'
            ? 'Il processo di Claude Code viene chiuso in tutte le viste. La conversazione resta salvata: potrai riprenderla da «Riprendi precedente».'
            : 'La shell viene chiusa in tutte le viste.'
        }
        confirmLabel="Termina"
        destructive
        onCancel={() => setConfirmKill(false)}
        onConfirm={() => {
          void api.sessions.kill(session.id)
          setConfirmKill(false)
        }}
      />
    </div>
  )
}
