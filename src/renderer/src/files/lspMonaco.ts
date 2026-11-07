/**
 * Ponte tra Monaco e i language server (F2): completamento, descrizioni al passaggio del mouse,
 * «vai alla definizione» e diagnostica come marcatori. Si carica solo con l'editor (Monaco è pesante).
 */
import { normPath } from '@shared/files'
import type { ApiCompletionKind, ApiPosition, ApiRange } from '@shared/pluginApi'
import { api } from '@/lib/api'
import { monaco } from '@/lib/monaco'
import { openFile, type MergedDiagnostics } from '@/state/editor'

// Il servizio TypeScript integrato in Monaco farebbe doppio lavoro con il server di TypeScript 7.
try {
  const ts = (monaco as unknown as { typescript?: { typescriptDefaults: ModeDefaults; javascriptDefaults: ModeDefaults } }).typescript
  for (const d of [ts?.typescriptDefaults, ts?.javascriptDefaults]) {
    d?.setModeConfiguration?.({ completionItems: false, hovers: false, definitions: false, diagnostics: false, references: false, signatureHelp: false, documentHighlights: false, rename: false, codeActions: false })
    d?.setDiagnosticsOptions?.({ noSemanticValidation: true, noSyntaxValidation: true })
  }
} catch {
  // versione di Monaco senza servizio TypeScript integrato
}
interface ModeDefaults {
  setModeConfiguration?(c: Record<string, boolean>): void
  setDiagnosticsOptions?(o: Record<string, boolean>): void
}

/** Percorso Windows di un modello Monaco (i modelli usano URI file:///). */
export const pathOfModel = (model: monaco.editor.ITextModel): string => model.uri.fsPath

/** Cartella di progetto di ogni modello aperto (serve al processo principale per scegliere il server). */
const workspaces = new Map<string, string | undefined>()
export function setModelWorkspace(path: string, workspace: string | undefined): void {
  workspaces.set(normPath(path), workspace)
}

const registered = new Set<string>()

/**
 * Registra i provider di Monaco per un linguaggio di Monaco (una volta sola). Le richieste vanno
 * al processo principale per file: è lui a sapere quali server dei plugin gestiscono quel file.
 */
export function ensureProviders(monacoLanguage: string): void {
  if (registered.has(monacoLanguage)) return
  registered.add(monacoLanguage)
  for (const id of [monacoLanguage]) {
    monaco.languages.registerCompletionItemProvider(id, {
      triggerCharacters: ['.', ':', '<', '"', "'", '/', '@', '('],
      async provideCompletionItems(model, position) {
        const res = await api.lsp.completion(pathOfModel(model), toApi(position))
        const word = model.getWordUntilPosition(position)
        const fallback = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        return {
          incomplete: Boolean(res?.incomplete),
          suggestions: (res?.items ?? []).slice(0, 1000).map((it) => ({
            label: it.label,
            kind: completionKind(it.kind),
            detail: it.detail,
            documentation: it.documentation ? { value: it.documentation } : undefined,
            insertText: it.insertText,
            insertTextRules: it.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            range: it.range ? toMonacoRange(it.range) : fallback,
            sortText: it.sortText,
            filterText: it.filterText
          }))
        }
      }
    })

    monaco.languages.registerHoverProvider(id, {
      async provideHover(model, position) {
        const res = await api.lsp.hover(pathOfModel(model), toApi(position))
        if (!res?.contents.length) return null
        return { contents: res.contents.map((value) => ({ value })), range: res.range ? toMonacoRange(res.range) : undefined }
      }
    })

    monaco.languages.registerDefinitionProvider(id, {
      async provideDefinition(model, position) {
        const list = await api.lsp.definition(pathOfModel(model), toApi(position))
        const out: monaco.languages.Location[] = []
        for (const l of list ?? []) {
          const uri = monaco.Uri.file(l.path)
          // Monaco ha bisogno del modello anche per un file non ancora aperto.
          if (!monaco.editor.getModel(uri)) {
            try {
              const file = await api.files.read(uri.fsPath)
              if (!monaco.editor.getModel(uri)) monaco.editor.createModel(file.text, undefined, uri)
            } catch {
              continue
            }
          }
          out.push({ uri, range: toMonacoRange(l.range) })
        }
        return out
      }
    })
  }
}

// «Vai alla definizione» in un altro file: si apre (o si attiva) il pannello editor di quel file.
monaco.editor.registerEditorOpener({
  openCodeEditor(_source, resource, selectionOrPosition) {
    if (resource.scheme !== 'file') return false
    const pos =
      selectionOrPosition && 'startLineNumber' in selectionOrPosition
        ? { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn }
        : selectionOrPosition
          ? { line: selectionOrPosition.lineNumber, column: selectionOrPosition.column }
          : undefined
    openFile(resource.fsPath, pos, workspaces.get(normPath(resource.fsPath)))
    return true
  }
})

/** Diagnostica di un file → marcatori sul suo modello (se aperto). */
export function applyDiagnostics(d: MergedDiagnostics): void {
  const model = monaco.editor.getModel(monaco.Uri.file(d.path))
  if (!model) return
  monaco.editor.setModelMarkers(
    model,
    'lsp',
    d.diagnostics.map((x) => ({
      severity: [0, monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint][x.severity],
      message: x.message,
      source: x.source,
      code: x.code !== undefined ? String(x.code) : undefined,
      startLineNumber: x.range.startLine,
      startColumn: x.range.startColumn,
      endLineNumber: x.range.endLine,
      endColumn: Math.max(x.range.endColumn, x.range.startColumn + 1)
    }))
  )
}


// ---- conversioni (CCT Plugin API e Monaco contano righe e colonne da 1) ----

const toApi = (p: monaco.Position): ApiPosition => ({ line: p.lineNumber, column: p.column })
const toMonacoRange = (r: ApiRange) => new monaco.Range(r.start.line, r.start.column, r.end.line, r.end.column)

/** Tipi di completamento della Plugin API → tipi di Monaco (stessi nomi). */
function completionKind(kind: ApiCompletionKind): monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind as unknown as Record<string, monaco.languages.CompletionItemKind>
  const name = kind.charAt(0).toUpperCase() + kind.slice(1)
  return K[name] ?? monaco.languages.CompletionItemKind.Text
}
