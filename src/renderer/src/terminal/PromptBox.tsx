import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AtSign, CornerDownLeft, SquareTerminal } from 'lucide-react'
import { CLAUDE_MD, joinRel } from '@shared/project'
import { normPath } from '@shared/files'
import type { SessionInfo } from '@shared/sessions'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useDocs } from '@/state/docs'
import type { PanelParams } from '@/panels/kinds'
import { useWorkspace } from '@/state/workspace'
import { dockRegistry } from '@/workspace/registry'
import { loadHistory, pushHistory, SLASH_COMMANDS, usePrompt } from '@/state/prompt'
import { useProject } from '@/state/project'
import { usePresets } from '@/state/presets'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui-kit'

const MAX_SUGGESTIONS = 8

interface Suggestion {
  label: string
  hint?: string
  /** Testo che sostituisce la parte digitata (da `from` al cursore). */
  insert: string
}

/** Percorso da scrivere dopo «@»: relativo alla cartella della sessione se ci sta dentro, altrimenti assoluto. */
function referenceFor(cwd: string, abs: string): string {
  const base = normPath(cwd)
  const p = normPath(abs)
  if (p.startsWith(base + '\\')) return abs.slice(cwd.replace(/[\\/]+$/, '').length + 1).replace(/\\/g, '/')
  return abs.replace(/\\/g, '/')
}

/**
 * Casella di input dell'app sotto il terminale di una sessione Claude (B1–B7). Il messaggio arriva al processo
 * come incolla seguita da Invio, quindi più righe restano un solo messaggio. Il terminale resta interattivo.
 */
export function PromptBox(props: { session: SessionInfo; viewKey: string; focusTerminal(): void }) {
  const { session, viewKey } = props
  const draft = usePrompt((s) => s.drafts[viewKey] ?? '')
  const enterSends = usePrompt((s) => s.enterSends)
  const project = useProject((s) => s.active)
  const claudeMd = useDocs((s) => s.claudeMd)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  /** Posizione nella cronologia (-1 = bozza corrente) e bozza messa da parte mentre si scorre. */
  const [histIndex, setHistIndex] = useState(-1)
  const stashed = useRef('')
  const [files, setFiles] = useState<string[]>([])
  const [pick, setPick] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  const waiting = session.status === 'waiting'
  const working = session.status === 'working'

  useEffect(() => void usePrompt.getState().load(), [])
  useEffect(() => {
    let stale = false
    void loadHistory(session.cwd).then((h) => !stale && setHistory(h))
    return () => {
      stale = true
    }
  }, [session.cwd])
  // Indice dei file della cartella della sessione, per «@» (stesso della palette comandi).
  useEffect(() => {
    let stale = false
    void api.files.index(session.cwd).then((i) => !stale && setFiles(i.files))
    return () => {
      stale = true
    }
  }, [session.cwd])

  const setDraft = (text: string) => usePrompt.getState().setDraft(viewKey, text)

  // Altezza che segue il testo, fino a un massimo.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [draft])

  // Suggerimenti: «@» per i file (B5), «/» a inizio messaggio per i comandi.
  const suggestions = useMemo<{ from: number; items: Suggestion[] }>(() => {
    const before = draft.slice(0, caret)
    const file = /(^|\s)@([^\s@]*)$/.exec(before)
    if (file) {
      const q = file[2].toLowerCase().replace(/\//g, '\\')
      const from = before.length - file[2].length - 1
      const items = files
        .filter((f) => !q || f.toLowerCase().includes(q))
        .sort((a, b) => {
          const an = a.toLowerCase().split('\\').pop()!.startsWith(q) ? 0 : 1
          const bn = b.toLowerCase().split('\\').pop()!.startsWith(q) ? 0 : 1
          return an - bn || a.length - b.length
        })
        .slice(0, MAX_SUGGESTIONS)
        .map((f) => ({ label: f.replace(/\\/g, '/'), insert: `@${f.replace(/\\/g, '/')} ` }))
      return { from, items }
    }
    const cmd = /^\/([\w-]*)$/.exec(before)
    if (cmd) {
      const q = cmd[1].toLowerCase()
      const items = SLASH_COMMANDS.filter((c) => c.name.startsWith(q)).map((c) => ({ label: `/${c.name}`, hint: c.hint, insert: `/${c.name} ` }))
      return { from: 0, items }
    }
    return { from: 0, items: [] }
  }, [draft, caret, files])
  const open = !dismissed && suggestions.items.length > 0
  useEffect(() => setPick(0), [suggestions.items.length, draft])
  useEffect(() => setDismissed(false), [draft])

  const accept = (s: Suggestion) => {
    const next = draft.slice(0, suggestions.from) + s.insert + draft.slice(caret)
    const pos = suggestions.from + s.insert.length
    setDraft(next)
    requestAnimationFrame(() => {
      areaRef.current?.focus()
      areaRef.current?.setSelectionRange(pos, pos)
      setCaret(pos)
    })
  }

  /** B6: inserisce nel messaggio il riferimento a un file (documento del progetto o file aperto nell'editor). */
  const insertReference = (abs: string) => {
    const ref = `@${referenceFor(session.cwd, abs)} `
    const at = areaRef.current?.selectionStart ?? draft.length
    const needsSpace = at > 0 && !/\s$/.test(draft.slice(0, at))
    const next = draft.slice(0, at) + (needsSpace ? ' ' : '') + ref + draft.slice(at)
    setDraft(next)
    requestAnimationFrame(() => areaRef.current?.focus())
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || sending || waiting) return
    setSending(true)
    setError('')
    const res = await api.sessions.sendPrompt(session.id, text)
    setSending(false)
    if (!res.ok) {
      setError(res.error ?? 'Messaggio non inviato')
      return
    }
    setDraft('')
    setHistIndex(-1)
    setHistory(await pushHistory(session.cwd, text))
    areaRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPick((p) => (p + 1) % suggestions.items.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPick((p) => (p - 1 + suggestions.items.length) % suggestions.items.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey)) {
        e.preventDefault()
        accept(suggestions.items[pick])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return
      }
    }
    if (e.key === 'Enter') {
      const sendsNow = enterSends ? !e.shiftKey && !e.ctrlKey : e.ctrlKey
      if (sendsNow) {
        e.preventDefault()
        void send()
      }
      return
    }
    // Cronologia (B4): frecce solo quando il cursore è a inizio o fine del testo, così non disturbano il testo su più righe.
    const el = e.currentTarget
    if (e.key === 'ArrowUp' && el.selectionStart === 0 && el.selectionEnd === 0 && history.length > 0) {
      e.preventDefault()
      const next = Math.min(histIndex + 1, history.length - 1)
      if (histIndex === -1) stashed.current = draft
      setHistIndex(next)
      setDraft(history[next])
    } else if (e.key === 'ArrowDown' && histIndex >= 0 && el.selectionStart === draft.length) {
      e.preventDefault()
      const next = histIndex - 1
      setHistIndex(next)
      setDraft(next < 0 ? stashed.current : history[next])
    } else if (e.key === 'Escape') {
      props.focusTerminal()
    }
  }

  // Documenti del progetto da inserire come riferimento (B6): CLAUDE.md, globali e contesto del foglio.
  const docRefs = useMemo(() => {
    if (!project) return []
    const sheetCtx = useProject.getState().activeContextId
    const ctx = project.data.contexts.find((c) => c.id === sheetCtx)
    return [
      ...(claudeMd === 'present' ? [CLAUDE_MD] : []),
      ...project.data.docs.global,
      ...(ctx?.docs ?? [])
    ].map((rel) => ({ rel, abs: joinRel(project.root, rel) }))
  }, [project, claudeMd])

  const sendLabel = enterSends ? 'Invio per mandare · Maiusc+Invio per andare a capo' : 'Ctrl+Invio per mandare · Invio va a capo'

  return (
    <div className="relative shrink-0 border-t border-border bg-surface px-2 py-2">
      {open && (
        <ul
          role="listbox"
          aria-label="Suggerimenti"
          className="absolute right-2 bottom-full left-2 z-10 mb-1 max-h-60 overflow-auto rounded-lg border border-border bg-surface-2 py-1 text-[12px] shadow-lg"
        >
          {suggestions.items.map((s, i) => (
            <li
              key={s.label}
              role="option"
              aria-selected={i === pick}
              onMouseDown={(e) => {
                e.preventDefault()
                accept(s)
              }}
              onMouseEnter={() => setPick(i)}
              className={cn('flex cursor-pointer items-center gap-3 px-3 py-1', i === pick ? 'bg-border text-foreground' : 'text-text-muted')}
            >
              <span className="min-w-0 truncate font-mono">{s.label}</span>
              {s.hint && <span className="ml-auto shrink-0 text-text-faint">{s.hint}</span>}
            </li>
          ))}
        </ul>
      )}

      {waiting && (
        <p className="mb-1.5 flex items-center gap-2 text-[12px] text-warn" role="status">
          Claude aspetta una tua risposta nel terminale (permesso o domanda): rispondi lì.
          <button type="button" onClick={props.focusTerminal} className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-text-muted hover:bg-border hover:text-foreground">
            <SquareTerminal size={12} /> Vai al terminale
          </button>
        </p>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={areaRef}
          value={draft}
          rows={1}
          disabled={waiting}
          aria-label={`Messaggio per «${session.title}»`}
          placeholder={waiting ? 'In attesa di una risposta nel terminale…' : working ? 'Claude sta lavorando: il messaggio va in coda…' : 'Scrivi a Claude… (@ per i file, / per i comandi)'}
          onChange={(e) => {
            setDraft(e.target.value)
            setCaret(e.target.selectionStart)
            setHistIndex(-1)
            setError('')
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          className="max-h-[200px] min-h-9 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-[13px] leading-snug text-foreground outline-none placeholder:text-text-faint focus:border-brand disabled:opacity-50"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={waiting}
              title="Inserisci il riferimento a un file"
              aria-label="Inserisci il riferimento a un file"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:bg-border hover:text-foreground disabled:opacity-40"
            >
              <AtSign size={15} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-72">
            <DropdownMenuLabel>Riferimento a…</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => {
                const path = activeEditorFile()
                if (path) insertReference(path)
              }}
              disabled={!activeEditorFile()}
            >
              File aperto nell&apos;editor
            </DropdownMenuItem>
            {docRefs.length > 0 && <DropdownMenuSeparator />}
            {docRefs.map((d) => (
              <DropdownMenuItem key={d.abs} onSelect={() => insertReference(d.abs)}>
                <span className="truncate">{d.rel}</span>
              </DropdownMenuItem>
            ))}
            {docRefs.length === 0 && <DropdownMenuItem disabled>Nessun documento di progetto</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={() => void send()}
          disabled={!draft.trim() || sending || waiting}
          title={sendLabel}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold text-on-brand transition-opacity disabled:opacity-40"
        >
          <CornerDownLeft size={14} /> Invia
        </button>
      </div>

      <div className="mt-1 flex items-center gap-3 text-[11px] text-text-faint">
        <span className="min-w-0 truncate">{error ? <span className="text-danger">{error}</span> : sendLabel}</span>
        <button
          type="button"
          onClick={() => usePresets.getState().openDialog(draft.trim() || undefined)}
          className="ml-auto shrink-0 underline-offset-2 hover:text-foreground hover:underline"
          title="Salva il messaggio come prompt predefinito, da mandare con un clic dalla palette (Ctrl+K)"
        >
          Prompt predefiniti…
        </button>
        <button
          type="button"
          onClick={() => usePrompt.getState().setEnterSends(!enterSends)}
          className="shrink-0 underline-offset-2 hover:text-foreground hover:underline"
          title="Scegli se Invio manda il messaggio o va a capo"
        >
          {enterSends ? 'Invio manda' : 'Ctrl+Invio manda'}
        </button>
      </div>
    </div>
  )
}

/** File aperto nell'editor del foglio attivo (per «Riferimento a…»). */
function activeEditorFile(): string | undefined {
  const dock = dockRegistry.get(useWorkspace.getState().activeSheetId)
  const editors = (dock?.panels ?? []).filter((p) => {
    const params = p.params as PanelParams | undefined
    return params?.kind === 'editor' && Boolean(params.filePath)
  })
  const chosen = editors.find((p) => p.api.isActive) ?? editors[0]
  return (chosen?.params as PanelParams | undefined)?.filePath
}
