import { Fragment, useState } from 'react'
import { AlertTriangle, Check, Copy, Hand, ListTree, Search, Square, TerminalSquare } from 'lucide-react'
import type { ChatItem, TodoEntry } from '@shared/transcript'
import type { SessionInfo } from '@shared/sessions'
import { api } from '@/lib/api'
import { useBot } from '@/state/bots'
import { cn } from '@/lib/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui-kit'
import { Dot, fmtDuration, fmtTokens, timeOf, type ToolItem } from './common'
import { FileLink } from './ToolViews'

type UserItem = ChatItem & { kind: 'user' }

/** Testo di un messaggio dell'utente con i file citati con «@percorso» resi come bottoni che li aprono. */
function WithMentions({ text, cwd }: { text: string; cwd: string }) {
  const parts = text.split(/(^|\s)(@[\w.\\/:~-]*[\w])/g)
  return (
    <>
      {parts.map((p, i) => {
        // split con due gruppi: [testo, spazio, @token, testo, spazio, @token…]
        if (i % 3 === 2 && /[./\\]/.test(p)) {
          return <FileLink key={i} path={p.slice(1)} cwd={cwd} label={p} />
        }
        return <Fragment key={i}>{p}</Fragment>
      })}
    </>
  )
}

function Thumb({ mediaType, data }: { mediaType: string; data?: string }) {
  const [big, setBig] = useState(false)
  if (!data) return <span className="rounded border border-dashed border-border px-2 py-1 text-[11px] text-text-faint">[immagine troppo grande per l'anteprima]</span>
  return (
    <button type="button" onClick={() => setBig((v) => !v)} title={big ? 'Riduci' : 'Ingrandisci'} className="block overflow-hidden rounded-lg border border-border">
      <img src={`data:${mediaType};base64,${data}`} alt="Immagine allegata al messaggio" className={cn('block object-contain', big ? 'max-h-[70vh] max-w-full cursor-zoom-out' : 'max-h-40 max-w-xs cursor-zoom-in')} />
    </button>
  )
}

export function UserBubble({ item, cwd }: { item: UserItem; cwd: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div data-item={item.id} className="group relative flex gap-2 rounded-md bg-surface-2 px-3 py-2 text-foreground">
      <span aria-hidden className="w-4 shrink-0 text-center text-text-faint select-none">
        ›
      </span>
      <div className="min-w-0 flex-1">
        {item.text && (
          <div className="whitespace-pre-wrap">
            <WithMentions text={item.text} cwd={cwd} />
          </div>
        )}
        {item.images && item.images.length > 0 && (
          <div className={cn('flex flex-wrap gap-2', item.text && 'mt-2')}>
            {item.images.map((img, i) => (
              <Thumb key={i} mediaType={img.mediaType} data={img.data} />
            ))}
          </div>
        )}
      </div>
      <span className="shrink-0 self-start text-[10px] text-text-faint">{timeOf(item.ts)}</span>
      {item.text && (
        <button
          type="button"
          aria-label="Copia il messaggio"
          onClick={() => void navigator.clipboard.writeText(item.text).then(() => (setCopied(true), window.setTimeout(() => setCopied(false), 1500)))}
          className="absolute -top-2 right-2 inline-flex size-6 items-center justify-center rounded-md border border-border bg-surface text-text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
        >
          {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
        </button>
      )}
    </div>
  )
}

/** Ragionamento di Claude: una riga che si apre. */
export function ThinkingRow({ item }: { item: ChatItem & { kind: 'thinking' } }) {
  const [open, setOpen] = useState(false)
  const lines = item.text.split('\n').filter((l) => l.trim()).length
  return (
    <div data-item={item.id} className="flex gap-2">
      <Dot state="quiet" />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="block w-full text-left text-text-faint hover:text-text-subtle">
          <span className="italic">Ragionamento</span>
          <span className="text-[11px]"> · {lines} {lines === 1 ? 'riga' : 'righe'} {open ? '▾' : '▸'}</span>
          {!open && <span className="block truncate text-[12px] italic opacity-70">{item.text.replace(/\s+/g, ' ').slice(0, 140)}</span>}
        </button>
        {open && <p className="cct-selectable mt-1 border-l border-border pl-3 text-[12.5px] whitespace-pre-wrap text-text-faint italic">{item.text}</p>}
      </div>
    </div>
  )
}

/** Interruzioni, compattazione del contesto, errori dell'API e comandi con la barra. */
export function SystemRow({ item }: { item: ChatItem & { kind: 'system' } }) {
  const [open, setOpen] = useState(false)
  if (item.sub === 'interrupted') {
    return (
      <div data-item={item.id} className="flex items-center gap-2 border-y border-dashed border-border py-1 text-[12px] text-text-faint">
        <Square size={10} aria-hidden /> {item.text}
      </div>
    )
  }
  if (item.sub === 'command') {
    return (
      <div data-item={item.id} className="flex items-center gap-2 text-[12px] text-text-subtle">
        <TerminalSquare size={13} aria-hidden className="text-text-faint" />
        <code className="rounded bg-border px-1.5 py-0.5">{item.text}</code>
      </div>
    )
  }
  if (item.sub === 'error') {
    return (
      <div data-item={item.id} className="flex gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger" role="alert">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
        <span className="cct-selectable min-w-0 flex-1 whitespace-pre-wrap">{item.text}</span>
      </div>
    )
  }
  return (
    <div data-item={item.id} className="rounded-lg border border-dashed border-border px-3 py-2 text-[12.5px] text-text-subtle">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="block w-full text-left">
        <span className="font-semibold text-text-muted">Contesto compattato</span> · la conversazione precedente è stata riassunta {open ? '▾' : '▸'}
      </button>
      {open && <p className="cct-selectable mt-2 whitespace-pre-wrap text-text-faint">{item.text}</p>}
    </div>
  )
}

export interface TurnStats {
  ms: number
  tokens: number
  tools: number
}

/** Riga a fine turno: quanto è durato, quanti token ha scritto Claude, quanti strumenti ha usato. */
export function TurnFooter({ stats }: { stats: TurnStats }) {
  const parts = [stats.ms >= 1500 ? fmtDuration(stats.ms) : '', stats.tokens > 0 ? `${fmtTokens(stats.tokens)} token` : '', stats.tools > 0 ? `${stats.tools} ${stats.tools === 1 ? 'strumento' : 'strumenti'}` : ''].filter(Boolean)
  if (parts.length === 0) return null
  return <div className="-mt-1 pl-6 text-[11px] text-text-faint">{parts.join(' · ')}</div>
}

/** Riepilogo di un permesso che Claude sta chiedendo: cosa vuole fare davvero, non solo «Sì / No». */
function PendingDetail({ tool }: { tool: ToolItem }) {
  const a = tool.args ?? {}
  if (tool.name === 'Bash') {
    return (
      <pre className="cct-selectable max-h-28 overflow-auto rounded-md bg-background/60 px-2 py-1 text-[11.5px] leading-snug whitespace-pre-wrap text-foreground">
        <span className="text-ok select-none">$ </span>
        {a.command ?? tool.summary}
      </pre>
    )
  }
  if (tool.edits?.length) {
    const added = tool.edits.reduce((n, e) => n + e.new.split('\n').length, 0)
    const removed = tool.edits.reduce((n, e) => n + (e.old ? e.old.split('\n').length : 0), 0)
    return (
      <div className="font-mono text-[11.5px] text-text-muted">
        <FileLink path={tool.edits[0].file} cwd="" label={tool.edits[0].file} />
        <span className="text-text-faint"> · </span>
        <span className="text-ok">+{added}</span> <span className="text-danger">−{removed}</span>
      </div>
    )
  }
  const entries = Object.entries(a).slice(0, 3)
  return (
    <div className="font-mono text-[11.5px] text-text-muted">
      {entries.map(([k, v]) => (
        <div key={k} className="truncate">
          <span className="text-text-faint">{k}: </span>
          {v}
        </div>
      ))}
    </div>
  )
}

/** Barra che compare quando Claude aspetta un permesso: cosa chiede e le scelte (come i tasti del terminale). */
export function PermissionBar({ session, pending, message, onShowTerminal }: { session: SessionInfo; pending?: ToolItem; message?: string; onShowTerminal(): void }) {
  const live = session.status !== 'exited'
  return (
    <div className="shrink-0 border-t border-warn/40 bg-warn/10 px-4 py-2 text-[12px]" role="alert">
      <div className="flex items-start gap-2">
        <Hand size={14} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-foreground">
            {pending ? (
              <>
                Claude vuole usare <span className="font-semibold">{pending.name}</span>
                {pending.summary && pending.name !== 'Bash' && !pending.edits?.length ? <span className="text-text-muted"> · {pending.summary}</span> : null}
              </>
            ) : (
              message || 'Claude aspetta una tua risposta (permesso o domanda).'
            )}
          </p>
          {pending && <PendingDetail tool={pending} />}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
        <button type="button" disabled={!live} onClick={() => api.sessions.key(session.id, '1')} title="Invia «1» al terminale: la prima scelta, di solito «Sì»" className="h-7 rounded-md bg-ok px-3 font-semibold text-on-brand hover:opacity-90 disabled:opacity-40">
          Sì (1)
        </button>
        <button type="button" disabled={!live} onClick={() => api.sessions.key(session.id, '2')} title="Invia «2» al terminale: la seconda scelta, di solito «sì, e non chiedere più» per questo tipo di azione" className="h-7 rounded-md border border-ok/50 px-3 text-ok hover:bg-ok/10 disabled:opacity-40">
          Sì, e non chiedere più (2)
        </button>
        <button type="button" disabled={!live} onClick={() => api.sessions.key(session.id, 'esc')} title="Invia Esc al terminale: rifiuta o annulla" className="h-7 rounded-md border border-danger/50 px-3 text-danger hover:bg-danger/10 disabled:opacity-40">
          No (Esc)
        </button>
        <button type="button" onClick={onShowTerminal} className="h-7 rounded-md px-3 text-text-subtle hover:bg-border hover:text-foreground">
          Rispondi nel terminale
        </button>
      </div>
    </div>
  )
}

/** Intestazione della vista grafica: modello, contesto, costo, avanzamento delle cose da fare, indice dei messaggi e ricerca. */
export function ChatHeader({
  session,
  todos,
  users,
  onJump,
  onSearch
}: {
  session: SessionInfo
  todos?: TodoEntry[]
  users: UserItem[]
  onJump(id: string): void
  onSearch(): void
}) {
  const bot = useBot(session.id)
  const done = todos?.filter((t) => t.status === 'completed').length ?? 0
  const current = todos?.find((t) => t.status === 'in_progress')
  const p = session.contextPercent
  const color = p === undefined ? undefined : p >= 85 ? 'var(--cct-danger)' : p >= 70 ? 'var(--cct-warn)' : 'var(--cct-ok)'
  const [open, setOpen] = useState(false)
  return (
    <div className="mg-bar flex shrink-0 items-center gap-3 overflow-hidden border-b border-border px-4 py-1.5 text-[11.5px] text-text-subtle">
      {bot && (
        <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-foreground">
          <span aria-hidden className="size-2.5 rounded-full" style={{ background: bot.color }} />
          {bot.name}
        </span>
      )}
      {session.modelLabel && <span className="text-text-muted">{session.modelLabel}</span>}
      {session.effortLevel && <span>effort {session.effortLevel}</span>}
      {p !== undefined && (
        <span className="inline-flex items-center gap-1.5" title={`Contesto usato: ${p}%`}>
          Contesto
          <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label="Contesto usato">
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, p)}%`, background: color }} />
          </span>
          <span style={{ color: p >= 70 ? color : undefined }}>{p}%</span>
        </span>
      )}
      {session.costUsd !== undefined && session.costUsd > 0 && <span title="Costo stimato della sessione">${session.costUsd.toFixed(2)}</span>}
      {todos && todos.length > 0 && (
        <span className="inline-flex min-w-0 items-center gap-1.5" title={current?.activeForm || current?.content}>
          <span className="rounded-full bg-border px-1.5 text-text-muted">
            {done}/{todos.length}
          </span>
          {current && <span className="min-w-0 truncate text-foreground">{current.activeForm || current.content}</span>}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Indice dei tuoi messaggi" title="Indice: salta a un tuo messaggio" className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-text-muted hover:bg-border hover:text-foreground">
              <ListTree size={13} /> {users.length}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-80 w-80 overflow-auto p-1">
            {users.length === 0 && <p className="px-2 py-2 text-text-faint">Nessun messaggio ancora.</p>}
            {users.map((u, i) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  onJump(u.id)
                }}
                className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left hover:bg-border"
              >
                <span className="w-5 shrink-0 text-right text-text-faint">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{u.text.replace(/\s+/g, ' ') || '[immagine]'}</span>
                <span className="shrink-0 text-[10px] text-text-faint">{timeOf(u.ts)}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <button type="button" aria-label="Cerca nella conversazione" title="Cerca nella conversazione (Ctrl+F)" onClick={onSearch} className="inline-flex size-6 items-center justify-center rounded-md text-text-muted hover:bg-border hover:text-foreground">
          <Search size={13} />
        </button>
      </div>
    </div>
  )
}
