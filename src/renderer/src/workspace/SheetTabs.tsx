import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { Sheet } from '@shared/types'
import { useWorkspace } from '@/state/workspace'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui-kit'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { getPanelData } from 'dockview-react'
import type { PanelParams } from '@/panels/kinds'
import { ATTENTION_LABELS, useSessions } from '@/state/sessions'
import { moveTerminalToSheet } from './panels'
import { dockRegistry } from './registry'

/** Il pannello che Dockview sta trascinando, se è un terminale con una sessione. */
function draggedTerminal(): { sheetId: string; panelId: string; title: string } | undefined {
  const data = getPanelData()
  if (!data?.panelId) return undefined
  for (const sheet of useWorkspace.getState().sheets) {
    const panel = dockRegistry.get(sheet.id)?.getPanel(data.panelId)
    const params = panel?.params as PanelParams | undefined
    if (panel && params?.kind === 'terminal' && params.sessionId) {
      return { sheetId: sheet.id, panelId: panel.id, title: panel.title ?? 'Terminale' }
    }
  }
  return undefined
}

/** Schede dei fogli in basso, come in Excel (L1): crea, rinomina, riordina, chiudi. */
export function SheetTabs() {
  const { sheets, activeSheetId, status, setActive, addSheet, renameSheet, closeSheet, moveSheet } = useWorkspace()
  const [editing, setEditing] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [closing, setClosing] = useState<Sheet | null>(null)
  const [panelDropSheet, setPanelDropSheet] = useState<string | null>(null)
  const setStatus = useWorkspace((s) => s.setStatus)

  const panelCounts = useWorkspace((s) => s.panelCounts)
  const requestClose = (sheet: Sheet) => {
    if (sheets.length <= 1) return
    const panels = panelCounts[sheet.id] ?? 0
    if (panels > 0) setClosing(sheet)
    else closeSheet(sheet.id)
  }

  return (
    <footer className="flex min-h-10 items-stretch gap-0.5 border-t border-border bg-surface px-2" aria-label="Fogli">
      <div role="tablist" aria-label="Fogli" className="flex items-stretch gap-0.5" onDragLeave={() => setDropIndex(null)}>
        {sheets.map((sheet, index) => {
          const isActive = sheet.id === activeSheetId
          return (
            <ContextMenu key={sheet.id}>
              <ContextMenuTrigger asChild>
                <div
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  draggable={editing !== sheet.id}
                  onClick={() => setActive(sheet.id)}
                  onDoubleClick={() => setEditing(sheet.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'F2') setEditing(sheet.id)
                    if (e.key === 'ArrowRight') setActive(sheets[(index + 1) % sheets.length].id)
                    if (e.key === 'ArrowLeft') setActive(sheets[(index - 1 + sheets.length) % sheets.length].id)
                  }}
                  onDragStart={(e) => {
                    setDragId(sheet.id)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/x-cct-sheet', sheet.id)
                  }}
                  onDragOver={(e) => {
                    if (!dragId) {
                      // S5: un terminale trascinato da un pannello si può lasciare su un altro foglio.
                      const dragged = draggedTerminal()
                      if (dragged && dragged.sheetId !== sheet.id) {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        setPanelDropSheet(sheet.id)
                      }
                      return
                    }
                    e.preventDefault()
                    const rect = e.currentTarget.getBoundingClientRect()
                    setDropIndex(e.clientX < rect.left + rect.width / 2 ? index : index + 1)
                  }}
                  onDragLeave={() => setPanelDropSheet((s) => (s === sheet.id ? null : s))}
                  onDrop={(e) => {
                    e.preventDefault()
                    const dragged = !dragId ? draggedTerminal() : undefined
                    setPanelDropSheet(null)
                    if (dragged && dragged.sheetId !== sheet.id) {
                      if (moveTerminalToSheet(dragged.sheetId, dragged.panelId, sheet.id)) {
                        setStatus(`«${dragged.title}» spostata in ${sheet.name} — la sessione continua`)
                      }
                      return
                    }
                    if (dragId && dropIndex !== null) {
                      const from = sheets.findIndex((s) => s.id === dragId)
                      moveSheet(dragId, dropIndex > from ? dropIndex - 1 : dropIndex)
                    }
                    setDragId(null)
                    setDropIndex(null)
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setDropIndex(null)
                  }}
                  className={[
                    'group relative flex min-h-10 cursor-pointer items-center gap-2 px-4 text-[13px] transition-colors',
                    isActive
                      ? 'bg-background font-semibold text-foreground shadow-[inset_0_-2px_0_var(--cct-accent)]'
                      : 'font-medium text-text-muted hover:bg-surface-2 hover:text-foreground',
                    dragId === sheet.id ? 'opacity-50' : '',
                    panelDropSheet === sheet.id ? 'bg-brand/15 text-foreground outline outline-1 outline-brand' : '',
                    dropIndex === index ? 'shadow-[inset_2px_0_0_var(--cct-accent)]' : '',
                    dropIndex === index + 1 && index === sheets.length - 1 ? 'shadow-[inset_-2px_0_0_var(--cct-accent)]' : ''
                  ].join(' ')}
                >
                  {editing === sheet.id ? (
                    <RenameInput
                      initial={sheet.name}
                      onDone={(name) => {
                        if (name !== null) renameSheet(sheet.id, name)
                        setEditing(null)
                      }}
                    />
                  ) : (
                    <span>{sheet.name}</span>
                  )}
                  <PanelCount sheetId={sheet.id} />
                  <SheetAttention sheetId={sheet.id} />
                  {sheets.length > 1 && editing !== sheet.id && (
                    <button
                      type="button"
                      aria-label={`Chiudi il foglio ${sheet.name}`}
                      title="Chiudi il foglio"
                      onClick={(e) => {
                        e.stopPropagation()
                        requestClose(sheet)
                      }}
                      className="-mr-2 inline-flex size-5 items-center justify-center rounded text-text-faint opacity-0 transition hover:bg-border hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => setEditing(sheet.id)}>Rinomina</ContextMenuItem>
                <ContextMenuItem disabled={index === 0} onSelect={() => moveSheet(sheet.id, index - 1)}>
                  Sposta a sinistra
                </ContextMenuItem>
                <ContextMenuItem disabled={index === sheets.length - 1} onSelect={() => moveSheet(sheet.id, index + 1)}>
                  Sposta a destra
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem disabled={sheets.length <= 1} onSelect={() => requestClose(sheet)}>
                  Chiudi foglio
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>

      <button
        type="button"
        aria-label="Nuovo foglio"
        title="Nuovo foglio"
        onClick={() => {
          const id = addSheet()
          setEditing(id)
        }}
        className="my-auto ml-1 inline-flex size-7 items-center justify-center rounded-md text-text-subtle transition-colors hover:bg-border hover:text-foreground"
      >
        <Plus size={15} />
      </button>

      <span className="my-auto ml-auto truncate pl-4 text-[12px] text-text-faint" aria-live="polite">
        {status}
      </span>

      <ConfirmDialog
        open={closing !== null}
        title={`Chiudere il foglio «${closing?.name ?? ''}»?`}
        description="Il foglio e la sua disposizione vengono eliminati. Le sessioni non vengono interrotte: dalla fase 2 restano disponibili in «Collega» e «Riprendi»."
        confirmLabel="Chiudi foglio"
        destructive
        onCancel={() => setClosing(null)}
        onConfirm={() => {
          if (closing) closeSheet(closing.id)
          setClosing(null)
        }}
      />
    </footer>
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
      aria-label="Nome del foglio"
      value={value}
      maxLength={40}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onDone(value)
        if (e.key === 'Escape') onDone(null)
      }}
      className="w-28 rounded border border-brand bg-background px-1.5 py-0.5 text-[13px] text-foreground outline-none"
    />
  )
}

/** S7: pallino sul foglio se una sua sessione ha finito o chiede qualcosa e non l'hai ancora guardata. */
function SheetAttention({ sheetId }: { sheetId: string }) {
  const attention = useSessions((s) => s.attention)
  // Ricalcola anche quando cambiano i pannelli del foglio.
  useWorkspace((s) => s.panelCounts[sheetId])
  const ids = new Set(Object.keys(attention))
  if (ids.size === 0) return null
  const panels = dockRegistry.get(sheetId)?.panels ?? []
  const hit = panels.map((p) => (p.params as PanelParams | undefined)?.sessionId).find((id) => id && ids.has(id))
  if (!hit) return null
  const kind = attention[hit].kind
  const color = kind === 'finished' ? 'var(--cct-ok)' : kind === 'error' ? 'var(--cct-danger)' : 'var(--cct-info)'
  return <span className="size-2 rounded-full" style={{ background: color }} title={ATTENTION_LABELS[kind]} aria-label={ATTENTION_LABELS[kind]} />
}

/** Numero di pannelli nel foglio (aggiornato da SheetView a ogni cambio di layout). */
function PanelCount({ sheetId }: { sheetId: string }) {
  const count = useWorkspace((s) => s.panelCounts[sheetId])
  if (count === undefined) return null
  return <span className="font-mono text-[11px] font-normal text-text-faint">{count}</span>
}
