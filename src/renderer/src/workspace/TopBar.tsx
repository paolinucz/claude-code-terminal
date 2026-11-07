import { useEffect, useMemo, useState } from 'react'
import type { SerializedDockview } from 'dockview-react'
import { ArrowDownToLine, ChevronDown, LayoutGrid, Plus, Puzzle, Search, ShieldCheck, SquareTerminal } from 'lucide-react'
import { openPluginsPanel } from '@/state/editor'
import type { PanelParams } from '@/panels/kinds'
import { useSessions } from '@/state/sessions'
import { useTerminalSettings } from '@/state/terminalSettings'
import { describeUpdate, useUpdates } from '@/state/updates'
import type { NamedLayout } from '@shared/types'
import { api } from '@/lib/api'
import { PANEL_KIND_LIST } from '@/panels/kinds'
import { useWorkspace } from '@/state/workspace'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui-kit'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NewTerminalDialog } from '@/terminal/NewTerminalDialog'
import { addPanel, buildDefaultLayout, removeHiddenPanels, stripSessions } from './panels'
import { dockRegistry } from './registry'
import { CommandPalette, type PaletteCommand } from './CommandPalette'
import { SaveLayoutDialog } from './SaveLayoutDialog'

/** In Electron i pulsanti della finestra (riduci, ingrandisci, chiudi) stanno sopra la barra, a destra. */
const WINDOW_CONTROLS_WIDTH = window.api ? 140 : 0

const buttonClass =
  'app-no-drag inline-flex h-8 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-lg border border-border px-3 text-[13px] text-text-muted transition-colors hover:bg-border hover:text-foreground data-[state=open]:bg-border data-[state=open]:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'

export function TopBar() {
  const activeSheet = useWorkspace((s) => s.sheets.find((x) => x.id === s.activeSheetId))
  const setStatus = useWorkspace((s) => s.setStatus)
  const [layouts, setLayouts] = useState<NamedLayout[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<NamedLayout | null>(null)
  const [resetting, setResetting] = useState(false)
  const [newTerminal, setNewTerminal] = useState(false)
  const [palette, setPalette] = useState(false)
  const [installing, setInstalling] = useState(false)
  const update = useUpdates((s) => s.status)
  const appInfo = useUpdates((s) => s.info)
  useEffect(() => useUpdates.getState().init(), [])

  const refreshLayouts = () => void api.layouts.list().then(setLayouts)
  useEffect(refreshLayouts, [])

  // Ctrl+K apre la palette comandi (L7).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Dentro un terminale Ctrl+K resta al terminale (in bash e in Claude Code cancella la riga).
      const inTerminal = (e.target as Element | null)?.closest?.('.xterm')
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'k' && !inTerminal) {
        e.preventDefault()
        refreshLayouts()
        setPalette(true)
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        setNewTerminal(true)
      }
    }
    // Fase di cattura: le scorciatoie funzionano anche con il focus dentro un terminale.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const dock = () => (activeSheet ? dockRegistry.get(activeSheet.id) : undefined)

  /**
   * L6: i permessi sono un pannello. Se nel foglio ce n'è già uno lo attiva; altrimenti lo apre sul
   * progetto del terminale attivo (o di un terminale qualsiasi del foglio).
   */
  const openPermissions = () => {
    const d = dock()
    if (!d) return
    const existing = d.panels.find((p) => (p.params as PanelParams | undefined)?.kind === 'permissions')
    if (existing) {
      existing.api.setActive()
      return
    }
    const sessions = useSessions.getState().sessions
    const terminals = d.panels.filter((p) => (p.params as PanelParams | undefined)?.kind === 'terminal')
    const active = terminals.find((p) => p.api.isActive) ?? terminals.find((p) => p.api.isVisible) ?? terminals[0]
    const sessionId = (active?.params as PanelParams | undefined)?.sessionId
    const cwd = (sessionId && sessions[sessionId]?.cwd) || (active?.params as PanelParams | undefined)?.hint?.cwd
    addPanel(d, 'permissions', { params: cwd ? { cwd } : {} })
  }

  const applyLayout = (layout: NamedLayout) => {
    const d = dock()
    if (!d || !activeSheet) return
    try {
      d.fromJSON(layout.layout as unknown as SerializedDockview)
      removeHiddenPanels(d)
      setStatus(`Layout «${layout.name}» applicato a «${activeSheet.name}»`)
    } catch (err) {
      console.error(err)
      setStatus(`Impossibile applicare il layout «${layout.name}»`)
    }
  }

  const commands = useMemo<PaletteCommand[]>(() => {
    const d = () => (activeSheet ? dockRegistry.get(activeSheet.id) : undefined)
    const font = useTerminalSettings.getState()
    return [
      { id: 'new-terminal', title: 'Nuovo terminale', hint: 'Ctrl+Maiusc+T', keywords: 'sessione claude shell', run: () => setNewTerminal(true) },
      { id: 'new-sheet', title: 'Nuovo foglio', run: () => useWorkspace.getState().addSheet() },
      ...PANEL_KIND_LIST.map((k) => ({
        id: `panel-${k.kind}`,
        title: `Aggiungi pannello: ${k.title}`,
        hint: activeSheet ? `in «${activeSheet.name}»` : undefined,
        run: () => {
          const dd = d()
          if (dd) addPanel(dd, k.kind)
        }
      })),
      { id: 'permissions', title: 'Apri Permessi', keywords: 'regole claude settings', run: openPermissions },
      { id: 'plugins', title: 'Apri Plugin', keywords: 'language server linguaggi', run: openPluginsPanel },
      { id: 'save-layout', title: 'Salva layout con nome…', run: () => setSaving(true) },
      ...layouts.map((l) => ({ id: `layout-${l.id}`, title: `Applica layout «${l.name}»`, run: () => applyLayout(l) })),
      { id: 'reset-layout', title: 'Ripristina layout predefinito', run: () => setResetting(true) },
      { id: 'font-bigger', title: 'Terminale: carattere più grande', hint: 'Ctrl+più', run: font.bigger },
      { id: 'font-smaller', title: 'Terminale: carattere più piccolo', hint: 'Ctrl+meno', run: font.smaller },
      { id: 'font-reset', title: 'Terminale: carattere normale', hint: 'Ctrl+0', run: font.reset },
      { id: 'update-check', title: 'Cerca aggiornamenti', keywords: 'versione update', run: () => void useUpdates.getState().check() },
      ...(update.state === 'ready'
        ? [{ id: 'update-install', title: `Riavvia e aggiorna alla versione ${update.version}`, run: () => setInstalling(true) }]
        : []),
      {
        id: 'version',
        title: 'Versione dell\'app',
        hint: appInfo ? appInfo.version : undefined,
        keywords: 'informazioni about',
        run: () => setStatus(`Claude Code Terminal ${appInfo?.version ?? ''} · ${describeUpdate(useUpdates.getState().status)}`)
      }
    ]
    // openPermissions e applyLayout dipendono solo dal foglio attivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSheet, layouts, update, appInfo])

  return (
    <header
      className="app-drag flex h-11 shrink-0 items-center gap-3 border-b border-border bg-surface pl-3"
      style={{ paddingRight: WINDOW_CONTROLS_WIDTH + 12 }}
    >
      <div className="flex items-center gap-2">
        <div
          aria-hidden="true"
          className="flex size-6 items-center justify-center rounded-md bg-brand font-mono text-[11px] font-bold text-on-brand"
        >
          &gt;_
        </div>
        <span className="whitespace-nowrap text-[13px] font-semibold max-lg:hidden">Claude Code Terminal</span>
      </div>

      <button
        type="button"
        onClick={() => {
          refreshLayouts()
          setPalette(true)
        }}
        title="Palette comandi (Ctrl+K)"
        className="app-no-drag relative mx-auto flex h-8 w-full max-w-md items-center rounded-lg border border-border bg-background pr-14 pl-8 text-left text-[13px] text-text-faint outline-none transition-colors hover:border-strong focus-visible:border-brand"
      >
        <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faint" />
        Cerca file, sessioni o comandi…
        <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border px-1.5 font-mono text-[10px] text-text-faint">
          Ctrl K
        </kbd>
      </button>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => setNewTerminal(true)}
          title="Nuovo terminale (Ctrl+Maiusc+T)"
        >
          <SquareTerminal size={14} /> Terminale
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={buttonClass}>
              <Plus size={14} /> Pannello <ChevronDown size={13} className="text-text-faint" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Aggiungi al foglio «{activeSheet?.name}»</DropdownMenuLabel>
            {PANEL_KIND_LIST.map((k) => (
              <DropdownMenuItem
                key={k.kind}
                onSelect={() => {
                  const d = dock()
                  if (d) addPanel(d, k.kind)
                }}
              >
                <span className="flex-1">{k.title}</span>
                {k.phase > 0 && <span className="font-mono text-[11px] text-text-faint">fase {k.phase}</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu onOpenChange={(open) => open && refreshLayouts()}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={buttonClass}>
              <LayoutGrid size={14} /> Layout <ChevronDown size={13} className="text-text-faint" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onSelect={() => setSaving(true)}>Salva layout con nome…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Applica a «{activeSheet?.name}»</DropdownMenuLabel>
            {layouts.length === 0 && (
              <DropdownMenuItem disabled>Nessun layout salvato</DropdownMenuItem>
            )}
            {layouts.map((l) => (
              <DropdownMenuItem key={l.id} onSelect={() => applyLayout(l)}>
                {l.name}
              </DropdownMenuItem>
            ))}
            {layouts.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Elimina layout</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {layouts.map((l) => (
                    <DropdownMenuItem key={l.id} onSelect={() => setDeleting(l)}>
                      {l.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setResetting(true)}>Ripristina layout predefinito</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button type="button" className={buttonClass} onClick={openPermissions} title="Permessi di Claude Code per il progetto del terminale attivo">
          <ShieldCheck size={14} /> Permessi
        </button>
        <button type="button" className={buttonClass} onClick={openPluginsPanel} title="Plugin di linguaggio (language server)">
          <Puzzle size={14} /> Plugin
        </button>
        {update.state === 'ready' && (
          <button
            type="button"
            onClick={() => setInstalling(true)}
            title={describeUpdate(update)}
            className={buttonClass + ' border-brand text-foreground'}
          >
            <ArrowDownToLine size={14} className="text-brand" /> Aggiorna alla {update.version}
          </button>
        )}
        {update.state === 'downloading' && (
          <span className="app-no-drag shrink-0 whitespace-nowrap text-[12px] text-text-faint" title={describeUpdate(update)}>
            Scarico la {update.version}… {update.percent}%
          </span>
        )}
      </div>

      <NewTerminalDialog open={newTerminal} onClose={() => setNewTerminal(false)} />

      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} />

      <SaveLayoutDialog
        open={saving}
        defaultName={activeSheet?.name ?? ''}
        existing={layouts}
        onClose={() => setSaving(false)}
        onSave={async (name) => {
          const d = dock()
          setSaving(false)
          if (!d) return
          await api.layouts.save(name, stripSessions(d.toJSON() as unknown as Record<string, unknown>))
          refreshLayouts()
          setStatus(`Layout «${name}» salvato`)
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={`Eliminare il layout «${deleting?.name ?? ''}»?`}
        description="I fogli che lo usano mantengono la loro disposizione attuale."
        confirmLabel="Elimina"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) {
            await api.layouts.remove(deleting.id)
            setStatus(`Layout «${deleting.name}» eliminato`)
          }
          setDeleting(null)
          refreshLayouts()
        }}
      />

      <ConfirmDialog
        open={installing}
        title={`Riavviare e aggiornare alla versione ${update.state === 'ready' ? update.version : ''}?`}
        description="L'app si chiude, installa la versione nuova e si riapre. I terminali aperti si chiudono: le sessioni di Claude Code si possono riprendere da «Nuovo terminale › Riprendi». Se preferisci, l'aggiornamento si installa da solo alla prossima chiusura."
        confirmLabel="Riavvia e aggiorna"
        onCancel={() => setInstalling(false)}
        onConfirm={() => {
          setInstalling(false)
          void api.updates.install()
        }}
      />

      <ConfirmDialog
        open={resetting}
        title={`Ripristinare il layout predefinito di «${activeSheet?.name ?? ''}»?`}
        description="La disposizione attuale dei pannelli viene sostituita. Se vuoi conservarla, salvala prima con un nome."
        confirmLabel="Ripristina"
        onCancel={() => setResetting(false)}
        onConfirm={() => {
          const d = dock()
          if (d && activeSheet) buildDefaultLayout(d, activeSheet.id)
          setResetting(false)
        }}
      />
    </header>
  )
}
