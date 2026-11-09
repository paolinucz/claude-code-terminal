import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FolderOpen, FolderPlus, History, Link2, Plus, SquareTerminal, X } from 'lucide-react'
import {
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  type ClaudeCliInfo,
  type ClaudeEffort,
  type ClaudeModel,
  type ProjectPrefs,
  type ResumableSession,
  type SessionInfo,
  type ShellId,
  type ShellInfo
} from '@shared/sessions'
import { joinNative } from '@shared/files'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { SessionHint } from '@/panels/kinds'
import { Segmented } from '@/components/ui-kit'
import { sessionList, STATUS_COLORS, STATUS_LABELS, useSessions } from '@/state/sessions'
import { useProject, workdirForSheet } from '@/state/project'
import { useWorkspace } from '@/state/workspace'
import { sessionLocations, type Placement } from '@/workspace/panels'

type Kind = 'claude' | 'shell'

/** Impostazione con l'ultima shell aperta, proposta la volta dopo. */
const LAST_SHELL_KEY = 'terminal.lastShell'
type ClaudeMode = 'new' | 'resume' | 'attach'

const MODES = [
  { id: 'new', label: 'Nuova' },
  { id: 'resume', label: 'Riprendi precedente' },
  { id: 'attach', label: 'Collega a sessione attiva' }
] as const satisfies readonly { id: ClaudeMode; label: string }[]

const PLACES = [
  { id: 'dock', label: 'Agganciato' },
  { id: 'float', label: 'Fluttuante' },
  { id: 'window', label: 'Finestra separata' }
] as const satisfies readonly { id: Placement; label: string }[]

interface Props {
  /** 'dialog' mostra anche la scelta della posizione (S9). */
  variant: 'dialog' | 'inline'
  hint?: SessionHint
  onDone(session: SessionInfo, placement: Placement): void
  onCancel?(): void
}

/** Apertura di un terminale (S1, S2, W1–W4): Claude Code nuova/ripresa/collegata, oppure shell semplice. */
export function NewSessionForm({ variant, hint, onDone, onCancel }: Props) {
  const [kind, setKind] = useState<Kind>(hint?.kind ?? 'claude')
  const [mode, setMode] = useState<ClaudeMode>(hint?.kind === 'claude' && hint.claudeSessionId ? 'resume' : 'new')
  const [cwd, setCwd] = useState(hint?.cwd ?? '')
  const [model, setModel] = useState<ClaudeModel>(hint?.model ?? 'default')
  const [effort, setEffort] = useState<ClaudeEffort>(hint?.effort ?? 'default')
  const [addDirs, setAddDirs] = useState<string[]>(hint?.addDirs ?? [])
  const [name, setName] = useState('')
  const [shell, setShell] = useState<ShellId | null>(hint?.shell ?? null)
  const [placement, setPlacement] = useState<Placement>('dock')
  const [resumeId, setResumeId] = useState<string | null>(hint?.claudeSessionId ?? null)
  const [attachId, setAttachId] = useState<string | null>(null)

  const [cli, setCli] = useState<ClaudeCliInfo | null>(null)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [recent, setRecent] = useState<ProjectPrefs[]>([])
  const [resumable, setResumable] = useState<ResumableSession[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const liveMap = useSessions((s) => s.sessions)
  const live = useMemo(() => sessionList(liveMap).filter((s) => s.status !== 'exited'), [liveMap])
  const locations = useMemo(() => sessionLocations(), [liveMap])

  // Dati iniziali: CLI, shell, progetti recenti; la cartella parte dall'ultimo progetto usato.
  useEffect(() => {
    void api.env.claudeCli().then(setCli)
    // Shell proposta: l'ultima usata, se c'è ancora; altrimenti la prima trovata (Git Bash, poi PowerShell…).
    void Promise.all([api.env.shells(), api.settings.get(LAST_SHELL_KEY)]).then(([list, last]) => {
      setShells(list)
      const remembered = list.find((x) => x.id === last)?.id
      setShell((s) => s ?? remembered ?? list[0]?.id ?? null)
    })
    void api.env.recentProjects().then(async (list) => {
      setRecent(list)
      // Con un progetto aperto la cartella parte da quella del contesto del foglio attivo (J7).
      const workdir = workdirForSheet(useWorkspace.getState().activeSheetId)
      if (!hint?.cwd) setCwd((c) => c || workdir || list[0]?.cwd || '')
      if (!hint?.cwd && !workdir && list.length === 0) {
        const home = await api.env.homeDir()
        setCwd((c) => c || home)
      }
    })
  }, [hint?.cwd])

  // W4: ogni progetto ricorda gli ultimi valori usati.
  useEffect(() => {
    if (!cwd || hint?.model) return
    let stale = false
    void api.env.projectPrefs(cwd).then((p) => {
      if (stale) return
      if (!p) {
        // Cartella mai usata: valgono le impostazioni predefinite del progetto, se ci sono (J2).
        const defaults = useProject.getState().active?.data.defaults
        if (defaults?.model) setModel(defaults.model)
        if (defaults?.effort) setEffort(defaults.effort)
        return
      }
      setModel(p.model)
      setEffort(p.effort)
      setAddDirs(p.addDirs)
    })
    return () => {
      stale = true
    }
  }, [cwd, hint?.model])

  // S8: sessioni di Claude Code salvate per questa cartella.
  useEffect(() => {
    if (kind !== 'claude' || mode !== 'resume' || !cwd) return
    let stale = false
    setResumable(null)
    void api.env.resumable(cwd).then((list) => {
      if (stale) return
      setResumable(list)
      setResumeId((id) => (id && list.some((s) => s.id === id) ? id : (list[0]?.id ?? null)))
    })
    return () => {
      stale = true
    }
  }, [kind, mode, cwd])

  useEffect(() => {
    if (mode === 'attach') setAttachId((id) => (id && live.some((s) => s.id === id) ? id : (live[0]?.id ?? null)))
  }, [mode, live])

  const browse = async (current: string, title?: string) => api.env.pickFolder(current || undefined, title)

  // Cosa c'è al percorso scritto: una cartella nuova si crea all'avvio.
  const [folder, setFolder] = useState<FolderStatus | null>(null)
  useEffect(() => {
    if (!cwd.trim()) return setFolder(null)
    let stale = false
    const t = setTimeout(() => void api.env.pathStatus(cwd.trim()).then((s) => !stale && setFolder(s)), 200)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [cwd])
  const needsFolder = kind === 'shell' || mode === 'new'
  const folderBlocked = needsFolder && (folder === 'invalid' || folder === 'file')
  const willCreate = needsFolder && folder === 'missing'

  // «Nuovo progetto…»: cartella madre + nome.
  const [newProject, setNewProject] = useState<{ parent: string; name: string } | null>(null)
  const startNewProject = async () => {
    const base = recent[0]?.cwd ?? cwd
    const parent = base ? base.replace(/[\\/][^\\/]+[\\/]?$/, '') || base : await api.env.homeDir()
    setNewProject({ parent, name: '' })
  }
  const newProjectPath = newProject && newProject.name.trim() ? joinNative(newProject.parent, newProject.name.trim()) : ''

  const cliMissing = kind === 'claude' && mode !== 'attach' && cli !== null && !cli.path
  const canSubmit =
    !busy &&
    !folderBlocked &&
    (kind === 'shell'
      ? Boolean(shell && cwd)
      : mode === 'new'
        ? Boolean(cwd) && !cliMissing
        : mode === 'resume'
          ? Boolean(resumeId) && !cliMissing
          : Boolean(attachId))

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      // Progetto nuovo: la cartella si crea prima di avviare il terminale.
      const dir = cwd.trim()
      if (needsFolder && (await api.env.pathStatus(dir)) === 'missing') {
        const res = await api.env.createFolder(dir)
        if (!res.ok) throw new Error(res.error ?? 'Impossibile creare la cartella.')
        setFolder('dir')
      }
      let session: SessionInfo
      if (kind === 'shell') {
        session = await api.sessions.create({ kind: 'shell', shell: shell!, cwd: dir })
        void api.settings.set(LAST_SHELL_KEY, shell)
      } else if (mode === 'attach') {
        const s = live.find((x) => x.id === attachId)
        if (!s) throw new Error('La sessione scelta non è più attiva.')
        session = s
      } else {
        const resumed = mode === 'resume' ? resumable?.find((r) => r.id === resumeId) : undefined
        session = await api.sessions.create({
          kind: 'claude',
          claude: {
            cwd: resumed?.cwd ?? dir,
            model,
            effort,
            addDirs,
            resumeId: resumed?.id,
            name: mode === 'new' ? name.trim() || undefined : undefined,
            title: resumed?.title
          }
        })
        void api.env.saveProjectPrefs({ cwd: resumed?.cwd ?? dir, model, effort, addDirs })
      }
      onDone(session, placement)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(false)
    }
  }

  const cta =
    (willCreate ? 'Crea cartella e ' : '') +
    (kind === 'shell' ? (willCreate ? 'apri shell' : 'Apri shell') : mode === 'new' ? (willCreate ? 'avvia Claude' : 'Avvia Claude') : mode === 'resume' ? 'Riprendi sessione' : 'Collega')

  return (
    <form
      className={cn('flex flex-col gap-4 text-[13px]', variant === 'inline' && 'mx-auto w-full max-w-xl')}
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) void submit()
      }}
    >
      {/* Tipo (S1) */}
      <div role="radiogroup" aria-label="Tipo di terminale" className="grid grid-cols-2 gap-2">
        <KindCard
          active={kind === 'claude'}
          onClick={() => setKind('claude')}
          title="Claude Code"
          text="Sessione con modello, effort e cartelle del workspace"
          icon={<span className="font-mono text-[12px] font-bold text-brand">&gt;_</span>}
        />
        <KindCard
          active={kind === 'shell'}
          onClick={() => setKind('shell')}
          title="Shell semplice"
          text={shells.length ? shells.map((s) => s.label).join(', ') : 'Git Bash, PowerShell o WSL'}
          icon={<SquareTerminal size={14} className="text-text-subtle" />}
        />
      </div>

      {kind === 'claude' && <Segmented label="Sessione" value={mode} onChange={setMode} options={MODES} />}

      {cliMissing && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-warn">
          Claude Code non è stato trovato. Installalo con l'installer ufficiale oppure aggiungi «claude» al PATH, poi riprova.
        </p>
      )}

      {/* Cartella di lavoro (W1) */}
      {!(kind === 'claude' && mode === 'attach') && (
        <Field label="Cartella del progetto" hint={kind === 'claude' ? 'Claude crea e modifica i file qui' : undefined}>
          <div className="flex gap-2">
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              spellCheck={false}
              placeholder="D:\PROGETTI\nome-progetto"
              aria-label="Cartella di lavoro"
              className={cn(
                'h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 font-mono text-[12px] text-foreground outline-none focus:border-brand placeholder:text-text-faint',
                folderBlocked ? 'border-danger' : 'border-input'
              )}
            />
            <SmallButton
              onClick={async () => {
                const dir = await browse(cwd)
                if (dir) setCwd(dir)
              }}
            >
              <FolderOpen size={14} /> Sfoglia…
            </SmallButton>
            {needsFolder && (
              <SmallButton onClick={() => (newProject ? setNewProject(null) : void startNewProject())} pressed={Boolean(newProject)}>
                <FolderPlus size={14} /> Nuovo progetto…
              </SmallButton>
            )}
          </div>

          {newProject && (
            <div className="mt-1 flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
                <span className="text-[12px] text-text-subtle">Dove</span>
                <div className="flex gap-2">
                  <input
                    value={newProject.parent}
                    onChange={(e) => setNewProject({ ...newProject, parent: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                    spellCheck={false}
                    aria-label="Cartella in cui creare il progetto"
                    className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[12px] text-foreground outline-none focus:border-brand"
                  />
                  <SmallButton
                    compact
                    onClick={async () => {
                      const dir = await browse(newProject.parent, 'Dove creare il nuovo progetto')
                      if (dir) setNewProject({ ...newProject, parent: dir })
                    }}
                  >
                    Sfoglia…
                  </SmallButton>
                </div>
                <span className="text-[12px] text-text-subtle">Nome</span>
                <input
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value.replace(/[\\/]/g, '') })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (newProjectPath) (setCwd(newProjectPath), setNewProject(null))
                    }
                  }}
                  autoFocus
                  spellCheck={false}
                  placeholder="nome-progetto"
                  aria-label="Nome del nuovo progetto"
                  className="h-8 rounded-md border border-input bg-background px-2 font-mono text-[12px] text-foreground outline-none placeholder:text-text-faint focus:border-brand"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-faint">{newProjectPath || 'Scegli dove e scrivi il nome della cartella'}</span>
                <SmallButton compact disabled={!newProjectPath} onClick={() => (setCwd(newProjectPath), setNewProject(null))}>
                  Usa questa cartella
                </SmallButton>
              </div>
            </div>
          )}

          {needsFolder && folder && <FolderNote status={folder} />}

          {recent.length > 0 && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-text-faint">Recenti:</span>
              {recent.slice(0, 6).map((r) => {
                const active = r.cwd.toLowerCase() === cwd.trim().toLowerCase()
                return (
                  <button
                    key={r.cwd}
                    type="button"
                    title={r.cwd}
                    aria-pressed={active}
                    onClick={() => setCwd(r.cwd)}
                    className={cn(
                      'rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors',
                      active ? 'border-brand bg-border text-foreground' : 'border-border text-text-muted hover:bg-surface-2 hover:text-foreground'
                    )}
                  >
                    {r.cwd.split(/[\\/]/).filter(Boolean).pop() ?? r.cwd}
                  </button>
                )
              })}
            </div>
          )}
        </Field>
      )}

      {kind === 'claude' && mode === 'new' && (
        <>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
            <span className="text-[12px] text-text-subtle">Modello</span>
            <Segmented label="Modello" size="sm" value={model} onChange={setModel} options={CLAUDE_MODELS} />
            <span className="text-[12px] text-text-subtle">Effort</span>
            <Segmented label="Effort" size="sm" value={effort} onChange={setEffort} options={CLAUDE_EFFORTS} />
          </div>

          {/* Cartelle di contesto (W2): passate con --add-dir */}
          <Field label="Cartelle aggiuntive" hint="passate a Claude Code con --add-dir">
            <div className="flex flex-wrap items-center gap-1.5">
              {addDirs.map((d) => (
                <span key={d} className="inline-flex items-center gap-1 rounded-md border border-border bg-background py-0.5 pr-1 pl-2 font-mono text-[12px] text-text-muted">
                  {d}
                  <button
                    type="button"
                    aria-label={`Rimuovi ${d}`}
                    onClick={() => setAddDirs(addDirs.filter((x) => x !== d))}
                    className="inline-flex size-5 items-center justify-center rounded text-text-faint hover:bg-border hover:text-foreground"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <SmallButton
                onClick={async () => {
                  const dir = await browse(cwd)
                  if (dir && !addDirs.includes(dir)) setAddDirs([...addDirs, dir])
                }}
              >
                <Plus size={13} /> Aggiungi cartella
              </SmallButton>
            </div>
          </Field>

          <Field label="Nome della sessione" hint="facoltativo">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="es. refactor-ordini"
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-foreground outline-none placeholder:text-text-faint focus:border-brand"
            />
          </Field>
        </>
      )}

      {kind === 'claude' && mode === 'resume' && (
        <List label="Sessioni di Claude Code in questa cartella" empty={resumable === null ? 'Caricamento…' : 'Nessuna sessione salvata per questa cartella.'}>
          {resumable?.map((r) => (
            <ListItem key={r.id} active={r.id === resumeId} onClick={() => setResumeId(r.id)} onDoubleClick={() => void submit()}>
              <History size={14} className="mt-0.5 shrink-0 text-text-faint" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">{r.title}</span>
                <span className="block text-[12px] text-text-faint">
                  {formatWhen(r.updatedAt)}
                  {r.gitBranch ? ` · ⎇ ${r.gitBranch}` : ''}
                  {r.id === hint?.claudeSessionId ? ' · ultima aperta in questo pannello' : ''}
                </span>
              </span>
            </ListItem>
          ))}
        </List>
      )}

      {kind === 'claude' && mode === 'attach' && (
        <>
          <List label="Sessioni attive" empty="Nessuna sessione attiva da collegare.">
            {live.map((s) => {
              const where = locations.get(s.id)
              return (
                <ListItem key={s.id} active={s.id === attachId} onClick={() => setAttachId(s.id)} onDoubleClick={() => void submit()}>
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: STATUS_COLORS[s.status] }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">
                      {s.kind === 'claude' ? 'Claude' : 'Shell'} · {s.title}
                    </span>
                    <span className="block text-[12px] text-text-faint">
                      {STATUS_LABELS[s.status]} · {where?.length ? `foglio ${where.join(', ')}` : 'nessuna vista aperta'}
                    </span>
                  </span>
                </ListItem>
              )
            })}
          </List>
          <p className="flex items-start gap-2 text-[12px] text-text-subtle">
            <Link2 size={14} className="mt-0.5 shrink-0" />
            Collegare apre una seconda vista sullo stesso processo: ciò che scrivi qui appare anche nell'altra vista.
          </p>
        </>
      )}

      {kind === 'shell' && (
        <Field label="Shell">
          <div className="flex flex-wrap gap-2">
            {shells.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={shell === s.id}
                onClick={() => setShell(s.id)}
                className={cn(
                  'h-9 rounded-lg border px-3 transition-colors',
                  shell === s.id ? 'border-brand bg-border text-foreground' : 'border-border text-text-muted hover:text-foreground'
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Field>
      )}

      {variant === 'dialog' && (
        <Field label="Dove aprirlo">
          <Segmented label="Posizione" value={placement} onChange={setPlacement} options={PLACES} />
        </Field>
      )}

      {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-lg border border-border px-4 text-text-muted transition-colors hover:bg-border hover:text-foreground"
          >
            Annulla
          </button>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className="h-9 rounded-lg bg-brand px-4 font-semibold text-on-brand transition-opacity disabled:opacity-40"
        >
          {busy ? 'Avvio…' : cta}
        </button>
      </div>
    </form>
  )
}

function KindCard(props: { active: boolean; onClick(): void; title: string; text: string; icon: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.active}
      onClick={props.onClick}
      className={cn(
        'flex min-h-[68px] flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
        props.active ? 'border-brand bg-border' : 'border-border hover:bg-surface-2'
      )}
    >
      <span className="flex items-center gap-2 font-semibold text-foreground">
        {props.icon}
        {props.title}
      </span>
      <span className="text-[12px] leading-snug text-text-subtle">{props.text}</span>
    </button>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] text-text-subtle">
        {label}
        {hint && <span className="text-text-faint"> · {hint}</span>}
      </span>
      {children}
    </div>
  )
}

function SmallButton(props: { onClick(): void; children: ReactNode; compact?: boolean; disabled?: boolean; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-pressed={props.pressed}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 border px-3 text-text-muted transition-colors hover:bg-border hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent',
        props.compact ? 'h-8 rounded-md text-[12px]' : 'h-9 rounded-lg',
        props.pressed ? 'border-brand bg-border text-foreground' : 'border-border'
      )}
    >
      {props.children}
    </button>
  )
}

type FolderStatus = 'dir' | 'file' | 'missing' | 'invalid'

/** Cosa succederà con la cartella scritta: chiaro prima di avviare. */
function FolderNote({ status }: { status: FolderStatus }) {
  const text: Record<FolderStatus, { cls: string; msg: string }> = {
    dir: { cls: 'text-text-faint', msg: 'Il terminale partirà in questa cartella: i file nuovi verranno creati qui.' },
    missing: { cls: 'text-warn', msg: 'La cartella non esiste ancora: verrà creata all\'avvio.' },
    invalid: { cls: 'text-danger', msg: 'Scrivi un percorso completo, per esempio D:\\PROGETTI\\nuovo-progetto oppure /home/utente/nuovo-progetto.' },
    file: { cls: 'text-danger', msg: 'Questo percorso è un file, non una cartella.' }
  }
  return <p className={cn('text-[11px]', text[status].cls)}>{text[status].msg}</p>
}

function List({ label, empty, children }: { label: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : []
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] text-text-subtle">{label}</span>
      <div role="listbox" aria-label={label} className="flex max-h-60 flex-col gap-1 overflow-auto rounded-lg border border-border bg-background p-1">
        {items.length ? children : <span className="px-2 py-3 text-text-faint">{empty}</span>}
      </div>
    </div>
  )
}

function ListItem(props: { active: boolean; onClick(): void; onDoubleClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.active}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      className={cn(
        'flex items-start gap-2 rounded-md px-2 py-2 text-left transition-colors',
        props.active ? 'bg-border' : 'hover:bg-surface-2'
      )}
    >
      {props.children}
    </button>
  )
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000)
  if (days === 0) return `oggi ${time}`
  if (days === 1) return `ieri ${time}`
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) + ` ${time}`
}
