import { useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react'
import type { Diagnostic } from '@shared/files'
import { cn } from '@/lib/cn'
import { Segmented } from '@/components/ui-kit'
import { openFile, useEditor } from '@/state/editor'

type Filter = 'all' | 'errors'
const FILTERS = [
  { id: 'all', label: 'Tutti' },
  { id: 'errors', label: 'Solo errori' }
] as const satisfies readonly { id: Filter; label: string }[]

const ICON: Record<Diagnostic['severity'], { icon: typeof AlertCircle; color: string }> = {
  1: { icon: AlertCircle, color: 'var(--cct-danger)' },
  2: { icon: AlertTriangle, color: 'var(--cct-warn)' },
  3: { icon: Info, color: 'var(--cct-info)' },
  4: { icon: Info, color: 'var(--cct-text-faint)' }
}

/** Problemi (F3): errori e avvisi di tutti i language server attivi, raggruppati per file. */
export function ProblemsPanel() {
  const diagnostics = useEditor((s) => s.diagnostics)
  const [filter, setFilter] = useState<Filter>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const files = useMemo(
    () =>
      Object.entries(diagnostics)
        .map(([key, d]) => ({
          key,
          path: d.path,
          items: [...d.diagnostics]
            .filter((x) => (filter === 'errors' ? x.severity === 1 : x.severity <= 2))
            .sort((a, b) => a.severity - b.severity || a.range.startLine - b.range.startLine)
        }))
        .filter((f) => f.items.length)
        .sort((a, b) => (b.items.filter((x) => x.severity === 1).length - a.items.filter((x) => x.severity === 1).length) || a.path.localeCompare(b.path)),
    [diagnostics, filter]
  )
  const errors = Object.values(diagnostics).reduce((n, d) => n + d.diagnostics.filter((x) => x.severity === 1).length, 0)
  const warnings = Object.values(diagnostics).reduce((n, d) => n + d.diagnostics.filter((x) => x.severity === 2).length, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <span className="text-[13px] font-semibold text-foreground">Problemi</span>
        <span className="text-[12px]">
          <span className={errors ? 'text-danger' : 'text-text-subtle'}>
            {errors} {errors === 1 ? 'errore' : 'errori'}
          </span>
          <span className="text-text-faint"> · </span>
          <span className={warnings ? 'text-warn' : 'text-text-subtle'}>
            {warnings} {warnings === 1 ? 'avviso' : 'avvisi'}
          </span>
        </span>
        <Segmented label="Filtro" size="sm" value={filter} onChange={setFilter} options={FILTERS} className="ml-auto w-48" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {files.length === 0 && (
          <p className="px-4 py-6 text-center text-[12px] leading-relaxed text-text-faint">
            Nessun problema. Errori e avvisi compaiono qui quando apri file Java, TypeScript/JavaScript, Python o YAML nell'editor.
          </p>
        )}
        {files.map((f) => {
          const isCollapsed = collapsed.has(f.key)
          const name = f.path.split(/[\\/]/).pop()
          return (
            <div key={f.key}>
              <button
                type="button"
                onClick={() => {
                  const next = new Set(collapsed)
                  if (isCollapsed) next.delete(f.key)
                  else next.add(f.key)
                  setCollapsed(next)
                }}
                className="flex h-6 w-full items-center gap-1 px-2 text-left text-[12px] hover:bg-surface-2"
                title={f.path}
              >
                {isCollapsed ? <ChevronRight size={12} className="text-text-faint" /> : <ChevronDown size={12} className="text-text-faint" />}
                <span className="font-mono text-foreground">{name}</span>
                <span className="min-w-0 truncate font-mono text-[11px] text-text-faint">{f.path.slice(0, -(name?.length ?? 0) - 1)}</span>
                <span className="ml-auto shrink-0 rounded-full bg-border px-1.5 font-mono text-[10px] text-text-muted">{f.items.length}</span>
              </button>
              {!isCollapsed &&
                f.items.map((d, i) => {
                  const { icon: Icon, color } = ICON[d.severity]
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => openFile(f.path, { line: d.range.startLine, column: d.range.startColumn })}
                      className={cn('flex w-full items-start gap-1.5 py-1 pr-2 pl-7 text-left text-[12px] hover:bg-surface-2')}
                    >
                      <Icon size={13} style={{ color }} className="mt-px shrink-0" />
                      <span className="min-w-0 flex-1 text-text-muted">
                        {d.message}
                        {d.source && <span className="text-text-faint"> · {d.source}{d.code !== undefined ? `(${d.code})` : ''}</span>}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-text-faint">
                        {d.range.startLine}:{d.range.startColumn}
                      </span>
                    </button>
                  )
                })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
