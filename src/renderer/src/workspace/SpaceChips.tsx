import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { SPACE_COLORS } from '@shared/spaces'
import type { Space } from '@shared/types'
import { api } from '@/lib/api'
import { STATUS_LABELS } from '@/state/sessions'
import { BADGE_LABELS, badgeOf, sessionsOfSpace, useSpaceSessions, type SpaceBadge } from '@/state/spaceStatus'
import { useSessions } from '@/state/sessions'
import { cleanIcon, spacesOf, useWorkspace } from '@/state/workspace'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui-kit'
import { dockRegistry } from './registry'
import { draggedTerminal, moveTerminalToSpace, stripSessions } from './panels'

/** Oltre questo numero di spazi i chip inattivi si compattano mostrando solo l'icona. */
const COMPACT_ABOVE = 6

/** Badge di stato di uno spazio: lo stato è anche nel testo (`aria-label`), non solo nel colore. */
export function SpaceBadgeDot({ badge, className = '' }: { badge: SpaceBadge; className?: string }) {
  if (!badge) return null
  return <span role="img" aria-label={BADGE_LABELS[badge]} className={`mg-badge mg-badge-${badge} ${className}`} />
}

/** Icona quadrata di uno spazio, nel suo colore. */
export function SpaceIcon({ space, size = 20 }: { space: Pick<Space, 'icon' | 'color'>; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-[6px] text-[11px] leading-none font-bold text-black/80 select-none"
      style={{ width: size, height: size, background: space.color }}
    >
      {space.icon}
    </span>
  )
}

/** Barra degli spazi (nella barra in alto): chip, pulsante «nuovo» e, se mancano spazio o larghezza, l'elenco completo. */
export function SpaceChips() {
  const all = useWorkspace((s) => s.spaces)
  const contextId = useWorkspace((s) => s.contextId)
  const activeId = useWorkspace((s) => s.activeSpaceId)
  const setActive = useWorkspace((s) => s.setActive)
  const addSpace = useWorkspace((s) => s.addSpace)
  const moveSpace = useWorkspace((s) => s.moveSpace)
  const spaces = useMemo(() => spacesOf(all, contextId), [all, contextId])
  const external = useWorkspace((s) => s.externalSpaces)
  const sessions = useSessions((s) => s.sessions)

  const [editing, setEditing] = useState<string | null>(null)
  const [styling, setStyling] = useState<Space | null>(null)
  const [closing, setClosing] = useState<{ space: Space; active: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [dropSpace, setDropSpace] = useState<string | null>(null)

  // Compattazione: più di 6 spazi, oppure i chip non entrano. Si ricorda la larghezza che serviva per tornare estesi.
  const wrapRef = useRef<HTMLDivElement>(null)
  const needed = useRef(0)
  const [squeezed, setSqueezed] = useState(false)
  const sig = spaces.map((s) => s.name + s.icon).join('|')
  useEffect(() => {
    needed.current = 0
    setSqueezed(false)
  }, [sig])
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const check = () => {
      if (!squeezed && el.scrollWidth > el.clientWidth + 1) {
        needed.current = el.scrollWidth
        setSqueezed(true)
      } else if (squeezed && needed.current && el.clientWidth >= needed.current) setSqueezed(false)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [squeezed, sig])
  const compact = spaces.length > COMPACT_ABOVE || squeezed

  const activeSessionsOf = (space: Space) => sessionsOfSpace(space.id, sessions).filter((s) => s.status !== 'exited').length
  const requestClose = (space: Space) => {
    if (spaces.length <= 1) return
    const active = activeSessionsOf(space)
    if (active > 0) setClosing({ space, active })
    else useWorkspace.getState().closeSpace(space.id)
  }
  const duplicate = (space: Space) => {
    const dock = dockRegistry.get(space.id)
    const layout = dock ? stripSessions(dock.toJSON() as unknown as Record<string, unknown>) : null
    useWorkspace.getState().duplicateSpace(space.id, layout)
  }
  // Una sessione trascinata da un pannello e lasciata su un chip passa in quello spazio senza riavviarsi.
  const dropSession = (space: Space): boolean => {
    const dragged = draggedTerminal()
    if (!dragged || dragged.spaceId === space.id) return false
    if (moveTerminalToSpace(dragged.spaceId, dragged.panelId, space.id)) {
      useWorkspace.getState().setStatus(`«${dragged.title}» spostata in ${space.name} — la sessione continua`)
    }
    return true
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div ref={wrapRef} role="tablist" aria-label="Spazi" className="app-no-drag flex min-w-0 items-center gap-1 overflow-hidden" onDragLeave={() => setDropIndex(null)}>
        {spaces.map((space, index) => (
          <SpaceChip
            key={space.id}
            space={space}
            active={space.id === activeId}
            compact={compact && space.id !== activeId}
            editing={editing === space.id}
            external={external.includes(space.id)}
            dragging={dragId === space.id}
            sessionDrop={dropSpace === space.id}
            insertBefore={dropIndex === index}
            insertAfter={dropIndex === index + 1 && index === spaces.length - 1}
            canClose={spaces.length > 1}
            onSelect={() => setActive(space.id)}
            onRename={() => setEditing(space.id)}
            onRenameDone={(name) => {
              if (name !== null) useWorkspace.getState().renameSpace(space.id, name)
              setEditing(null)
            }}
            onStyle={() => setStyling(space)}
            onDuplicate={() => duplicate(space)}
            onNewWindow={() => void api.windows.openSpace(space.id)}
            onClose={() => requestClose(space)}
            onDragStart={(e) => {
              setDragId(space.id)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/x-cct-space', space.id)
            }}
            onDragOver={(e) => {
              if (!dragId) {
                const dragged = draggedTerminal()
                if (dragged && dragged.spaceId !== space.id) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDropSpace(space.id)
                }
                return
              }
              e.preventDefault()
              const rect = e.currentTarget.getBoundingClientRect()
              setDropIndex(e.clientX < rect.left + rect.width / 2 ? index : index + 1)
            }}
            onDragLeave={() => setDropSpace((s) => (s === space.id ? null : s))}
            onDrop={(e) => {
              e.preventDefault()
              setDropSpace(null)
              if (!dragId && dropSession(space)) return
              if (dragId && dropIndex !== null) {
                const from = spaces.findIndex((s) => s.id === dragId)
                moveSpace(dragId, dropIndex > from ? dropIndex - 1 : dropIndex)
              }
              setDragId(null)
              setDropIndex(null)
            }}
            onDragEnd={() => {
              setDragId(null)
              setDropIndex(null)
            }}
          />
        ))}
      </div>

      {compact && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Tutti gli spazi" title="Tutti gli spazi" className="app-no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-white/10 hover:text-foreground">
              <ChevronDown size={15} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {spaces.map((space) => (
              <OverflowItem key={space.id} space={space} active={space.id === activeId} onSelect={() => setActive(space.id)} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <button
        type="button"
        aria-label="Nuovo spazio"
        title="Nuovo spazio"
        onClick={() => {
          const id = addSpace()
          setEditing(id)
        }}
        className="app-no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-white/10 hover:text-foreground"
      >
        <Plus size={16} />
      </button>

      <SpaceStyleDialog space={styling && (all.find((s) => s.id === styling.id) ?? styling)} onClose={() => setStyling(null)} />

      <ConfirmDialog
        open={closing !== null}
        title={`Chiudere lo spazio «${closing?.space.name ?? ''}»?`}
        description={`Lo spazio e la sua disposizione vengono eliminati. Le ${closing?.active ?? 0} sessioni attive non si interrompono: restano disponibili in «Collega a sessione attiva».`}
        confirmLabel="Chiudi spazio"
        destructive
        onCancel={() => setClosing(null)}
        onConfirm={() => {
          if (closing) useWorkspace.getState().closeSpace(closing.space.id)
          setClosing(null)
        }}
      />
    </TooltipProvider>
  )
}

function OverflowItem({ space, active, onSelect }: { space: Space; active: boolean; onSelect(): void }) {
  const badge = badgeOf(useSpaceSessions(space.id))
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <SpaceIcon space={space} size={18} />
      <span className="min-w-0 flex-1 truncate">{space.name}</span>
      <SpaceBadgeDot badge={badge} />
      {active && <Check size={14} className="text-text-faint" />}
    </DropdownMenuItem>
  )
}

interface ChipProps {
  space: Space
  active: boolean
  compact: boolean
  editing: boolean
  /** Lo spazio è aperto in un'altra finestra. */
  external: boolean
  dragging: boolean
  sessionDrop: boolean
  insertBefore: boolean
  insertAfter: boolean
  canClose: boolean
  onSelect(): void
  onRename(): void
  onRenameDone(name: string | null): void
  onStyle(): void
  onDuplicate(): void
  onNewWindow(): void
  onClose(): void
  onDragStart(e: DragEvent): void
  onDragOver(e: DragEvent): void
  onDragLeave(): void
  onDrop(e: DragEvent): void
  onDragEnd(): void
}

/** Un chip: stile diverso dalle schede dei pannelli (quelle hanno la sottolineatura), badge di stato, suggerimento e menu. */
function SpaceChip(p: ChipProps) {
  const { space, active } = p
  const list = useSpaceSessions(space.id)
  const badge = badgeOf(list)
  const live = list.filter((s) => s.status !== 'exited')

  return (
    <ContextMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild>
            <div
              role="tab"
              aria-selected={active}
              aria-label={`${space.name}${badge ? `: ${BADGE_LABELS[badge]}` : ''}`}
              tabIndex={active ? 0 : -1}
              draggable={!p.editing}
              onClick={(e) => {
                if (p.editing) return
                if (!active) p.onSelect()
                else {
                  // Clic sullo spazio già attivo: apre lo stesso menu del tasto destro.
                  e.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }))
                }
              }}
              onDoubleClick={p.onRename}
              onKeyDown={(e) => {
                if (p.editing) return
                if (e.key === 'F2') {
                  e.preventDefault()
                  p.onRename()
                }
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  p.onSelect()
                }
              }}
              onDragStart={p.onDragStart}
              onDragOver={p.onDragOver}
              onDragLeave={p.onDragLeave}
              onDrop={p.onDrop}
              onDragEnd={p.onDragEnd}
              className={[
                'relative inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-lg border pr-2.5 pl-1.5 text-[13px] transition-colors',
                active ? 'border-(--mg-chip-active-border) bg-(--mg-chip-active-bg) font-semibold text-foreground' : 'border-transparent bg-transparent font-medium text-text-muted hover:bg-white/5 hover:text-foreground',
                p.compact ? 'pr-1.5' : '',
                p.external ? 'border-dashed border-white/25' : '',
                p.dragging ? 'opacity-50' : '',
                p.sessionDrop ? 'outline-2 outline-brand' : '',
                p.insertBefore ? 'shadow-[inset_2px_0_0_var(--cct-accent)]' : '',
                p.insertAfter ? 'shadow-[inset_-2px_0_0_var(--cct-accent)]' : ''
              ].join(' ')}
            >
              <SpaceIcon space={space} />
              {p.editing ? (
                <RenameInput initial={space.name} onDone={p.onRenameDone} />
              ) : (
                !p.compact && <span className="max-w-40 truncate">{space.name}</span>
              )}
              <SpaceBadgeDot badge={badge} />
            </div>
          </ContextMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <p className="font-semibold">{space.name}</p>
          {p.external && <p className="mt-0.5 text-text-subtle">Aperto in un'altra finestra</p>}
          <p className="mt-0.5 text-text-subtle">{live.length === 0 ? 'Nessuna sessione attiva' : live.length === 1 ? '1 sessione' : `${live.length} sessioni`}</p>
          {live.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {live.map((s) => (
                <li key={s.id} className="flex items-center gap-1.5">
                  <SpaceBadgeDot badge={s.status === 'waiting' ? 'waiting' : s.status === 'working' ? 'working' : null} />
                  <span className="max-w-44 truncate">{s.title}</span>
                  <span className="text-text-faint">· {STATUS_LABELS[s.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </TooltipContent>
      </Tooltip>
      <ContextMenuContent>
        <SpaceMenuItem onSelect={p.onRename} hint="F2">
          Rinomina
        </SpaceMenuItem>
        <SpaceMenuItem onSelect={p.onStyle}>Scegli icona e colore…</SpaceMenuItem>
        <SpaceMenuItem onSelect={p.onDuplicate}>Duplica layout</SpaceMenuItem>
        <SpaceMenuItem onSelect={p.onNewWindow}>{p.external ? 'Vai alla sua finestra' : 'Apri in una nuova finestra'}</SpaceMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!p.canClose} onSelect={p.onClose} className="text-danger data-[highlighted]:bg-danger/15">
          Chiudi spazio
          {live.length > 0 && <span className="ml-auto pl-4 text-[11px] opacity-80">{live.length} {live.length === 1 ? 'sessione' : 'sessioni'}</span>}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function SpaceMenuItem({ children, onSelect, hint }: { children: ReactNode; onSelect(): void; hint?: string }) {
  return (
    <ContextMenuItem onSelect={onSelect}>
      {children}
      {hint && <span className="ml-auto pl-6 font-mono text-[10px] text-text-faint">{hint}</span>}
    </ContextMenuItem>
  )
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      aria-label="Nome dello spazio"
      value={value}
      maxLength={40}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onDone(value)
        if (e.key === 'Escape') onDone(null)
      }}
      className="w-28 rounded border border-brand bg-background px-1.5 py-0.5 text-[13px] font-normal text-foreground outline-none"
    />
  )
}

const QUICK_ICONS = ['◆', '●', '▲', '★', '⚡', '☰', '</>', '⌘']

/** Icona e colore di uno spazio: i 6 colori della palette e una lettera o un simbolo. */
function SpaceStyleDialog({ space, onClose }: { space: Space | null; onClose(): void }) {
  const [icon, setIcon] = useState('')
  useEffect(() => {
    if (space) setIcon(space.icon)
  }, [space?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!space) return <Dialog open={false} />
  const style = useWorkspace.getState().styleSpace
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Icona e colore</DialogTitle>
          <DialogDescription>Per «{space.name}». Il colore viene dalla palette dell'app.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex items-center gap-3">
          <SpaceIcon space={{ ...space, icon: cleanIcon(icon, space.name) }} size={36} />
          <label className="flex items-center gap-2 text-[13px] text-text-muted">
            Lettera o simbolo
            <input
              value={icon}
              maxLength={4}
              onChange={(e) => {
                setIcon(e.target.value)
                style(space.id, { icon: e.target.value })
              }}
              className="h-8 w-14 rounded-md border border-input bg-background px-2 text-center text-[14px] text-foreground outline-none focus-visible:border-brand"
              aria-label="Lettera o simbolo"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Simboli suggeriti">
          {QUICK_ICONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                setIcon(q)
                style(space.id, { icon: q })
              }}
              className="inline-flex size-8 items-center justify-center rounded-md border border-border text-[13px] text-text-muted hover:bg-border hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="mt-4 flex gap-2" role="radiogroup" aria-label="Colore dello spazio">
          {SPACE_COLORS.map((c, i) => {
            const on = c.toLowerCase() === space.color.toLowerCase()
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={`Colore ${i + 1}`}
                onClick={() => style(space.id, { color: c })}
                style={{ background: c }}
                className="inline-flex size-8 items-center justify-center rounded-lg border-2 border-transparent text-black/70 outline-offset-2 hover:scale-105 focus-visible:outline-2 aria-checked:border-foreground"
              >
                {on && <Check size={15} />}
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
