import { useMemo, useState } from 'react'
import { CheckCheck, FilePlus2, FileText, SquareArrowOutUpRight, Undo2 } from 'lucide-react'
import type { IDockviewPanelProps } from 'dockview-react'
import { REVIEW_RUNNING_MESSAGE, type FileChange } from '@shared/changes'
import { contextRoots } from '@shared/project'
import { normPath } from '@shared/files'
import { cn } from '@/lib/cn'
import { Segmented } from '@/components/ui-kit'
import { CHANGE_STATUS_COLORS, CHANGE_STATUS_LABELS, splitPath, useChanges } from '@/state/changes'
import { useProject } from '@/state/project'
import { useWorkspace } from '@/state/workspace'
import { spaceOfPanel } from '@/workspace/panels'
import type { PanelParams } from '@/panels/kinds'
import { RejectDialogs } from './RejectDialogs'
import { ReviewDiff } from './ReviewDiff'
import { revealChange } from './reveal'
import { useReview, type ReviewFilter } from './useReview'

const FILTERS = [
  { id: 'open', label: 'Aperte' },
  { id: 'all', label: 'Tutte' }
] as const satisfies readonly { id: ReviewFilter; label: string }[]

/**
 * Panoramica delle modifiche (F5): i file toccati da Claude, sessione per sessione, con stato e azioni di massa. La revisione
 * vera sta nel cassetto accanto al terminale di ogni sessione (`ReviewDrawer`): da qui ci si arriva con «Apri nella sessione»
 * (o doppio clic). Se la sessione non ha più un pannello aperto, il diff si vede e si decide anche qui, a destra.
 */
export function ChangesPanel(props: IDockviewPanelProps<PanelParams>) {
  const allChanges = useChanges((s) => s.changes)
  const project = useProject((s) => s.active)
  const spaces = useWorkspace((s) => s.spaces)
  const [onlyContext, setOnlyContext] = useState(true)
  const [filter, setFilter] = useState<ReviewFilter>('open')

  // J7: con un progetto aperto, le modifiche si limitano alle cartelle del contesto dello spazio (con scelta di vederle tutte).
  const spaceId = spaceOfPanel(props.containerApi)
  const scopeRoots = useMemo(() => {
    const ctxId = spaces.find((s) => s.id === spaceId)?.contextId
    const ctx = project?.data.contexts.find((c) => c.id === ctxId)
    return project && ctx ? contextRoots(project.root, ctx) : null
  }, [project, spaces, spaceId])
  const changes = useMemo(() => {
    if (!scopeRoots || !onlyContext) return allChanges
    const roots = scopeRoots.map(normPath)
    return allChanges.filter((c) => {
      const p = normPath(c.filePath)
      return roots.some((r) => p === r || p.startsWith(r + '\\'))
    })
  }, [allChanges, scopeRoots, onlyContext])

  const review = useReview({ changes, filter })
  const { visible, toReview, waitingClaude, selectedId, setSelectedId, running, anyPendingRunning, pendingIds, approveIds, startRejectMany } = review

  const groups = useMemo(() => {
    const map = new Map<string, { title: string; items: FileChange[] }>()
    for (const c of visible) {
      const g = map.get(c.sessionId) ?? { title: c.sessionTitle, items: [] }
      g.items.push(c)
      map.set(c.sessionId, g)
    }
    return [...map.entries()]
  }, [visible])

  return (
    <div className="@container h-full">
      <div className="flex h-full flex-col @[720px]:flex-row">
        {/* Elenco dei file (F5) */}
        <aside className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-b border-border @[720px]:max-h-none @[720px]:w-72 @[720px]:border-r @[720px]:border-b-0">
          <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold text-foreground">Modifiche</h2>
              <p className="truncate text-[12px] text-text-subtle">
                {toReview ? `${toReview} da rivedere` : 'Niente da rivedere'}
                {waitingClaude ? ` · ${waitingClaude} attende Claude` : ''}
              </p>
            </div>
            <Segmented label="Filtro" size="sm" value={filter} onChange={setFilter} options={FILTERS} className="w-36" />
          </div>
          {scopeRoots && (
            <label className="flex cursor-pointer items-center gap-2 px-3 pb-2 text-[12px] text-text-subtle">
              <input type="checkbox" checked={onlyContext} onChange={(e) => setOnlyContext(e.target.checked)} />
              Solo le cartelle di questo contesto
            </label>
          )}
          <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2" role="listbox" aria-label="File modificati">
            {groups.length === 0 && (
              <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-text-faint">
                {filter === 'open' ? 'Quando Claude modifica un file in una sessione aperta da qui, la modifica compare in questo elenco.' : 'Nessuna modifica registrata.'}
              </p>
            )}
            {groups.map(([sessionId, g]) => (
              <div key={sessionId} className="mt-1">
                <div className="flex items-center gap-2 px-2 pt-2 pb-1">
                  <span className="truncate text-[11px] font-medium tracking-wide text-text-faint uppercase">{g.title}</span>
                  {g.items.some((c) => c.status === 'pending') && (
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={running.has(sessionId)}
                        title={running.has(sessionId) ? REVIEW_RUNNING_MESSAGE : undefined}
                        onClick={() => void approveIds(g.items.filter((c) => c.status === 'pending').map((c) => c.id), `della sessione «${g.title}»`)}
                        className="text-[11px] text-text-subtle hover:text-foreground disabled:opacity-40"
                      >
                        Approva sessione
                      </button>
                      <button
                        type="button"
                        disabled={running.has(sessionId)}
                        title={running.has(sessionId) ? REVIEW_RUNNING_MESSAGE : undefined}
                        onClick={() => startRejectMany(g.items.filter((c) => c.status === 'pending').map((c) => c.id), `della sessione «${g.title}»`)}
                        className="text-[11px] text-text-subtle hover:text-danger disabled:opacity-40"
                      >
                        Respingi sessione
                      </button>
                    </span>
                  )}
                </div>
                {g.items.map((c) => {
                  const { name, dir } = splitPath(c)
                  return (
                    <div key={c.id} className="group relative">
                      <button
                        type="button"
                        role="option"
                        aria-selected={c.id === selectedId}
                        onClick={() => setSelectedId(c.id)}
                        onDoubleClick={() => revealChange(c)}
                        className={cn('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors', c.id === selectedId ? 'bg-border' : 'hover:bg-surface-2')}
                      >
                        {c.created ? <FilePlus2 size={14} className="mt-0.5 shrink-0 text-ok" /> : <FileText size={14} className="mt-0.5 shrink-0 text-text-faint" />}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="truncate font-mono text-[12px] text-foreground">{name}</span>
                            <span className="ml-auto shrink-0 font-mono text-[11px]">
                              {c.added > 0 && <span className="text-ok">+{c.added}</span>} {c.removed > 0 && <span className="text-danger">−{c.removed}</span>}
                            </span>
                          </span>
                          {dir && <span className="block truncate font-mono text-[11px] text-text-faint">{dir}</span>}
                          <span className="block text-[11px]" style={{ color: CHANGE_STATUS_COLORS[c.status] }}>
                            {c.created && c.status === 'pending' ? 'nuovo file · ' : ''}
                            {c.status === 'pending' && c.requests > 0 ? 'aggiornata da Claude · ' : ''}
                            {CHANGE_STATUS_LABELS[c.status]}
                            {c.requests > 0 ? ` · ${c.requests} ${c.requests === 1 ? 'richiesta' : 'richieste'}` : ''}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Apri ${name} nella revisione della sessione`}
                        title="Apri nella revisione accanto al terminale della sessione (doppio clic)"
                        onClick={() => revealChange(c)}
                        className="absolute top-1.5 right-1.5 hidden size-6 items-center justify-center rounded-md bg-surface-2 text-text-subtle hover:text-foreground group-hover:inline-flex focus-visible:inline-flex"
                      >
                        <SquareArrowOutUpRight size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          {toReview > 1 && (
            <div className="flex gap-2 border-t border-border p-2">
              <button
                type="button"
                disabled={anyPendingRunning}
                title={anyPendingRunning ? REVIEW_RUNNING_MESSAGE : undefined}
                onClick={() => void approveIds(pendingIds, 'tutte quelle visibili')}
                className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-ok/50 text-ok transition-colors hover:bg-ok/10 disabled:opacity-40"
              >
                <CheckCheck size={14} /> Approva tutte ({toReview})
              </button>
              <button
                type="button"
                disabled={anyPendingRunning}
                title={anyPendingRunning ? REVIEW_RUNNING_MESSAGE : undefined}
                onClick={() => startRejectMany(pendingIds, '')}
                className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-danger/50 text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
              >
                <Undo2 size={14} /> Respingi tutte ({toReview})
              </button>
            </div>
          )}
        </aside>

        {/* Diff e richieste di modifiche (F6, F8): stessa colonna del cassetto accanto al terminale */}
        <ReviewDiff review={review} />
      </div>

      <RejectDialogs review={review} />
    </div>
  )
}
