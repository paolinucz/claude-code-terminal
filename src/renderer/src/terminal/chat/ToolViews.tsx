import { useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, CircleDashed, LoaderCircle } from 'lucide-react'
import type { TodoEntry } from '@shared/transcript'
import { renderMarkdown } from '@/docs/markdown'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { openFile } from '@/state/editor'
import { ansiToHtml, hasAnsi } from './ansi'
import { Dot, type ToolItem } from './common'
import { monacoLanguage, useCodeHighlight } from './highlight'

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Percorso assoluto di un file citato da Claude: relativo alla cartella della sessione se non lo è già. */
export function resolvePath(p: string, cwd: string): string {
  if (/^[a-zA-Z]:[\\/]|^[\\/]/.test(p) || !cwd) return p
  return `${cwd.replace(/[\\/]+$/, '')}\\${p.replace(/\//g, '\\')}`
}

/** Nome di un file come bottone che lo apre nell'editor (a una riga, se nota). */
export function FileLink({ path, cwd, line, label }: { path: string; cwd: string; line?: number; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => openFile(resolvePath(path, cwd), line ? { line, column: 1 } : undefined, cwd || undefined)}
      title={`Apri ${path}${line ? `:${line}` : ''} nell'editor`}
      className="inline-flex max-w-full items-center gap-1 truncate text-info hover:underline"
    >
      <span className="truncate">{label ?? path}</span>
      <ArrowUpRight size={11} className="shrink-0 opacity-70" aria-hidden />
    </button>
  )
}

/** Codice con la sintassi evidenziata (Monaco, solo se il linguaggio è noto). */
export function Code({ text, lang, className }: { text: string; lang: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const id = monacoLanguage(lang)
  useCodeHighlight(ref, text)
  return (
    <div ref={ref} className={cn('cct-selectable', className)}>
      <pre className="m-0 overflow-auto font-[inherit] text-[11.5px] leading-snug whitespace-pre-wrap">
        <code className={id ? `language-${id}` : undefined} dangerouslySetInnerHTML={{ __html: escapeHtml(text) }} />
      </pre>
    </div>
  )
}

/** Testo semplice di un risultato (con i colori ANSI se ci sono). */
function Output({ text, error, max = 'max-h-72' }: { text: string; error?: boolean; max?: string }) {
  const html = useMemo(() => (hasAnsi(text) ? ansiToHtml(text) : escapeHtml(text)), [text])
  return (
    <pre
      className={cn('cct-selectable m-0 overflow-auto rounded-md bg-background/60 p-2 text-[11.5px] leading-snug whitespace-pre-wrap', max, error ? 'text-danger' : 'text-text-muted')}
      dangerouslySetInnerHTML={{ __html: html || '(nessun output)' }}
    />
  )
}

/** Markdown (sanificato) di un risultato: risposte di WebFetch, WebSearch e agenti. */
function Prose({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text, '', '').html, [text])
  const ref = useRef<HTMLDivElement>(null)
  useCodeHighlight(ref, html)
  return <div ref={ref} className="cct-md cct-selectable max-h-80 overflow-auto rounded-md bg-background/60 px-3 py-2" dangerouslySetInnerHTML={{ __html: html }} />
}

const label = (k: string, v?: string) =>
  v ? (
    <span className="rounded bg-border px-1.5 py-0.5 text-[11px] text-text-subtle">
      {k} <span className="text-text-muted">{v}</span>
    </span>
  ) : null

/** Contenuto di Read: righe numerate «   12→testo» come numeri a parte e codice evidenziato. */
function ReadBody({ item, cwd }: { item: ToolItem; cwd: string }) {
  const file = item.args?.file_path ?? item.summary
  const result = item.result ?? ''
  const parsed = useMemo(() => {
    const lines = result.split('\n')
    const rows = lines.map((l) => /^\s*(\d+)→(.*)$/.exec(l))
    if (lines.length === 0 || rows.some((r, i) => !r && lines[i].trim() !== '' && !lines[i].startsWith('['))) return null
    const kept = rows.filter((r): r is RegExpExecArray => r !== null)
    return kept.length ? { numbers: kept.map((r) => r[1]).join('\n'), code: kept.map((r) => r[2]).join('\n') } : null
  }, [result])
  const ext = file.split('.').pop() ?? ''
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[12px]">
        <FileLink path={file} cwd={cwd} />
        {item.args?.offset && <span className="text-text-faint"> · da riga {item.args.offset}</span>}
        {item.args?.limit && <span className="text-text-faint"> · {item.args.limit} righe</span>}
      </div>
      {item.result === undefined ? null : parsed ? (
        <div className="flex max-h-72 overflow-auto rounded-md bg-background/60 text-[11.5px] leading-snug">
          <pre className="m-0 shrink-0 border-r border-border px-2 py-2 text-right text-text-faint select-none">{parsed.numbers}</pre>
          <Code text={parsed.code} lang={ext} className="min-w-0 flex-1 px-2 py-2" />
        </div>
      ) : (
        <Output text={result} error={item.isError} />
      )}
    </div>
  )
}

/** Risultati di Grep e Glob: ogni riga che è un percorso (anche «file:riga:testo») si apre nell'editor. */
function FindBody({ item, cwd }: { item: ToolItem; cwd: string }) {
  const a = item.args ?? {}
  const lines = (item.result ?? '').split('\n').filter((l) => l.trim())
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[12px]">
        <span className="text-foreground">{a.pattern ?? item.summary}</span>
        {label('in', a.path)}
        {label('glob', a.glob)}
        {label('tipo', a.type)}
        {label('modo', a.output_mode)}
      </div>
      {item.result !== undefined && (
        <div className="max-h-72 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11.5px] leading-snug">
          {lines.length === 0 && <span className="text-text-faint">(nessun risultato)</span>}
          {lines.slice(0, 300).map((l, i) => {
            const m = /^(.+?\.[\w]+):(\d+)(?::|-)(.*)$/.exec(l)
            if (m) {
              return (
                <div key={i} className="flex gap-2">
                  <FileLink path={m[1]} cwd={cwd} line={Number(m[2])} label={`${m[1].split(/[\\/]/).slice(-2).join('/')}:${m[2]}`} />
                  <span className="min-w-0 flex-1 truncate text-text-muted">{m[3]}</span>
                </div>
              )
            }
            return /^[^\s].*[\\/].*\.\w+$/.test(l) || /^[a-zA-Z]:[\\/]/.test(l) ? (
              <div key={i}>
                <FileLink path={l.trim()} cwd={cwd} />
              </div>
            ) : (
              <div key={i} className="text-text-muted">
                {l}
              </div>
            )
          })}
          {lines.length > 300 && <div className="text-text-faint">… altre {lines.length - 300} righe</div>}
        </div>
      )}
    </div>
  )
}

/** Dettaglio di una voce di strumento, secondo il tipo. */
export function ToolDetail({ item, cwd }: { item: ToolItem; cwd: string }) {
  const a = item.args ?? {}
  const done = item.result !== undefined
  switch (item.name) {
    case 'Bash':
      return (
        <div className="space-y-1.5">
          {a.description && <p className="text-[12px] text-text-subtle">{a.description}</p>}
          <div className="rounded-md bg-background/60 p-2">
            <span aria-hidden className="mr-1.5 float-left text-ok select-none">$</span>
            <Code text={a.command ?? item.summary} lang="shell" className="overflow-hidden" />
          </div>
          {done && <Output text={item.result ?? ''} error={item.isError} />}
        </div>
      )
    case 'Read':
      return <ReadBody item={item} cwd={cwd} />
    case 'Grep':
    case 'Glob':
      return <FindBody item={item} cwd={cwd} />
    case 'WebFetch':
    case 'WebSearch':
      return (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[12px]">
            <span className="break-all text-info">{a.url ?? a.query ?? item.summary}</span>
            {a.url && (
              <button type="button" onClick={() => /^https?:\/\//.test(a.url!) && window.open(a.url!, '_blank')} title="Apri nel browser" className="inline-flex items-center text-text-faint hover:text-foreground">
                <ArrowUpRight size={12} />
              </button>
            )}
          </div>
          {a.prompt && <p className="text-[12px] text-text-subtle">{a.prompt}</p>}
          {done && (item.isError ? <Output text={item.result ?? ''} error /> : <Prose text={item.result ?? ''} />)}
        </div>
      )
    case 'Task':
    case 'Agent':
      return (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            {label('agente', a.subagent_type)}
            <span className="text-foreground">{a.description}</span>
          </div>
          {a.prompt && (
            <details className="text-[12px]">
              <summary className="cursor-pointer text-text-faint hover:text-foreground">Istruzioni date all'agente</summary>
              <p className="cct-selectable mt-1 whitespace-pre-wrap text-text-muted">{a.prompt}</p>
            </details>
          )}
          {done && (item.isError ? <Output text={item.result ?? ''} error /> : <Prose text={item.result ?? ''} />)}
        </div>
      )
    default:
      return (
        <div className="space-y-2">
          <pre className="cct-selectable max-h-48 overflow-auto rounded-md bg-background/60 p-2 text-[11.5px] leading-snug whitespace-pre-wrap text-text-muted">{item.input}</pre>
          {done && <Output text={item.result || '(nessun output)'} error={item.isError} />}
        </div>
      )
  }
}

/** Lista di cose da fare di Claude (TodoWrite) come checklist: completate, in corso, da fare. */
export function TodoCard({ todos, compact }: { todos: TodoEntry[]; compact?: boolean }) {
  const done = todos.filter((t) => t.status === 'completed').length
  const [open, setOpen] = useState(true)
  return (
    <div className="flex gap-2">
      <Dot state={done === todos.length ? 'ok' : 'run'} />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => setOpen((v) => !v)} disabled={compact} aria-expanded={compact ? undefined : open} className="block w-full text-left disabled:cursor-default">
          <span className={cn('font-semibold', compact ? 'text-text-subtle' : 'text-foreground')}>{compact ? 'Lista aggiornata' : 'Cose da fare'}</span>
          <span className="text-text-subtle">
            {' '}
            · {done}/{todos.length}
          </span>
          {!compact && <span className="text-text-faint"> {open ? '▾' : '▸'}</span>}
        </button>
        {open && !compact && (
          <ul className="mt-1.5 space-y-1">
            {todos.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px]">
                {t.status === 'completed' ? (
                  <Check size={14} className="mt-0.5 shrink-0 text-ok" />
                ) : t.status === 'in_progress' ? (
                  <LoaderCircle size={14} className="mt-0.5 shrink-0 animate-spin text-brand" />
                ) : (
                  <CircleDashed size={14} className="mt-0.5 shrink-0 text-text-faint" />
                )}
                <span className={cn(t.status === 'completed' && 'text-text-faint line-through', t.status === 'in_progress' && 'text-foreground', t.status === 'pending' && 'text-text-muted')}>
                  {t.status === 'in_progress' ? t.activeForm || t.content : t.content}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * Piano proposto da Claude (ExitPlanMode): il testo impaginato e, finché aspetta, le scelte. I tasti sono quelli del terminale
 * (1 = approva, Esc = no, continua a pianificare): le altre varianti (approvare le modifiche una per una…) restano nel terminale.
 */
export function PlanCard({ item, sessionId, live, onShowTerminal }: { item: ToolItem; sessionId: string; live: boolean; onShowTerminal(): void }) {
  const html = useMemo(() => renderMarkdown(item.plan ?? '', '', '').html, [item.plan])
  const ref = useRef<HTMLDivElement>(null)
  useCodeHighlight(ref, html)
  const waiting = item.result === undefined
  const result = (item.result ?? '').trim()
  const approved = /approved|accepted/i.test(result) && !/rejected|denied|doesn't want/i.test(result)
  return (
    <div className="flex gap-2">
      <Dot state={waiting ? 'run' : item.isError || !approved ? 'quiet' : 'ok'} />
      <div className="min-w-0 flex-1">
        <div className="overflow-hidden rounded-xl border border-border bg-surface-2/60">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[12px]">
            <span className="font-semibold text-foreground">Piano proposto</span>
            {waiting && <span className="text-warn">· aspetta la tua approvazione</span>}
            {!waiting && <span className={approved ? 'text-ok' : 'text-text-subtle'}>· {approved ? 'approvato' : 'non approvato'}</span>}
          </div>
          <div ref={ref} className="cct-md cct-selectable max-h-96 overflow-auto px-4 py-3" dangerouslySetInnerHTML={{ __html: html }} />
          {waiting && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
              <button type="button" disabled={!live} onClick={() => api.sessions.key(sessionId, '1')} title="Invia «1» al terminale: approva il piano" className="h-7 rounded-md bg-ok px-3 text-[12px] font-semibold text-on-brand hover:opacity-90 disabled:opacity-40">
                Approva (1)
              </button>
              <button type="button" disabled={!live} onClick={() => api.sessions.key(sessionId, 'esc')} title="Invia Esc al terminale: continua a pianificare" className="h-7 rounded-md border border-danger/50 px-3 text-[12px] text-danger hover:bg-danger/10 disabled:opacity-40">
                No, continua a pianificare (Esc)
              </button>
              <button type="button" onClick={onShowTerminal} className="ml-auto h-7 rounded-md px-2 text-[12px] text-text-subtle hover:bg-border hover:text-foreground" title="Per le altre scelte (approvare le modifiche una per una…)">
                Altre scelte nel terminale
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
