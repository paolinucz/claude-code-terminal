/**
 * Ponte tra Monaco e i language server (F2): completamento, descrizioni al passaggio del mouse,
 * «vai alla definizione» e diagnostica come marcatori. Si carica solo con l'editor (Monaco è pesante).
 */
import { lspLanguageOf, normPath, type FileDiagnostics, type LspLanguage } from '@shared/files'
import { api } from '@/lib/api'
import { monaco } from '@/lib/monaco'
import { openFile } from '@/state/editor'

const MONACO_LANGUAGES: Record<LspLanguage, string[]> = {
  java: ['java'],
  typescript: ['typescript', 'javascript'],
  python: ['python'],
  yaml: ['yaml']
}

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

const registered = new Set<LspLanguage>()

/** Registra i provider di Monaco per un linguaggio (una volta sola). */
export function ensureProviders(language: LspLanguage): void {
  if (registered.has(language)) return
  registered.add(language)
  for (const id of MONACO_LANGUAGES[language]) {
    monaco.languages.registerCompletionItemProvider(id, {
      triggerCharacters: ['.', ':', '<', '"', "'", '/', '@', '('],
      async provideCompletionItems(model, position) {
        const path = pathOfModel(model)
        const res = (await api.lsp.request(language, path, 'textDocument/completion', { position: toLsp(position) }, workspaces.get(normPath(path)))) as
          | LspCompletionItem[]
          | { items: LspCompletionItem[]; isIncomplete?: boolean }
          | null
        const items = Array.isArray(res) ? res : (res?.items ?? [])
        const word = model.getWordUntilPosition(position)
        const fallback = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        return {
          incomplete: !Array.isArray(res) && Boolean(res?.isIncomplete),
          suggestions: items.slice(0, 500).map((it) => {
            const edit = it.textEdit && 'range' in it.textEdit ? it.textEdit : it.textEdit && 'insert' in it.textEdit ? { newText: it.textEdit.newText, range: it.textEdit.insert } : null
            return {
              label: typeof it.label === 'string' ? it.label : it.label.label,
              kind: completionKind(it.kind),
              detail: it.detail,
              documentation: docOf(it.documentation),
              insertText: edit?.newText ?? it.insertText ?? (typeof it.label === 'string' ? it.label : it.label.label),
              insertTextRules: it.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              range: edit ? toMonacoRange(edit.range) : fallback,
              sortText: it.sortText,
              filterText: it.filterText
            }
          })
        }
      }
    })

    monaco.languages.registerHoverProvider(id, {
      async provideHover(model, position) {
        const path = pathOfModel(model)
        const res = (await api.lsp.request(language, path, 'textDocument/hover', { position: toLsp(position) }, workspaces.get(normPath(path)))) as LspHover | null
        if (!res?.contents) return null
        const parts = Array.isArray(res.contents) ? res.contents : [res.contents]
        const contents = parts
          .map((c) => (typeof c === 'string' ? c : 'kind' in c ? c.value : '```' + c.language + '\n' + c.value + '\n```'))
          .filter(Boolean)
          .map((value) => ({ value }))
        return { contents, range: res.range ? toMonacoRange(res.range) : undefined }
      }
    })

    monaco.languages.registerDefinitionProvider(id, {
      async provideDefinition(model, position) {
        const path = pathOfModel(model)
        const ws = workspaces.get(normPath(path))
        const res = (await api.lsp.request(language, path, 'textDocument/definition', { position: toLsp(position) }, ws)) as LspLocation | LspLocation[] | LspLocationLink[] | null
        if (!res) return null
        const list = (Array.isArray(res) ? res : [res]).map((l) =>
          'targetUri' in l ? { uri: l.targetUri, range: l.targetSelectionRange ?? l.targetRange } : { uri: l.uri, range: l.range }
        )
        const out: monaco.languages.Location[] = []
        for (const l of list) {
          if (!l.uri.startsWith('file:')) continue
          const uri = monaco.Uri.parse(l.uri)
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
export function applyDiagnostics(d: FileDiagnostics): void {
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

export { lspLanguageOf }

// ---- conversioni ----

interface LspRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}
interface LspCompletionItem {
  label: string | { label: string }
  kind?: number
  detail?: string
  documentation?: string | { kind: string; value: string }
  insertText?: string
  insertTextFormat?: number
  textEdit?: { newText: string; range: LspRange } | { newText: string; insert: LspRange; replace: LspRange }
  sortText?: string
  filterText?: string
}
interface LspHover {
  contents: string | { kind: string; value: string } | { language: string; value: string } | (string | { language: string; value: string })[]
  range?: LspRange
}
interface LspLocation {
  uri: string
  range: LspRange
}
interface LspLocationLink {
  targetUri: string
  targetRange: LspRange
  targetSelectionRange?: LspRange
}

const toLsp = (p: monaco.Position) => ({ line: p.lineNumber - 1, character: p.column - 1 })
const toMonacoRange = (r: LspRange) => new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1)
const docOf = (d: LspCompletionItem['documentation']) => (d === undefined ? undefined : typeof d === 'string' ? d : { value: d.value })

/** Tipi di completamento LSP (1–25) → tipi di Monaco. */
function completionKind(kind?: number): monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind
  const map: Record<number, monaco.languages.CompletionItemKind> = {
    1: K.Text, 2: K.Method, 3: K.Function, 4: K.Constructor, 5: K.Field, 6: K.Variable, 7: K.Class, 8: K.Interface,
    9: K.Module, 10: K.Property, 11: K.Unit, 12: K.Value, 13: K.Enum, 14: K.Keyword, 15: K.Snippet, 16: K.Color,
    17: K.File, 18: K.Reference, 19: K.Folder, 20: K.EnumMember, 21: K.Constant, 22: K.Struct, 23: K.Event,
    24: K.Operator, 25: K.TypeParameter
  }
  return map[kind ?? 1] ?? K.Text
}
