import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { Sheet } from '@shared/types'
import { sheetsOf, useWorkspace } from '@/state/workspace'
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
import { SHEET_COLORS, sheetColor, useSheetColors } from '@/state/sheetColors'
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
  const { sheets: allSheets, contextId, activeSheetId, status, setActive, addSheet, renameSheet, closeSheet, moveSheet } = useWorkspace()
  // Le schede sono quelle del contesto attivo; gli altri fogli restano montati in background.
  const sheets = useMemo(() => sheetsOf(allSheets, contextId), [allSheets, contextId])
  const [editing, setEditing] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [closing, setClosing] = useState<Sheet | null>(null)
  const [panelDropSheet, setPanelDropSheet] = useState<string | null>(null)
  const setStatus = useWorkspace((s) => s.setStatus)
  const colors = useSheetColors((s) => s.colors)
  const colorsLoaded = useSheetColors((s) => s.loaded)
  // Ogni foglio ha il suo colore: ai nuovi se ne assegna uno libero e lo si ricorda.
  useEffect(() => {
    void useSheetColors.getState().load()
  }, [])
  useEffect(() => {
    if (colorsLoaded) useSheetColors.getState().ensure(allSheets.map((x) => x.id))
  }, [colorsLoaded, allSheets])

  const panelCounts = useWorkspace((s) => s.panelCounts)
  const requestClose = (sheet: Sheet) => {
    if (sheets.length <= 1) return
    const panels = panelCounts[sheet.id] ?? 0
    if (panels > 0) setClosing(sheet)
    else closeSheet(sheet.id)
  }

  return (
    // Barra dei fogli: una pillola centrata, larga quanto serve, che segue il linguaggio della sidebar (tessere morbide, un colore per foglio).
    <footer className="relative flex shrink-0 justify-center px-(--cct-gap) pb-(--cct-gap)" aria-label="Fogli">
      <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-[20px] border border-white/10 bg-surface/80 p-1.5 shadow-[0_10px_28px_-10px_rgb(0_0_0/0.7),inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-xl">
      <div role="tablist" aria-label="Fogli" className="flex items-center gap-1" onDragLeave={() => setDropIndex(null)}>
        {sheets.map((sheet, index) => {
          const isActive = sheet.id === activeSheetId
          const color = sheetColor(sheet.id, colors)
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
                  style={
                    isActive
                      ? {
                          backgroundColor: color,
                          backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${color} 74%, white), ${color} 60%, color-mix(in srgb, ${color} 88%, black))`
                        }
                      : undefined
                  }
                  className={[
                    'group relative flex h-9 cursor-pointer items-center gap-2 rounded-[13px] px-3.5 text-[13px] transition-[background,color,box-shadow,transform] duration-150',
                    isActive
                      ? 'font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_1px_2px_rgb(0_0_0/0.45),0_6px_12px_-6px_rgb(0_0_0/0.6)]'
                      : 'font-medium text-text-muted hover:bg-surface-2 hover:text-foreground',
                    dragId === sheet.id ? 'opacity-50' : '',
                    panelDropSheet === sheet.id ? 'bg-brand/15 text-foreground outline outline-1 outline-brand' : '',
                    dropIndex === index ? 'shadow-[inset_2px_0_0_var(--cct-accent)]' : '',
                    dropIndex === index + 1 && index === sheets.length - 1 ? 'shadow-[inset_-2px_0_0_var(--cct-accent)]' : ''
                  ].join(' ')}
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={isActive ? { background: 'rgb(255 255 255 / 0.9)' } : { background: color, boxShadow: `0 0 8px color-mix(in srgb, ${color} 55%, transparent)` }}
                  />
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
                      className="-mr-1.5 inline-flex size-5 items-center justify-center rounded-md opacity-0 transition hover:bg-black/20 group-hover:opacity-100 focus-visible:opacity-100"
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
                <div className="px-2 pt-1 pb-1.5" role="group" aria-label="Colore del foglio">
                  <p className="mb-1.5 text-[11px] font-medium text-text-faint">Colore</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SHEET_COLORS.map((c, i) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Colore ${i + 1}`}
                        aria-pressed={c === color}
                        onClick={() => useSheetColors.getState().set(sheet.id, i)}
                        style={{ background: c }}
                        className={`size-5 rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.4)] transition-transform hover:scale-110 ${c === color ? 'ring-2 ring-white/70 ring-offset-1 ring-offset-surface' : ''}`}
                      />
                    ))}
                  </div>
                </div>
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
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-[13px] text-text-subtle transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <Plus size={16} />
      </button>
      </div>

      {/* Messaggi di stato (layout salvato, ecc.): a destra, fuori dalla pillola. */}
      <span className="pointer-events-none absolute top-0 right-(--cct-gap) bottom-(--cct-gap) hidden max-w-[28%] items-center truncate text-[12px] text-text-faint lg:flex" aria-live="polite">
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
  return <span className="font-mono text-[11px] font-normal opacity-60">{count}</span>
}
