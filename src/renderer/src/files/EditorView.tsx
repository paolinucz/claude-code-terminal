import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BookOpen, ClipboardCheck, Code2, Puzzle, RefreshCw } from 'lucide-react'
import type { ReviewNote } from '@shared/changes'
import type { LineSelection } from '@/changes/DiffView'
import { RevisionComposer } from '@/changes/RevisionComposer'
import { targetClaudeSession } from '@/workspace/presets'
import { MarkdownView } from '@/docs/MarkdownView'
import { renderMarkdown } from '@/docs/markdown'
import { useExplainSettings } from '@/state/explain'
import { useSnippetExplain } from '@/state/snippetExplain'
import { usePluginGutter } from '@/state/pluginGutter'
import { normPath } from '@shared/files'
import { api } from '@/lib/api'
import { languageOf, monaco } from '@/lib/monaco'
import { openPluginsPanel, pluginLanguageOf, registerEditor, takePendingReveal, useEditor } from '@/state/editor'
import { TERMINAL_FONT_FAMILY, useTerminalSettings } from '@/state/terminalSettings'
import { useWorkspace } from '@/state/workspace'
import { applyDiagnostics, ensureProviders, setModelWorkspace } from './lspMonaco'

/** Modelli condivisi tra più viste dello stesso file, con lo stato di salvataggio. */
interface Doc {
  model: monaco.editor.ITextModel
  mtime: number
  savedVersion: number
  views: number
  /** Il documento è stato mandato ai language server. */
  lspOpen: boolean
  workspace?: string
}
const docs = new Map<string, Doc>()

/** Estensioni per cui esiste un plugin preparato (per suggerire quale importare, X9). */
const KNOWN_PLUGINS: Record<string, string> = {
  java: 'Java', ts: 'TypeScript/JavaScript', tsx: 'TypeScript/JavaScript', js: 'TypeScript/JavaScript', jsx: 'TypeScript/JavaScript',
  mjs: 'TypeScript/JavaScript', cjs: 'TypeScript/JavaScript', py: 'Python', yml: 'YAML', yaml: 'YAML', xml: 'Maven (e XML)',
  gradle: 'Gradle', html: 'Angular'
}

/** Editor di un file (F2): Monaco + language server dei plugin. Caricato con React.lazy. */
export default function EditorView({ filePath, workspace, onDirty }: { filePath: string; workspace?: string; onDirty(dirty: boolean): void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const docRef = useRef<Doc | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [external, setExternal] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const fontSize = useTerminalSettings((s) => s.fontSize)
  const setStatus = useWorkspace((s) => s.setStatus)
  const languages = useEditor((s) => s.languages)
  const lang = pluginLanguageOf(filePath, languages)
  // Il selettore deve restituire un valore stabile (lo stato così com'è): un array nuovo a ogni
  // lettura manda React 19 in un ciclo di aggiornamenti infinito (errore #185, finestra vuota).
  const allServers = useEditor((s) => s.servers)
  const servers = useMemo(
    () => (lang ? Object.values(allServers).filter((x) => x.languages.includes(lang.id) && normPath(filePath).startsWith(normPath(x.root))) : []),
    [allServers, lang?.id, filePath]
  )
  const diagnostics = useEditor((s) => s.diagnostics[normPath(filePath)])
  // Markdown: anteprima impaginata (predefinita) o sorgente. L'editor resta montato, nascosto, così non perde stato.
  const isMarkdown = /\.(md|markdown)$/i.test(filePath)
  const [mode, setMode] = useState<'preview' | 'source'>(isMarkdown ? 'preview' : 'source')
  const [mdText, setMdText] = useState('')
  const explainOn = useExplainSettings((s) => s.enabled)
  // Anteprima con le righe del sorgente sui blocchi (per revisionare e spiegare dal Markdown impaginato).
  const mdPreview = useMemo(
    () => (isMarkdown ? renderMarkdown(mdText, filePath.replace(/[\/][^\/]*$/, ''), '', true).html : ''),
    [isMarkdown, mdText, filePath]
  )
  // Modalità revisione: dal tasto destro sulle righe selezionate si chiedono modifiche a Claude, per qualsiasi file.
  const [reviewMode, setReviewMode] = useState(false)
  const [composing, setComposing] = useState(false)
  const [seed, setSeed] = useState<{ selection: LineSelection; n: number } | null>(null)
  const [selection, setSelection] = useState<LineSelection | null>(null)
  const [sending, setSending] = useState(false)
  const [composeError, setComposeError] = useState('')
  const [target, setTarget] = useState<{ id: string; title: string } | null>(null)
  const startReview = (sel: LineSelection) => {
    const t = targetClaudeSession()
    setTarget('error' in t ? null : t)
    setComposeError('error' in t ? t.error : '')
    // Il tasto destro «Revisiona…» fa entrare nella modalità revisione.
    setReviewMode(true)
    setComposing(true)
    setSeed((x) => ({ selection: sel, n: (x?.n ?? 0) + 1 }))
  }
  const startReviewRef = useRef(startReview)
  startReviewRef.current = startReview
  const isMarkdownRef = useRef(isMarkdown)
  isMarkdownRef.current = isMarkdown
  const onDirtyRef = useRef(onDirty)
  onDirtyRef.current = onDirty

  // Un plugin attivo che chiede il margine per il linguaggio di questo file (contributo `editorGutter`).
  const allPlugins = useEditor((s) => s.plugins)
  const gutter = useMemo(() => {
    if (!lang) return null
    for (const p of allPlugins) {
      const g = p.manifest.contributes?.editorGutter
      if (p.enabled && p.state === 'ok' && g?.languages.includes(lang.id)) return { pluginId: p.manifest.id, click: g.click }
    }
    return null
  }, [allPlugins, lang?.id])

  // Apertura: modello condiviso ed editor.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const subs: { dispose(): void }[] = []
    const key = normPath(filePath)

    void (async () => {
      let doc = docs.get(key)
      if (!doc) {
        let file
        try {
          file = await api.files.read(filePath)
        } catch (err) {
          setError(`Impossibile aprire il file: ${(err as Error).message}`)
          return
        }
        if (file.binary || file.tooLarge) {
          setError(file.binary ? "File binario: non si può aprire nell'editor." : "File troppo grande per l'editor (oltre 5 MB).")
          return
        }
        if (disposed) return
        const uri = monaco.Uri.file(filePath)
        const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(file.text, languageOf(filePath), uri)
        if (model.getValue() !== file.text) model.setValue(file.text)
        doc = { model, mtime: file.mtime, savedVersion: model.getAlternativeVersionId(), views: 0, lspOpen: false, workspace }
        docs.set(key, doc)
        setModelWorkspace(filePath, workspace)
      }
      if (disposed) return
      doc.views++
      docRef.current = doc
      const d = doc

      const editor = monaco.editor.create(host, {
        model: d.model,
        theme: 'cct-dark',
        automaticLayout: true,
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: Math.max(11, useTerminalSettings.getState().fontSize - 1),
        lineHeight: 1.45,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        tabSize: 4,
        detectIndentation: true,
        fixedOverflowWidgets: true,
        // Margine per i segni dei plugin (breakpoint, riga fermata) se un plugin li chiede per questo linguaggio.
        glyphMargin: Boolean(gutter)
      })
      editorRef.current = editor
      if (gutter) {
        // Contributo `editorGutter` di un plugin: i segni li decide l'adapter, il clic nel margine va all'adapter.
        const marks = editor.createDecorationsCollection()
        const k = normPath(filePath)
        const paint = () => {
          const list = usePluginGutter.getState().markers[gutter.pluginId]?.[k] ?? []
          marks.set(
            list.map((m) =>
              m.kind === 'stopped'
                ? { range: new monaco.Range(m.line, 1, m.line, 1), options: { isWholeLine: true, className: 'cct-debug-line', glyphMarginClassName: 'cct-debug-arrow', glyphMarginHoverMessage: m.hint ? { value: m.hint } : undefined } }
                : { range: new monaco.Range(m.line, 1, m.line, 1), options: { glyphMarginClassName: m.kind === 'breakpoint-disabled' ? 'cct-bp cct-bp-off' : 'cct-bp', glyphMarginHoverMessage: m.hint ? { value: m.hint } : undefined } }
            )
          )
        }
        paint()
        subs.push({ dispose: usePluginGutter.subscribe(paint) })
        subs.push(
          editor.onMouseDown((e) => {
            if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) {
              void api.plugins.call(gutter.pluginId, gutter.click, { path: filePath, line: e.target.position.lineNumber }).catch(() => {})
            }
          })
        )
      }
      // Tasto destro sulla selezione: spiegazione di Haiku (solo se la funzione è attiva).
      editor.addAction({
        id: 'cct.explain',
        label: 'Spiega con Haiku',
        contextMenuGroupId: '9_cct',
        contextMenuOrder: 1,
        precondition: 'editorHasSelection',
        run: (ed) => {
          const sel = ed.getSelection()
          if (!sel || sel.isEmpty() || !useExplainSettings.getState().enabled) return
          const end = sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber
          useSnippetExplain.getState().open({ filePath, text: d.model.getValue(), start: sel.startLineNumber, end })
        }
      })
      const linesOf = (sel: monaco.Selection): LineSelection => {
        const end = sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber
        const excerpt = d.model.getValueInRange({ startLineNumber: sel.startLineNumber, startColumn: 1, endLineNumber: end, endColumn: d.model.getLineMaxColumn(end) })
        return { start: sel.startLineNumber, end, excerpt }
      }
      editor.addAction({
        id: 'cct.review',
        label: 'Revisiona…',
        contextMenuGroupId: '9_cct',
        contextMenuOrder: 0,
        precondition: 'editorHasSelection',
        run: (ed) => {
          const sel = ed.getSelection()
          if (sel && !sel.isEmpty()) startReviewRef.current(linesOf(sel))
        }
      })
      subs.push(editor.onDidChangeCursorSelection((e) => setSelection(e.selection.isEmpty() ? null : linesOf(e.selection))))
      const updateDirty = () => {
        const isDirty = d.model.getAlternativeVersionId() !== d.savedVersion
        setDirty(isDirty)
        onDirtyRef.current(isDirty)
      }
      updateDirty()

      let changeTimer: number | undefined
      let mdTimer: number | undefined
      setMdText(d.model.getValue())
      subs.push(
        d.model.onDidChangeContent(() => {
          updateDirty()
          if (isMarkdownRef.current) {
            window.clearTimeout(mdTimer)
            mdTimer = window.setTimeout(() => setMdText(d.model.getValue()), 200)
          }
          if (!d.lspOpen) return
          window.clearTimeout(changeTimer)
          changeTimer = window.setTimeout(() => api.lsp.change(filePath, d.model.getValue(), d.workspace), 250)
        }),
        editor.onDidChangeCursorPosition((e) => setCursor({ line: e.position.lineNumber, column: e.position.column }))
      )
      // Ctrl+S: salva.
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save(false))

      const reveal = (p?: { line: number; column: number }) => {
        if (!p) return
        editor.setPosition({ lineNumber: p.line, column: p.column })
        editor.revealPositionInCenter({ lineNumber: p.line, column: p.column })
        editor.focus()
      }
      reveal(takePendingReveal(filePath))
      subs.push({ dispose: registerEditor(filePath, reveal) })

      // Il file cambia su disco (per esempio una modifica di Claude): si ricarica se non ci sono modifiche non salvate.
      const dir = filePath.replace(/[\\/][^\\/]*$/, '')
      api.files.watch(dir)
      const off = api.files.onChanged(async (_root, paths) => {
        if (!paths.some((p) => normPath(p) === key)) return
        const file = await api.files.read(filePath).catch(() => null)
        if (!file || file.mtime === d.mtime) return
        if (d.model.getAlternativeVersionId() === d.savedVersion) {
          if (file.text !== d.model.getValue()) {
            const pos = editor.getPosition()
            d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text: file.text }], () => null)
            d.savedVersion = d.model.getAlternativeVersionId()
            if (pos) editor.setPosition(pos)
            updateDirty()
            setStatus(`${filePath.split(/[\\/]/).pop()} ricaricato: è cambiato su disco`)
          }
          d.mtime = file.mtime
        } else {
          setExternal(true)
        }
      })
      subs.push({ dispose: () => (off(), api.files.unwatch(dir)) })
      setReady(true)
    })()

    return () => {
      disposed = true
      subs.forEach((s) => s.dispose())
      editorRef.current?.dispose()
      editorRef.current = null
      const d = docRef.current
      if (d) {
        d.views--
        // Ultima vista chiusa senza modifiche non salvate: si libera il modello e si avvisano i server.
        if (d.views <= 0 && d.model.getAlternativeVersionId() === d.savedVersion) {
          docs.delete(key)
          if (d.lspOpen) api.lsp.close(filePath)
          d.model.dispose()
        }
      }
      docRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  // Linguaggio dai plugin: colorazione, provider e apertura nei server. Si ripete se cambiano i plugin installati.
  useEffect(() => {
    const d = docRef.current
    if (!ready || !d || !lang) return
    if (d.model.getLanguageId() !== lang.monaco) monaco.editor.setModelLanguage(d.model, lang.monaco)
    if (!lang.hasServer) return
    ensureProviders(lang.monaco)
    if (!d.lspOpen) {
      d.lspOpen = true
      api.lsp.open(filePath, d.model.getValue(), d.workspace)
    }
  }, [ready, lang?.id, lang?.monaco, lang?.hasServer, filePath])

  const sendReview = async (notes: ReviewNote[]) => {
    if (!target) {
      setComposeError('Nessuna sessione Claude aperta in questo foglio: aprine una con «Terminale».')
      return
    }
    if (dirty) {
      setComposeError('Il file ha modifiche non salvate: salva (Ctrl+S) prima, Claude legge il file dal disco.')
      return
    }
    setSending(true)
    setComposeError('')
    const res = await api.changes.reviewFile(target.id, filePath, notes)
    setSending(false)
    if (!res.ok) {
      setComposeError(res.error ?? 'Impossibile inviare la richiesta')
      return
    }
    setComposing(false)
    setStatus(`Richiesta inviata a «${target.title}»: ${filePath.split(/[\/]/).pop()}`)
  }

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: Math.max(11, fontSize - 1) })
  }, [fontSize])

  useEffect(() => {
    if (diagnostics) applyDiagnostics(diagnostics)
    else {
      const model = docRef.current?.model
      if (model && !model.isDisposed()) monaco.editor.setModelMarkers(model, 'lsp', [])
    }
  }, [diagnostics, ready])

  async function save(force: boolean) {
    const d = docRef.current
    if (!d) return
    const text = d.model.getValue()
    const version = d.model.getAlternativeVersionId()
    const res = await api.files.write(filePath, text, d.mtime, force)
    if (res.conflict) {
      setConflict(true)
      return
    }
    if (!res.ok) {
      setStatus(`Salvataggio non riuscito: ${res.error}`)
      return
    }
    d.mtime = res.mtime ?? d.mtime
    d.savedVersion = version
    setDirty(d.model.getAlternativeVersionId() !== version)
    onDirtyRef.current(d.model.getAlternativeVersionId() !== version)
    setConflict(false)
    setExternal(false)
    if (d.lspOpen) api.lsp.save(filePath, text)
    setStatus(`${filePath.split(/[\\/]/).pop()} salvato`)
  }

  const reloadFromDisk = async () => {
    const d = docRef.current
    if (!d) return
    const file = await api.files.read(filePath)
    d.model.setValue(file.text)
    d.mtime = file.mtime
    d.savedVersion = d.model.getAlternativeVersionId()
    setDirty(false)
    onDirtyRef.current(false)
    setExternal(false)
    setConflict(false)
  }

  if (error) return <div className="flex h-full items-center justify-center p-6 text-center text-text-subtle">{error}</div>

  const errors = diagnostics?.diagnostics.filter((x) => x.severity === 1).length ?? 0
  const warnings = diagnostics?.diagnostics.filter((x) => x.severity === 2).length ?? 0
  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  const suggested = KNOWN_PLUGINS[ext]
  // X9: niente plugin (o plugin senza server attivo) per questo file.
  const missingPlugin = (!lang && suggested) || (lang && !lang.hasServer)
  const STATE: Record<string, string> = { starting: 'avvio…', ready: 'pronto', error: 'errore', stopped: 'fermo' }

  return (
    <div className="flex h-full flex-col bg-background">
      {missingPlugin && (
        <div className="flex shrink-0 items-center gap-3 border-b border-info/30 bg-info/10 px-3 py-2 text-[12px]">
          <Puzzle size={14} className="shrink-0 text-info" />
          <span className="min-w-0 flex-1 text-foreground">
            {lang
              ? `Il plugin per i file .${ext} è installato ma il suo language server non è attivo (disattivato o manca un plugin richiesto).`
              : `Nessun plugin per i file .${ext}: importa il plugin «${suggested}» per completamento, errori e «vai alla definizione».`}
          </span>
          <button type="button" onClick={openPluginsPanel} className="h-7 shrink-0 rounded-md bg-info px-2.5 font-semibold text-on-brand">
            Gestisci plugin
          </button>
        </div>
      )}
      {(external || conflict) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warn/40 bg-warn/10 px-3 py-1.5 text-[12px]">
          <AlertTriangle size={14} className="shrink-0 text-warn" />
          <span className="min-w-0 flex-1 text-foreground">
            {conflict ? "Il file è cambiato su disco dopo che l'hai aperto." : 'Il file è cambiato su disco e hai modifiche non salvate.'}
          </span>
          <button type="button" onClick={() => void reloadFromDisk()} className="inline-flex h-7 items-center gap-1 rounded-md bg-border px-2.5 text-foreground hover:bg-strong">
            <RefreshCw size={12} /> Ricarica dal disco
          </button>
          <button type="button" onClick={() => void save(true)} className="h-7 rounded-md px-2.5 text-text-subtle hover:bg-border hover:text-foreground">
            Sovrascrivi con le mie
          </button>
        </div>
      )}
      {isMarkdown && (
        <div className="flex shrink-0 items-center gap-1 border-b border-border bg-surface px-2 py-1">
          {(
            [
              ['preview', 'Anteprima', BookOpen],
              ['source', 'Sorgente', Code2]
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => {
                setMode(id)
                if (id === 'source') window.setTimeout(() => editorRef.current?.layout(), 0)
              }}
              className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] ${mode === id ? 'bg-border text-foreground' : 'text-text-subtle hover:text-foreground'}`}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      )}
      {isMarkdown && mode === 'preview' && (
        <MarkdownView
          html={mdPreview}
          findable
          className="min-h-0 flex-1"
          actions={{
            source: mdText,
            onReview: startReview,
            onExplain: explainOn ? (sel) => useSnippetExplain.getState().open({ filePath, text: mdText, start: sel.start, end: sel.end }) : undefined
          }}
        />
      )}
      <div ref={hostRef} className={mode === 'preview' && isMarkdown ? 'hidden' : 'min-h-0 flex-1'} />
      {composing && (
        <RevisionComposer
          sessionTitle={target?.title ?? 'nessuna sessione'}
          selection={selection}
          seed={seed}
          sending={sending}
          error={composeError}
          onSend={(notes) => void sendReview(notes)}
          onCancel={() => setComposing(false)}
        />
      )}
      <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-surface px-2 font-mono text-[11px] text-text-subtle">
        <span className="truncate" title={filePath}>
          {filePath}
        </span>
        {dirty && <span className="text-warn">● non salvato</span>}
        <button
          type="button"
          aria-pressed={reviewMode}
          onClick={() => {
            setReviewMode((v) => !v)
            if (reviewMode) setComposing(false)
          }}
          title="Modalità revisione: seleziona del testo e usa il tasto destro › Revisiona… per chiedere modifiche a Claude (il comando la attiva da solo)"
          className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 ${reviewMode ? 'bg-info/20 text-info' : 'hover:text-foreground'}`}
        >
          <ClipboardCheck size={11} /> Revisione{reviewMode ? ' attiva' : ''}
        </button>
        <span className="shrink-0">
          Ln {cursor.line}, Col {cursor.column}
        </span>
        {(errors > 0 || warnings > 0) && (
          <span className="shrink-0">
            <span className={errors ? 'text-danger' : ''}>{errors} err</span> · <span className={warnings ? 'text-warn' : ''}>{warnings} avv</span>
          </span>
        )}
        {servers.map((s) => (
          <span key={s.key} className="shrink-0" title={`${s.name} · ${s.root}${s.message ? `\n${s.message}` : ''}`}>
            {s.name} · {STATE[s.state] ?? s.state}
          </span>
        ))}
        {!servers.length && <span className="shrink-0">{lang?.monaco ?? languageOf(filePath)}</span>}
      </div>
    </div>
  )
}
