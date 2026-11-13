import { useEffect, useMemo, useRef, useState } from 'react'
import { diffLines } from 'diff'
import { ArrowDown, Check, ChevronLeft, ChevronRight, Copy, Square } from 'lucide-react'
import type { SessionInfo } from '@shared/sessions'
import type { AskQuestion, ChatItem, FileEdit as Edit } from '@shared/transcript'
import { renderMarkdown } from '@/docs/markdown'
import { MarkdownView } from '@/docs/MarkdownView'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { openFile } from '@/state/editor'
import { useSessions } from '@/state/sessions'
import { isOpen } from '@shared/changes'
import { normPath } from '@shared/files'
import { CHANGE_STATUS_COLORS, CHANGE_STATUS_LABELS, useChanges } from '@/state/changes'
import { useReviewUi } from '@/state/review'
import { FindBar } from '@/docs/FindBar'
import { ChatHeader, PermissionBar, SystemRow, ThinkingRow, TurnFooter, UserBubble, type TurnStats } from './chat/ChatBits'
import { Dot, Spinner, timeOf, type ToolItem } from './chat/common'
import { useCodeHighlight } from './chat/highlight'
import { PlanCard, TodoCard, ToolDetail } from './chat/ToolViews'

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])
/** Quanti elementi mostrare all'inizio: i più vecchi si aprono su richiesta. */
const PAGE = 120

type Block = { kind: 'item'; item: ChatItem } | { kind: 'tools'; items: ToolItem[] }

/** Strumenti consecutivi (tranne le modifiche ai file, che hanno il loro riquadro) si raggruppano. */
function toBlocks(items: ChatItem[]): Block[] {
  const out: Block[] = []
  for (const item of items) {
    if (item.kind === 'tool' && !EDIT_TOOLS.has(item.name) && !item.questions && !item.todos && !item.plan) {
      const last = out.at(-1)
      if (last?.kind === 'tools') last.items.push(item)
      else out.push({ kind: 'tools', items: [item] })
    } else out.push({ kind: 'item', item })
  }
  return out
}

/**
 * Vista grafica della conversazione («bridge»): gli stessi messaggi del terminale di Claude Code, impaginati.
 * Risposte in Markdown con codice evidenziato, ragionamento ripiegabile, strumenti per tipo (Bash con l'output, Read con i numeri
 * di riga, Grep, Web, agenti), lista delle cose da fare, piano, modifiche ai file come diff, domande e permessi con il dettaglio di
 * cosa si chiede, durata e token di ogni turno, indice dei messaggi e ricerca (Ctrl+F). Legge la trascrizione che Claude Code
 * scrive in locale; il terminale vero resta in esecuzione sotto (nascosto).
 */
export function ConversationView({ session, onShowTerminal }: { session: SessionInfo; onShowTerminal(): void }) {
  const [items, setItems] = useState<ChatItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const [atBottom, setAtBottom] = useState(true)
  const [find, setFind] = useState<{ n: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const touchedRef = useRef(false)
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

  // Ctrl+F cerca nella conversazione quando ci si è cliccato dentro (come per i Markdown impaginati).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      touchedRef.current = Boolean(rootRef.current?.contains(e.target as Node))
    }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f')) return
      const root = rootRef.current
      if (!root || root.getClientRects().length === 0 || !(touchedRef.current || root.contains(document.activeElement))) return
      e.preventDefault()
      e.stopPropagation()
      setFind((f) => ({ n: (f?.n ?? 0) + 1 }))
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  const blocks = useMemo(() => toBlocks(items.slice(Math.max(0, items.length - shown))), [items, shown])
  const hidden = Math.max(0, items.length - shown)
  const working = session.status === 'working'
  // Una domanda interattiva (o un piano) di Claude senza risposta ha la sua scheda e sostituisce la barra dei permessi.
  const pendingQuestion = useMemo(() => items.some((it) => it.kind === 'tool' && it.questions && it.result === undefined), [items])
  const pendingPlan = useMemo(() => items.some((it) => it.kind === 'tool' && it.plan && it.result === undefined), [items])
  const waiting = session.status === 'waiting' && !pendingQuestion && !pendingPlan
  // Lo strumento che sta aspettando il permesso: l'ultima chiamata senza esito (a parte domande, piani e liste).
  const pendingTool = useMemo(() => {
    const last = [...items].reverse().find((it): it is ToolItem => it.kind === 'tool' && it.result === undefined && !it.questions && !it.plan && !it.todos)
    return last
  }, [items])
  // Lista delle cose da fare: vale l'ultima chiamata a TodoWrite.
  const lastTodo = useMemo(() => [...items].reverse().find((it): it is ToolItem => it.kind === 'tool' && Boolean(it.todos)), [items])
  const users = useMemo(() => items.filter((it): it is ChatItem & { kind: 'user' } => it.kind === 'user'), [items])
  // Durata, token e strumenti di ogni turno (dal tuo messaggio al successivo), mostrati dopo l'ultimo elemento del turno.
  const turnStats = useMemo(() => {
    const out = new Map<string, TurnStats>()
    let first: ChatItem | undefined
    let last: ChatItem | undefined
    let tools = 0
    const perMsg = new Map<string, number>()
    const flush = () => {
      if (!first || !last) return
      const t0 = Date.parse(first.ts ?? '')
      const t1 = Date.parse(last.ts ?? '')
      let tokens = 0
      for (const v of perMsg.values()) tokens += v
      out.set(last.id, { ms: Number.isFinite(t0) && Number.isFinite(t1) ? Math.max(0, t1 - t0) : 0, tokens, tools })
    }
    for (const it of items) {
      if (it.kind === 'user') {
        flush()
        first = it
        last = undefined
        tools = 0
        perMsg.clear()
        continue
      }
      if (!first) continue
      if (it.kind !== 'system') last = it
      if (it.kind === 'tool') tools++
      if ('msgId' in it && it.msgId && it.usage) perMsg.set(it.msgId, it.usage.output)
    }
    // Il turno in corso non ha ancora un riepilogo.
    if (!working) flush()
    return out
  }, [items, working])

  const jumpTo = (id: string) => {
    stickRef.current = false
    setAtBottom(false)
    const go = () => scrollRef.current?.querySelector(`[data-item="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    if (scrollRef.current?.querySelector(`[data-item="${CSS.escape(id)}"]`)) go()
    else {
      setShown(items.length)
      window.setTimeout(go, 80)
    }
  }

  return (
    <div ref={rootRef} className="cct-chat mg-glass-content absolute inset-0 z-10 flex flex-col">
      <ChatHeader session={session} todos={lastTodo?.todos} users={users} onJump={jumpTo} onSearch={() => setFind((f) => ({ n: (f?.n ?? 0) + 1 }))} />
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
        <div ref={contentRef} className="cct-chat-body flex max-w-3xl flex-col gap-3 px-5 py-5">
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
          {blocks.map((b, i) => {
            const lastId = b.kind === 'tools' ? b.items[b.items.length - 1].id : b.item.id
            const stats = turnStats.get(lastId)
            const node =
              b.kind === 'tools' ? (
                <ToolGroup key={b.items[0].id} items={b.items} cwd={session.cwd} />
              ) : b.item.kind === 'user' ? (
                <UserBubble key={b.item.id} item={b.item} cwd={session.cwd} />
              ) : b.item.kind === 'assistant' ? (
                <AssistantBlock key={b.item.id} item={b.item} />
              ) : b.item.kind === 'thinking' ? (
                <ThinkingRow key={b.item.id} item={b.item} />
              ) : b.item.kind === 'system' ? (
                <SystemRow key={b.item.id} item={b.item} />
              ) : b.item.questions ? (
                <QuestionCard key={b.item.id} item={b.item} sessionId={session.id} live={session.status !== 'exited'} onShowTerminal={onShowTerminal} />
              ) : b.item.plan ? (
                <PlanCard key={b.item.id} item={b.item} sessionId={session.id} live={session.status !== 'exited'} onShowTerminal={onShowTerminal} />
              ) : b.item.todos ? (
                <TodoCard key={b.item.id} todos={b.item.todos} compact={b.item.id !== lastTodo?.id} />
              ) : (
                <EditCard key={b.item.id + i} item={b.item} sessionId={session.id} />
              )
            return stats ? (
              <div key={'t' + lastId} className="flex flex-col gap-3">
                {node}
                <TurnFooter stats={stats} />
              </div>
            ) : (
              node
            )
          })}
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

      {waiting && <PermissionBar session={session} pending={pendingTool} message={attention?.message} onShowTerminal={onShowTerminal} />}
      {find && scrollRef.current && <FindBar key={find.n} root={scrollRef.current} onClose={() => setFind(null)} />}
    </div>
  )
}

function AssistantBlock({ item }: { item: ChatItem & { kind: 'assistant' } }) {
  const text = item.text
  const html = useMemo(() => renderMarkdown(text, '', '').html, [text])
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  useCodeHighlight(bodyRef, html)
  return (
    <div data-item={item.id} className="group relative flex gap-2" title={timeOf(item.ts)}>
      <Dot state="text" />
      <div ref={bodyRef} className="min-w-0 flex-1">
        <MarkdownView html={html} className="!overflow-visible !px-0 !py-0" />
      </div>
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
function ToolRow({ item, cwd }: { item: ToolItem; cwd: string }) {
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
            <ToolDetail item={item} cwd={cwd} />
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
function ToolGroup({ items, cwd }: { items: ToolItem[]; cwd: string }) {
  const [open, setOpen] = useState(false)
  if (items.length < 3) {
    return (
      <div className="space-y-1.5">
        {items.map((t) => (
          <ToolRow key={t.id} item={t} cwd={cwd} />
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
              <ToolRow key={t.id} item={t} cwd={cwd} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const MAX_DIFF_LINES = 14

/** Modifica a un file come in Claude Code: «● Update(file)», «⎿ Aggiunte N righe, rimosse M» e il diff sotto. */
function EditCard({ item, sessionId }: { item: ToolItem; sessionId: string }) {
  const [expanded, setExpanded] = useState(false)
  const edits: Edit[] = item.edits ?? []
  const file = edits[0]?.file ?? item.summary
  // Stato di revisione di questo file nella sessione: da qui si apre il cassetto accanto al terminale sul file giusto.
  const change = useChanges((s) => s.changes.find((c) => c.sessionId === sessionId && normPath(c.filePath) === normPath(file)))
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
          {change && (isOpen(change) ? (
            <button
              type="button"
              onClick={() => useReviewUi.getState().openReview(sessionId, change.id)}
              title="Apri questo file nella revisione accanto al terminale"
              className="ml-2 rounded border px-1.5 text-[11px] hover:bg-border"
              style={{ color: CHANGE_STATUS_COLORS[change.status], borderColor: CHANGE_STATUS_COLORS[change.status] }}
            >
              {CHANGE_STATUS_LABELS[change.status]} · Rivedi
            </button>
          ) : (
            <span className="ml-2 text-[11px]" style={{ color: CHANGE_STATUS_COLORS[change.status] }}>
              {CHANGE_STATUS_LABELS[change.status]}
            </span>
          ))}
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const STEP_MS = 140

/**
 * Domanda interattiva di Claude (AskUserQuestion). Si scelgono le opzioni qui e l'app le «digita» nel terminale come
 * farebbe l'utente: frecce per arrivare all'opzione, spazio per le scelte multiple, Invio per confermare. La risposta
 * libera («Altro») resta nel terminale. Risposta data: la domanda resta, con l'esito di Claude.
 */
function QuestionCard({ item, sessionId, live, onShowTerminal }: { item: ToolItem; sessionId: string; live: boolean; onShowTerminal(): void }) {
  const questions = item.questions ?? []
  const answered = item.result !== undefined
  // Una scelta per domanda (singola) o più (multipla), come indici delle opzioni.
  const [picked, setPicked] = useState<number[][]>(() => questions.map(() => []))
  const [sending, setSending] = useState(false)
  const [step, setStep] = useState(0)
  const ready = questions.every((_q, i) => picked[i].length > 0)

  const toggle = (qi: number, oi: number, q: AskQuestion) =>
    setPicked((p) => p.map((sel, i) => (i !== qi ? sel : q.multiSelect ? (sel.includes(oi) ? sel.filter((x) => x !== oi) : [...sel, oi].sort((a, b) => a - b)) : [oi])))

  const send = async () => {
    setSending(true)
    const key = (k: string) => api.sessions.key(sessionId, k)
    try {
      for (let qi = 0; qi < questions.length; qi++) {
        let cursor = 0
        for (const oi of picked[qi]) {
          for (; cursor < oi; cursor++) {
            key('down')
            await sleep(STEP_MS)
          }
          if (questions[qi].multiSelect) {
            key('space')
            await sleep(STEP_MS)
          }
        }
        key('enter')
        await sleep(STEP_MS * 2)
      }
      // Con più domande Claude Code chiede una conferma finale («Submit»).
      if (questions.length > 1) key('enter')
    } finally {
      setSending(false)
    }
  }

  const last = questions.length - 1
  const goTo = (i: number) => setStep(Math.max(0, Math.min(last, i)))
  // Scelta singola: dopo il clic si passa da soli alla domanda successiva (l'ultima resta, per «Invia»).
  const pick = (qi: number, oi: number, q: AskQuestion) => {
    toggle(qi, oi, q)
    if (!q.multiSelect && qi < last) window.setTimeout(() => setStep((cur) => (cur === qi ? qi + 1 : cur)), 260)
  }

  return (
    <div className="flex gap-2">
      <span aria-hidden className={cn('mt-[3px] w-4 shrink-0 text-center leading-none select-none', answered ? 'text-ok' : 'animate-pulse text-warn')}>
        ●
      </span>
      <div className="min-w-0 flex-1">
        <div className="overflow-hidden rounded-xl border border-border bg-surface-2">
          {/* Carosello: le domande stanno in fila e la fila scorre di una larghezza per volta. */}
          <div className="flex transition-transform duration-300 ease-out" style={{ transform: `translateX(-${step * 100}%)` }}>
            {questions.map((q, qi) => (
              <section key={qi} aria-hidden={qi !== step} aria-label={`Domanda ${qi + 1} di ${questions.length}`} className="w-full shrink-0 p-4" inert={qi !== step}>
                <div className="flex items-center gap-2">
                  {q.header && <span className="rounded bg-border px-1.5 py-0.5 text-[11px] text-text-subtle">{q.header}</span>}
                  {questions.length > 1 && <span className="ml-auto text-[11px] text-text-faint">{qi + 1} / {questions.length}</span>}
                </div>
                <p className="mt-1.5 text-[14px] font-semibold text-foreground">{q.question}</p>
                {q.multiSelect && !answered && <p className="text-[11px] text-text-faint">Puoi sceglierne più d'una.</p>}
                <div className="mt-3 flex flex-col gap-1.5">
                  {q.options.map((o, oi) => {
                    const on = picked[qi]?.includes(oi)
                    return (
                      <button
                        key={oi}
                        type="button"
                        disabled={answered || !live || sending}
                        aria-pressed={on}
                        onClick={() => pick(qi, oi, q)}
                        className={cn(
                          'flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-default',
                          on ? 'border-brand bg-brand/10 text-foreground' : 'border-border text-text-muted hover:bg-border hover:text-foreground disabled:hover:bg-transparent'
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center border text-[10px]', q.multiSelect ? 'rounded' : 'rounded-full', on ? 'border-brand bg-brand text-on-brand' : 'border-strong')}
                        >
                          {on && '✓'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{o.label}</span>
                          {o.description && <span className="block text-[12px] text-text-subtle">{o.description}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>

          {/* Barra del carosello: indietro, puntini (colorati se la domanda ha una risposta), avanti o invio. */}
          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
            {questions.length > 1 && (
              <button type="button" aria-label="Domanda precedente" disabled={step === 0} onClick={() => goTo(step - 1)} className="inline-flex size-7 items-center justify-center rounded-md text-text-subtle hover:bg-border hover:text-foreground disabled:opacity-30">
                <ChevronLeft size={15} />
              </button>
            )}
            {questions.length > 1 && (
              <div className="flex items-center gap-1.5" role="tablist" aria-label="Domande">
                {questions.map((_q, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={i === step}
                    aria-label={`Vai alla domanda ${i + 1}`}
                    onClick={() => goTo(i)}
                    className={cn('h-2 rounded-full transition-all', i === step ? 'w-5 bg-brand' : picked[i].length || answered ? 'w-2 bg-ok' : 'w-2 bg-strong hover:bg-text-faint')}
                  />
                ))}
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              {!answered && (
                <button type="button" onClick={onShowTerminal} className="h-7 rounded-md px-2 text-[12px] text-text-subtle hover:bg-border hover:text-foreground" title="Per una risposta libera («Altro») o se qualcosa non va come previsto">
                  Nel terminale
                </button>
              )}
              {!answered && step < last && (
                <button type="button" onClick={() => goTo(step + 1)} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-[12px] text-text-muted hover:bg-border hover:text-foreground">
                  Avanti <ChevronRight size={13} />
                </button>
              )}
              {!answered && step === last && (
                <button type="button" disabled={!ready || sending || !live} onClick={() => void send()} title={ready ? undefined : 'Rispondi a tutte le domande'} className="h-7 rounded-md bg-brand px-3 text-[12px] font-semibold text-on-brand hover:opacity-90 disabled:opacity-40">
                  {sending ? 'Invio…' : questions.length > 1 && !ready ? `Rispondi a tutte (${picked.filter((p) => p.length).length}/${questions.length})` : 'Invia risposta'}
                </button>
              )}
            </div>
          </div>
        </div>
        {answered && (
          <div className="mt-1.5 flex gap-1.5 font-mono text-[12px] text-text-faint">
            <span aria-hidden>⎿</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{(item.result ?? '').replace(/^User has answered your questions:\s*/i, 'Risposta: ').slice(0, 400)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
