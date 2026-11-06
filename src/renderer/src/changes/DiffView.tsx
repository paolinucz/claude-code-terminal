import { DiffEditor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { languageOf } from '@/lib/monaco'
import { TERMINAL_FONT_FAMILY, useTerminalSettings } from '@/state/terminalSettings'

/** Righe selezionate nella versione «dopo», per ancorare una nota (F8). */
export interface LineSelection {
  start: number
  end: number
  excerpt: string
}

/** Diff affiancato prima ↔ dopo (F6), con Monaco. Caricato con React.lazy perché Monaco è pesante. */
export default function DiffView({
  filePath,
  before,
  after,
  onSelection
}: {
  filePath: string
  before: string
  after: string
  /** Righe selezionate nel lato «dopo» (null se non c'è selezione). */
  onSelection?(sel: LineSelection | null): void
}) {
  const fontSize = useTerminalSettings((s) => s.fontSize)

  const onMount = (diff: editor.IStandaloneDiffEditor) => {
    const modified = diff.getModifiedEditor()
    modified.onDidChangeCursorSelection((e) => {
      const s = e.selection
      const model = modified.getModel()
      if (!model || s.isEmpty()) {
        onSelection?.(null)
        return
      }
      // Se la selezione finisce all'inizio di una riga, quella riga non conta.
      const end = s.endColumn === 1 && s.endLineNumber > s.startLineNumber ? s.endLineNumber - 1 : s.endLineNumber
      const excerpt = model.getValueInRange({ startLineNumber: s.startLineNumber, startColumn: 1, endLineNumber: end, endColumn: model.getLineMaxColumn(end) })
      onSelection?.({ start: s.startLineNumber, end, excerpt })
    })
  }

  return (
    <DiffEditor
      original={before}
      modified={after}
      language={languageOf(filePath)}
      theme="cct-dark"
      onMount={onMount}
      loading={<div className="p-4 text-text-faint">Caricamento del diff…</div>}
      options={{
        readOnly: true,
        originalEditable: false,
        renderSideBySide: true,
        // Sotto questa larghezza il diff passa in una sola colonna.
        renderSideBySideInlineBreakpoint: 640,
        useInlineViewWhenSpaceIsLimited: true,
        hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 6, revealLineCount: 10 },
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: Math.max(11, fontSize - 1),
        lineHeight: 1.45,
        renderOverviewRuler: false,
        diffWordWrap: 'on',
        wordWrap: 'on',
        stickyScroll: { enabled: false }
      }}
    />
  )
}
