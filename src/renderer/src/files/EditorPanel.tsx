import { lazy, Suspense, useEffect, useRef } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { FileCode } from 'lucide-react'
import type { PanelParams } from '@/panels/kinds'

const EditorView = lazy(() => import('./EditorView'))

/** Pannello editor (F2): un file per pannello. Il titolo della scheda mostra ● se ci sono modifiche non salvate. */
export function EditorPanel(props: IDockviewPanelProps<PanelParams>) {
  const { filePath, cwd } = props.params
  const name = filePath?.split(/[\\/]/).pop() ?? 'Editor'
  const titleRef = useRef(name)
  titleRef.current = name

  useEffect(() => {
    if (filePath && props.api.title !== name) props.api.setTitle(name)
  }, [filePath, name, props.api])

  if (!filePath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-surface p-6 text-center text-text-subtle">
        <FileCode size={22} className="text-text-faint" />
        <p>Apri un file dall'Esplora file, dal pannello Problemi o da «vai alla definizione».</p>
      </div>
    )
  }

  return (
    <Suspense fallback={<p className="p-4 text-text-faint">Caricamento dell'editor…</p>}>
      <EditorView
        key={filePath}
        filePath={filePath}
        workspace={cwd}
        onDirty={(dirty) => props.api.setTitle(dirty ? `● ${titleRef.current}` : titleRef.current)}
      />
    </Suspense>
  )
}
