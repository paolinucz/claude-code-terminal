import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Space } from '@shared/types'
import { STATUS_LABELS } from '@/state/sessions'
import { useOverview } from '@/state/overview'
import { badgeOf, panelOfSession, useSpaceSessions } from '@/state/spaceStatus'
import { spacesOf, useWorkspace } from '@/state/workspace'
import { dockRegistry } from './registry'
import { draggedTerminal, moveTerminalToSpace } from './panels'
import { SpaceBadgeDot, SpaceIcon } from './SpaceChips'

const SESSION_MIME = 'text/x-cct-session-panel'

/** Nodo del layout serializzato di Dockview (griglia annidata), nella parte che serve alla miniatura. */
interface GridNode {
  type: 'leaf' | 'branch'
  size?: number
  data: GridNode[] | { views?: string[]; activeView?: string }
}
interface SerializedDock {
  grid?: { root?: GridNode; orientation?: string }
  panels?: Record<string, { title?: string }>
}

/** Panoramica degli spazi: ogni spazio è una card con nome, badge, miniatura del layout e sessioni. Clic = apri, Esc = chiudi. */
export function SpaceOverview() {
  const open = useOverview((s) => s.open)
  const all = useWorkspace((s) => s.spaces)
  const contextId = useWorkspace((s) => s.contextId)
  const activeId = useWorkspace((s) => s.activeSpaceId)
  const spaces = useMemo(() => spacesOf(all, contextId), [all, contextId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        useOverview.getState().hide()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!open) return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Panoramica degli spazi"
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-black/55 p-10 backdrop-blur-[3px]"
      onClick={() => useOverview.getState().hide()}
    >
      <p className="text-[12px] text-text-subtle">Clic su uno spazio per aprirlo · trascina una sessione su un altro spazio per spostarla · Esc per chiudere</p>
      <div className="grid max-h-full w-full max-w-6xl grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 overflow-auto p-1" onClick={(e) => e.stopPropagation()}>
        {spaces.map((space) => (
          <OverviewCard key={space.id} space={space} active={space.id === activeId} />
        ))}
      </div>
    </div>,
    document.body
  )
}

function OverviewCard({ space, active }: { space: Space; active: boolean }) {
  const list = useSpaceSessions(space.id)
  const badge = badgeOf(list)
  const [over, setOver] = useState(false)
  const live = list.filter((s) => s.status !== 'exited')

  const open = () => {
    useWorkspace.getState().setActive(space.id)
    useOverview.getState().hide()
  }
  const accept = (e: DragEvent): boolean => e.dataTransfer.types.includes(SESSION_MIME) || draggedTerminal() !== undefined

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Apri lo spazio ${space.name}`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      onDragOver={(e) => {
        if (!accept(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const raw = e.dataTransfer.getData(SESSION_MIME)
        const dragged = draggedTerminal()
        const [fromSpace, panelId] = raw ? raw.split('|') : dragged ? [dragged.spaceId, dragged.panelId] : []
        if (fromSpace && panelId && fromSpace !== space.id && moveTerminalToSpace(fromSpace, panelId, space.id)) {
          useWorkspace.getState().setStatus(`Sessione spostata in ${space.name} — continua senza riavviarsi`)
        }
      }}
      className={[
        'mg-glass-3 flex cursor-pointer flex-col gap-3 rounded-2xl border p-4 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-brand',
        over ? 'outline-2 outline-brand' : '',
        active ? 'border-(--mg-chip-active-border)' : 'border-transparent hover:border-(--mg-chip-active-border)'
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <SpaceIcon space={space} size={24} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">{space.name}</span>
        <SpaceBadgeDot badge={badge} />
      </div>
      <LayoutThumbnail spaceId={space.id} />
      <ul className="space-y-1 text-[12px]" aria-label={`Sessioni di ${space.name}`}>
        {live.length === 0 && <li className="text-text-faint">Nessuna sessione attiva</li>}
        {live.map((s) => (
          <li
            key={s.id}
            draggable
            onDragStart={(e) => {
              e.stopPropagation()
              const panelId = panelOfSession(space.id, s.id)
              if (!panelId) return
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData(SESSION_MIME, `${space.id}|${panelId}`)
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex cursor-grab items-center gap-2 rounded-md px-1.5 py-1 hover:bg-white/5"
          >
            <SpaceBadgeDot badge={s.status === 'waiting' ? 'waiting' : s.status === 'working' ? 'working' : null} />
            <span className="min-w-0 flex-1 truncate text-text-muted">{s.title}</span>
            <span className="shrink-0 text-text-faint">{STATUS_LABELS[s.status]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Miniatura semplificata della disposizione dei pannelli: scatole annidate nelle stesse proporzioni, con il titolo del pannello attivo. */
function LayoutThumbnail({ spaceId }: { spaceId: string }) {
  const sig = useWorkspace((s) => s.panelSigs[spaceId])
  const count = useWorkspace((s) => s.panelCounts[spaceId])
  const json = useMemo(() => {
    try {
      return dockRegistry.get(spaceId)?.toJSON() as unknown as SerializedDock | undefined
    } catch {
      return undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, sig, count])
  const root = json?.grid?.root
  return (
    <div className="h-28 overflow-hidden rounded-lg border border-white/10 bg-black/30 p-1" aria-hidden="true">
      {root ? <Node node={root} horizontal={json?.grid?.orientation !== 'VERTICAL'} panels={json?.panels ?? {}} /> : null}
    </div>
  )
}

function Node({ node, horizontal, panels }: { node: GridNode; horizontal: boolean; panels: Record<string, { title?: string }> }) {
  if (node.type === 'branch' && Array.isArray(node.data)) {
    return (
      <div className={`flex h-full w-full gap-1 ${horizontal ? 'flex-row' : 'flex-col'}`}>
        {node.data.map((child, i) => (
          <div key={i} style={{ flexGrow: child.size ?? 1, flexBasis: 0 }} className="min-h-0 min-w-0">
            <Node node={child} horizontal={!horizontal} panels={panels} />
          </div>
        ))}
      </div>
    )
  }
  const data = node.data as { views?: string[]; activeView?: string }
  const title = panels[data.activeView ?? data.views?.[0] ?? '']?.title ?? ''
  return (
    <div className="flex h-full w-full items-start rounded-[4px] border border-white/10 bg-white/[0.04] px-1.5 py-1 text-[10px] leading-none text-text-subtle">
      <span className="truncate">{title}</span>
    </div>
  )
}
