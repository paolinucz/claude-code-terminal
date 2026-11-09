import { useEffect, useMemo, useRef, useState } from 'react'
import { diffLines } from 'diff'
import { ArrowDown, Check, Copy, Hand, Square } from 'lucide-react'
import type { SessionInfo } from '@shared/sessions'
import type { ChatItem, FileEdit as Edit } from '@shared/transcript'
import { renderMarkdown } from '@/docs/markdown'
import { MarkdownView } from '@/docs/MarkdownView'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { openFile } from '@/state/editor'
import { useSessions } from '@/state/sessions'

type ToolItem = ChatItem & { kind: 'tool' }

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])
/** Quanti elementi mostrare all'inizio: i più vecchi si aprono su richiesta. */
const PAGE = 120

type Block = { kind: 'item'; item: ChatItem } | { kind: 'tools'; items: ToolItem[] }

/** Strumenti consecutivi (tranne le modifiche ai file, che hanno il loro riquadro) si raggruppano. */
function toBlocks(items: ChatItem[]): Block[] {
  const out: Block[] = []
  for (const item of items) {
    if (item.kind === 'tool' && !EDIT_TOOLS.has(item.name)) {
      const last = out.at(-1)
      if (last?.kind === 'tools') last.items.push(item)
      else out.push({ kind: 'tools', items: [item] })
    } else out.push({ kind: 'item', item })
  }
  return out
}

/**
 * Vista grafica della conversazione («bridge»): gli stessi messaggi del terminale di Claude Code, impaginati.
 * Risposte in Markdown con «Copia» sui blocchi di codice, modifiche ai file come diff, strumenti raggruppati e
 * richiudibili, risposta ai permessi e interruzione con i pulsanti. Legge la trascrizione che Claude Code scrive
 * in locale; il terminale vero resta in esecuzione sotto.
 */
export function ConversationView({ session, onShowTerminal }: { session: SessionInfo; onShowTerminal(): void }) {
  const [items, setItems] = useState<ChatItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const [atBottom, setAtBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const attention = useSessions((s) => s.attention[session.id])

  useEffect(() => {
    let stale = false
    setLoaded(false)
    setItems([])
    setShown(PAGE)
    const off = api.transcript.onUpdate((u) => {
      if (u.sessionId !== session.id || stale) return
      setItems((prev) => {
        // Un elemento con lo stesso id (esito di uno strumento) sostituisce quello già mostrato.
        const index = new Map(prev.map((x, i) => [x.id, i]))
        const next = [...prev]
        for (const it of u.items) {
          const at = index.get(it.id)
          if (at === undefined) {
            index.set(it.id, next.length)
            next.push(it)
          } else next[at] = it
        }
        return next
      })
    })
    void api.transcript.open(session.id).then((initial) => {
      if (stale) return
      const byId = new Map<string, ChatItem>()
      for (const it of initial) byId.set(it.id, it)
      setItems([...byId.values()])
      setLoaded(true)
    })
    return () => {
      stale = true
      off()
      api.transcript.close(session.id)
    }
  }, [session.id])

  // Resta in fondo finché l'utente non scorre verso l'alto.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [items, loaded, session.status])

  // Il contenuto cresce dopo il primo disegno (Markdown, codice evidenziato, riquadri): finché si resta in fondo
  // si segue l'altezza, altrimenti alla riapertura la vista resterebbe sui primi messaggi.
  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    const ro = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [])

  const blocks = useMemo(() => toBlocks(items.slice(Math.max(0, items.length - shown))), [items, shown])
  const hidden = Math.max(0, items.length - shown)
  const working = session.status === 'working'
  const waiting = session.status === 'waiting'

  return (
    <div className="cct-chat absolute inset-0 z-10 flex flex-col bg-surface">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          stickRef.current = near
          setAtBottom(near)
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-5 text-[13.5px] leading-relaxed">
          {hidden > 0 && (
            <button type="button" onClick={() => setShown((n) => n + PAGE)} className="self-center rounded-lg border border-border px-3 py-1 text-[12px] text-text-subtle hover:bg-border hover:text-foreground">
              Mostra {Math.min(hidden, PAGE)} messaggi precedenti ({hidden})
            </button>
          )}
          {items.length === 0 && (
            <p className="py-10 text-center text-text-faint">
              {loaded ? 'Nessun messaggio ancora: scrivi qui sotto e la conversazione comparirà in questa vista.' : 'Caricamento della conversazione…'}
            </p>
          )}
          {blocks.map((b, i) =>
            b.kind === 'tools' ? (
              <ToolGroup key={b.items[0].id} items={b.items} />
            ) : b.item.kind === 'user' ? (
              <UserBubble key={b.item.id} text={b.item.text} ts={b.item.ts} />
            ) : b.item.kind === 'assistant' ? (
              <AssistantBlock key={b.item.id} text={b.item.text} ts={b.item.ts} />
            ) : (
              <EditCard key={b.item.id + i} item={b.item} />
            )
          )}
          {working && (
            <div className="flex items-center gap-2 text-[13px] text-text-subtle" role="status">
              <Spinner /> Claude sta lavorando…
              <button type="button" onClick={() => api.sessions.key(session.id, 'esc')} title="Interrompe Claude (come Esc nel terminale)" className="ml-2 inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-text-muted hover:bg-border hover:text-foreground">
                <Square size={10} /> Interrompi
              </button>
            </div>
          )}
        </div>
      </div>

      {!atBottom && (
        <button
          type="button"
          aria-label="Vai in fondo"
          onClick={() => {
            const el = scrollRef.current
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
          }}
          className="absolute right-5 bottom-4 inline-flex size-8 items-center justify-center rounded-full border border-border bg-surface text-text-muted shadow-lg hover:text-foreground"
        >
          <ArrowDown size={15} />
        </button>
      )}

      {waiting && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-warn/40 bg-warn/10 px-4 py-2 text-[12px]" role="alert">
          <Hand size={14} className="shrink-0 text-warn" />
          <span className="min-w-0 flex-1 text-foreground">{attention?.message || 'Claude aspetta una tua risposta (permesso o domanda).'}</span>
          <button type="button" onClick={() => api.sessions.key(session.id, '1')} title="Invia «1» al terminale: la prima scelta, di solito «Sì»" className="h-7 rounded-md bg-ok px-3 font-semibold text-on-brand hover:opacity-90">
            Sì (1)
          </button>
          <button type="button" onClick={() => api.sessions.key(session.id, 'esc')} title="Invia Esc al terminale: rifiuta o annulla" className="h-7 rounded-md border border-danger/50 px-3 text-danger hover:bg-danger/10">
            No (Esc)
          </button>
          <button type="button" onClick={onShowTerminal} className="h-7 rounded-md px-3 text-text-subtle hover:bg-border hover:text-foreground">
            Rispondi nel terminale
          </button>
        </div>
      )}
    </div>
  )
}

const timeOf = (ts?: string) => (ts ? new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '')

const SPIN = ['✻', '✺', '✹', '✸', '✷', '✶']
/** Asterisco animato, come quello di Claude Code mentre lavora. */
function Spinner() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setI((n) => (n + 1) % SPIN.length), 140)
    return () => window.clearInterval(t)
  }, [])
  return <span className="inline-block w-4 text-center text-brand">{SPIN[i]}</span>
}

/** Puntino a sinistra di ogni voce: pieno e acceso a fine lavoro, rosso se fallita, lampeggiante mentre gira. */
function Dot({ state }: { state: 'run' | 'ok' | 'err' | 'text' }) {
  return (
    <span
      aria-hidden
      className={cn('mt-[3px] w-4 shrink-0 text-center leading-none select-none', state === 'run' && 'animate-pulse text-brand', state === 'ok' && 'text-ok', state === 'err' && 'text-danger', state === 'text' && 'text-foreground')}
    >
      ●
    </span>
  )
}

function UserBubble({ text, ts }: { text: string; ts?: string }) {
  return (
    <div title={timeOf(ts)} className="flex gap-2 rounded-md bg-surface-2 px-3 py-2 text-foreground">
      <span aria-hidden className="w-4 shrink-0 text-center text-text-faint select-none">
        ›
      </span>
      <div className="min-w-0 flex-1 whitespace-pre-wrap">{text}</div>
    </div>
  )
}

function AssistantBlock({ text, ts }: { text: string; ts?: string }) {
  const html = useMemo(() => renderMarkdown(text, '', '').html, [text])
  const [copied, setCopied] = useState(false)
  return (
    <div className="group relative flex gap-2" title={timeOf(ts)}>
      <Dot state="text" />
      <MarkdownView html={html} className="min-w-0 flex-1 !overflow-visible !px-0 !py-0" />
      <button
        type="button"
        aria-label="Copia la risposta"
        onClick={() => void navigator.clipboard.writeText(text).then(() => (setCopied(true), window.setTimeout(() => setCopied(false), 1500)))}
        className="absolute top-0 right-0 inline-flex size-6 items-center justify-center rounded-md border border-border bg-surface text-text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
      >
        {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
      </button>
    </div>
  )
}

/** Prima riga utile di un risultato, con quante righe ci sono in più. */
function resultLine(result: string): string {
  const lines = result.split('\n').filter((l) => l.trim())
  if (lines.length === 0) return '(nessun output)'
  const first = lines[0].trim().slice(0, 140)
  return lines.length > 1 ? `${first}  … +${lines.length - 1} righe` : first
}

/** Voce di strumento nello stile di Claude Code: «● Nome(dettaglio)» e sotto «⎿ esito», che si apre per i dettagli. */
function ToolRow({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false)
  const done = item.result !== undefined
  const state = !done ? 'run' : item.isError ? 'err' : 'ok'
  return (
    <div className="flex gap-2">
      <Dot state={state} />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="block w-full text-left">
          <span className="font-semibold text-foreground">{item.name}</span>
          <span className="font-mono text-[12px] text-text-subtle">({item.summary})</span>
        </button>
        {done && !open && (
          <button type="button" onClick={() => setOpen(true)} className={cn('mt-0.5 flex w-full gap-1.5 text-left font-mono text-[12px]', item.isError ? 'text-danger' : 'text-text-faint')}>
            <span aria-hidden>⎿</span>
            <span className="min-w-0 flex-1 truncate">{resultLine(item.result ?? '')}</span>
          </button>
        )}
        {open && (
          <div className="mt-1 space-y-2">
            <pre className="max-h-48 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11.5px] leading-snug whitespace-pre-wrap text-text-muted">{item.input}</pre>
            {done && <pre className={cn('max-h-72 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11.5px] leading-snug whitespace-pre-wrap', item.isError ? 'text-danger' : 'text-text-muted')}>{item.result || '(nessun output)'}</pre>}
            <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-text-faint hover:text-foreground">
              Chiudi dettagli
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Gruppo di strumenti consecutivi: da tre in su è un riepilogo («Read ×5, Bash ×4») che si apre. */
function ToolGroup({ items }: { items: ToolItem[] }) {
  const [open, setOpen] = useState(false)
  if (items.length < 3) {
    return (
      <div className="space-y-1.5">
        {items.map((t) => (
          <ToolRow key={t.id} item={t} />
        ))}
      </div>
    )
  }
  const counts = new Map<string, number>()
  for (const t of items) counts.set(t.name, (counts.get(t.name) ?? 0) + 1)
  const running = items.some((t) => t.result === undefined)
  const failed = items.filter((t) => t.isError).length
  return (
    <div className="flex gap-2">
      <Dot state={running ? 'run' : failed ? 'err' : 'ok'} />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="block w-full text-left">
          <span className="font-semibold text-foreground">{items.length} strumenti</span>
          <span className="text-text-subtle"> · {[...counts].map(([n, c]) => `${n} ×${c}`).join(', ')}</span>
          {failed > 0 && <span className="text-danger"> · {failed} con errore</span>}
          <span className="text-text-faint"> {open ? '▾' : '▸'}</span>
        </button>
        {open && (
          <div className="mt-1.5 space-y-1.5 border-l border-border pl-3">
            {items.map((t) => (
              <ToolRow key={t.id} item={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const MAX_DIFF_LINES = 14

/** Modifica a un file come in Claude Code: «● Update(file)», «⎿ Aggiunte N righe, rimosse M» e il diff sotto. */
function EditCard({ item }: { item: ToolItem }) {
  const [expanded, setExpanded] = useState(false)
  const edits: Edit[] = item.edits ?? []
  const file = edits[0]?.file ?? item.summary
  const rows = useMemo(() => {
    const out: { sign: '+' | '-' | ' '; text: string }[] = []
    for (const e of edits) {
      for (const part of diffLines(e.old, e.new)) {
        const lines = part.value.replace(/\n$/, '').split('\n')
        for (const text of lines) out.push({ sign: part.added ? '+' : part.removed ? '-' : ' ', text })
      }
    }
    return out
  }, [edits])
  const added = rows.filter((r) => r.sign === '+').length
  const removed = rows.filter((r) => r.sign === '-').length
  // Il contesto invariato si mostra solo vicino alle righe cambiate.
  const visible = useMemo(() => {
    const keep = new Set<number>()
    rows.forEach((r, i) => {
      if (r.sign !== ' ') for (let k = i - 2; k <= i + 2; k++) keep.add(k)
    })
    return rows.filter((_, i) => keep.has(i))
  }, [rows])
  const shownRows = expanded ? visible : visible.slice(0, MAX_DIFF_LINES)
  const done = item.result !== undefined
  const state = !done ? 'run' : item.isError ? 'err' : 'ok'

  return (
    <div className="flex gap-2">
      <Dot state={state} />
      <div className="min-w-0 flex-1">
        <div>
          <span className="font-semibold text-foreground">{item.name === 'Write' ? 'Write' : 'Update'}</span>
          <button type="button" onClick={() => openFile(file)} title={`Apri ${file}`} className="font-mono text-[12px] text-info hover:underline">
            ({file.split(/[\\/]/).pop()})
          </button>
        </div>
        <div className="mt-0.5 flex gap-1.5 font-mono text-[12px] text-text-faint">
          <span aria-hidden>⎿</span>
          <span>
            {item.name === 'Write' ? `Scritte ${added} righe` : `Aggiunte ${added} righe, rimosse ${removed}`}
            {item.isError ? ' · errore' : ''}
          </span>
        </div>
        {shownRows.length > 0 && (
          <div className="mt-1.5 max-h-96 overflow-auto rounded-md border border-border bg-background/60 font-mono text-[11.5px] leading-snug">
            {shownRows.map((r, i) => (
              <div key={i} className={cn('flex whitespace-pre-wrap', r.sign === '+' && 'bg-ok/10 text-ok', r.sign === '-' && 'bg-danger/10 text-danger', r.sign === ' ' && 'text-text-faint')}>
                <span className="w-5 shrink-0 text-center select-none">{r.sign === ' ' ? '' : r.sign}</span>
                <span className="min-w-0 flex-1 pr-2 break-all">{r.text}</span>
              </div>
            ))}
          </div>
        )}
        {visible.length > MAX_DIFF_LINES && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-[11px] text-text-faint hover:text-foreground">
            {expanded ? 'Mostra meno' : `Mostra tutte le ${visible.length} righe`}
          </button>
        )}
        {item.isError && item.result && <pre className="mt-1 font-mono text-[11.5px] whitespace-pre-wrap text-danger">{item.result}</pre>}
      </div>
    </div>
  )
}
