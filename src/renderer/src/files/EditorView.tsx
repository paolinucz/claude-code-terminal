import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Download, RefreshCw } from 'lucide-react'
import { lspLanguageOf, normPath, type LspLanguage } from '@shared/files'
import { api } from '@/lib/api'
import { languageOf, monaco } from '@/lib/monaco'
import { registerEditor, takePendingReveal, useEditor } from '@/state/editor'
import { TERMINAL_FONT_FAMILY, useTerminalSettings } from '@/state/terminalSettings'
import { useWorkspace } from '@/state/workspace'
import { applyDiagnostics, ensureProviders, setModelWorkspace } from './lspMonaco'

/** Modelli condivisi tra più viste dello stesso file, con lo stato di salvataggio. */
interface Doc {
  model: monaco.editor.ITextModel
  mtime: number
  savedVersion: number
  views: number
  language: LspLanguage | null
  workspace?: string
}
const docs = new Map<string, Doc>()

const LSP_LABELS: Record<LspLanguage, string> = { java: 'Java', typescript: 'TypeScript', python: 'Python', yaml: 'YAML' }

/** Editor di un file (F2): Monaco + language server. Caricato con React.lazy. */
export default function EditorView({ filePath, workspace, onDirty }: { filePath: string; workspace?: string; onDirty(dirty: boolean): void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const docRef = useRef<Doc | null>(null)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [external, setExternal] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const fontSize = useTerminalSettings((s) => s.fontSize)
  const setStatus = useWorkspace((s) => s.setStatus)
  const language = lspLanguageOf(filePath)
  const server = useEditor((s) =>
    language
      ? Object.values(s.servers)
          .filter((x) => x.language === language && normPath(filePath).startsWith(normPath(x.root)))
          .sort((a, b) => b.root.length - a.root.length)[0]
      : undefined
  )
  const javaProgress = useEditor((s) => s.javaProgress)
  const diagnostics = useEditor((s) => s.diagnostics[normPath(filePath)])
  const onDirtyRef = useRef(onDirty)
  onDirtyRef.current = onDirty

  // Apertura: modello condiviso, editor, sincronizzazione con il language server.
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
          setError(file.binary ? 'File binario: non si può aprire nell\'editor.' : 'File troppo grande per l\'editor (oltre 5 MB).')
          return
        }
        if (disposed) return
        const uri = monaco.Uri.file(filePath)
        const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(file.text, languageOf(filePath), uri)
        if (model.getValue() !== file.text) model.setValue(file.text)
        doc = { model, mtime: file.mtime, savedVersion: model.getAlternativeVersionId(), views: 0, language, workspace }
        docs.set(key, doc)
        setModelWorkspace(filePath, workspace)
        if (language) {
          ensureProviders(language)
          api.lsp.open(language, filePath, file.text, workspace)
        }
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
        fixedOverflowWidgets: true
      })
      editorRef.current = editor
      const updateDirty = () => {
        const isDirty = d.model.getAlternativeVersionId() !== d.savedVersion
        setDirty(isDirty)
        onDirtyRef.current(isDirty)
      }
      updateDirty()

      let changeTimer: number | undefined
      subs.push(
        d.model.onDidChangeContent(() => {
          updateDirty()
          if (!d.language) return
          window.clearTimeout(changeTimer)
          changeTimer = window.setTimeout(() => api.lsp.change(d.language!, filePath, d.model.getValue(), d.workspace), 250)
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
      const diag = useEditor.getState().diagnostics[key]
      if (diag) applyDiagnostics(diag)
    })()

    return () => {
      disposed = true
      subs.forEach((s) => s.dispose())
      editorRef.current?.dispose()
      editorRef.current = null
      const d = docRef.current
      if (d) {
        d.views--
        // Ultima vista chiusa senza modifiche non salvate: si libera il modello e si avvisa il server.
        if (d.views <= 0 && d.model.getAlternativeVersionId() === d.savedVersion) {
          docs.delete(key)
          if (d.language) api.lsp.close(d.language, filePath, d.workspace)
          d.model.dispose()
        }
      }
      docRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: Math.max(11, fontSize - 1) })
  }, [fontSize])

  useEffect(() => {
    if (diagnostics) applyDiagnostics(diagnostics)
    else {
      const model = docRef.current?.model
      if (model && !model.isDisposed()) monaco.editor.setModelMarkers(model, 'lsp', [])
    }
  }, [diagnostics])

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
    if (d.language) api.lsp.save(d.language, filePath, text, d.workspace)
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

  return (
    <div className="flex h-full flex-col bg-background">
      {language === 'java' && server?.state === 'needs-install' && (
        <div className="flex shrink-0 items-center gap-3 border-b border-info/30 bg-info/10 px-3 py-2 text-[12px]">
          <Download size={14} className="shrink-0 text-info" />
          <span className="min-w-0 flex-1 text-foreground">
            {javaProgress && javaProgress.step !== 'done' && javaProgress.step !== 'error'
              ? javaProgress.message
              : javaProgress?.step === 'error'
                ? `Installazione non riuscita: ${javaProgress.message}`
                : 'Per completamento, errori e «vai alla definizione» in Java serve il supporto Java: un JRE 25 (Eclipse Temurin) e jdtls, circa 105 MB nella cartella dell\'app.'}
          </span>
          {javaProgress && javaProgress.step !== 'done' && javaProgress.step !== 'error' ? (
            <span className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-border">
              <span className="block h-full rounded-full bg-info transition-[width]" style={{ width: `${Math.round(javaProgress.progress * 100)}%` }} />
            </span>
          ) : (
            <button
              type="button"
              onClick={async () => {
                const res = await api.lsp.installJava()
                if (res.ok && docRef.current) api.lsp.open('java', filePath, docRef.current.model.getValue(), workspace)
              }}
              className="h-7 shrink-0 rounded-md bg-info px-2.5 font-semibold text-on-brand"
            >
              Scarica e installa
            </button>
          )}
        </div>
      )}
      {(external || conflict) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warn/40 bg-warn/10 px-3 py-1.5 text-[12px]">
          <AlertTriangle size={14} className="shrink-0 text-warn" />
          <span className="min-w-0 flex-1 text-foreground">
            {conflict ? 'Il file è cambiato su disco dopo che l\'hai aperto.' : 'Il file è cambiato su disco e hai modifiche non salvate.'}
          </span>
          <button type="button" onClick={() => void reloadFromDisk()} className="inline-flex h-7 items-center gap-1 rounded-md bg-border px-2.5 text-foreground hover:bg-strong">
            <RefreshCw size={12} /> Ricarica dal disco
          </button>
          <button type="button" onClick={() => void save(true)} className="h-7 rounded-md px-2.5 text-text-subtle hover:bg-border hover:text-foreground">
            Sovrascrivi con le mie
          </button>
        </div>
      )}
      <div ref={hostRef} className="min-h-0 flex-1" />
      <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-surface px-2 font-mono text-[11px] text-text-subtle">
        <span className="truncate" title={filePath}>
          {filePath}
        </span>
        {dirty && <span className="text-warn">● non salvato</span>}
        <span className="ml-auto shrink-0">
          Ln {cursor.line}, Col {cursor.column}
        </span>
        {(errors > 0 || warnings > 0) && (
          <span className="shrink-0">
            <span className={errors ? 'text-danger' : ''}>{errors} err</span> · <span className={warnings ? 'text-warn' : ''}>{warnings} avv</span>
          </span>
        )}
        <span className="shrink-0" title={server?.message}>
          {language
            ? `${LSP_LABELS[language]} · ${server ? { starting: 'avvio…', ready: 'pronto', error: 'errore', stopped: 'fermo', 'needs-install': 'da installare' }[server.state] : 'avvio…'}`
            : languageOf(filePath)}
        </span>
      </div>
    </div>
  )
}
