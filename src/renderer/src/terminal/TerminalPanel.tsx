import { useEffect, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { AArrowDown, AArrowUp, ChevronDown, GitBranch, Layers, MoreHorizontal, Power, RotateCcw } from 'lucide-react'
import { MAX_FONT_SIZE, MIN_FONT_SIZE, useTerminalSettings } from '@/state/terminalSettings'
import { CLAUDE_EFFORTS, CLAUDE_MODELS, type SessionInfo } from '@shared/sessions'
import { api } from '@/lib/api'
import type { PanelParams } from '@/panels/kinds'
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
import { bindPanelToSession, hintOf } from '@/workspace/panels'
import { NewSessionForm } from './NewSessionForm'
import { TerminalView } from './TerminalView'

/** Pannello terminale: una vista su una sessione, oppure la scelta della sessione da aprire. */
export function TerminalPanel(props: IDockviewPanelProps<PanelParams>) {
  const { sessionId, hint } = props.params
  const session = useSessions((s) => (sessionId ? s.sessions[sessionId] : undefined))
  const [missing, setMissing] = useState(false)
  const [exitCode, setExitCode] = useState<number | null>(null)
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
    setExitCode(null)
  }, [sessionId])

  // Il titolo della scheda segue quello della sessione.
  useEffect(() => {
    if (session && props.api.title !== session.title) props.api.setTitle(session.title)
  }, [session?.title, props.api, session])

  if (!sessionId || missing) {
    return (
      <div className="h-full overflow-auto bg-surface p-5">
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
              setMissing(false)
              bindPanelToSession(props.api, s)
            }}
          />
        </div>
      </div>
    )
  }

  const viewId = `${props.api.id}#${generation}`
  const exited = session?.status === 'exited' || exitCode !== null

  return (
    <div className="flex h-full flex-col bg-background">
      <TerminalView
        key={viewId}
        sessionId={sessionId}
        viewId={viewId}
        active={active}
        onMissing={() => setMissing(true)}
        onExit={(code) => setExitCode(code)}
      />
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
            bindPanelToSession(props.api, s)
          }}
          onClose={() => props.api.close()}
        />
      )}
      {session && <StatusBar session={session} />}
    </div>
  )
}

/** Dimensione del carattere dei terminali (vale per tutti). Anche con Ctrl +, Ctrl −, Ctrl 0 e Ctrl + rotellina. */
function FontSizeControl() {
  const { fontSize, bigger, smaller, reset } = useTerminalSettings()
  const btn =
    'inline-flex h-5 min-w-5 items-center justify-center rounded px-1 hover:bg-border hover:text-foreground disabled:opacity-40'
  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5" role="group" aria-label="Dimensione del carattere">
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
    <div className="flex items-center gap-3 border-t border-border bg-surface-2 px-3 py-2 text-[12px]">
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
function StatusBar({ session }: { session: SessionInfo }) {
  const setStatus = useWorkspace((s) => s.setStatus)
  const [confirmKill, setConfirmKill] = useState(false)
  const isClaude = session.kind === 'claude'
  const modelLabel = CLAUDE_MODELS.find((m) => m.id === session.model)?.label ?? 'Predefinito'
  const effortLabel = CLAUDE_EFFORTS.find((m) => m.id === session.effort)?.label ?? 'Predefinito'
  const live = session.status !== 'exited'

  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-surface px-2 font-mono text-[11px] text-text-subtle">
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

      {isClaude && (
        <span title="La percentuale di contesto arriva nella fase 3 (status line di Claude Code)">Contesto —</span>
      )}

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
