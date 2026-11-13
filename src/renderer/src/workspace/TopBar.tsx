import { useEffect, useMemo, useState } from 'react'
import type { SerializedDockview } from 'dockview-react'
import { ArrowDownToLine, ChevronDown, Keyboard, LayoutGrid, Maximize, Minimize, Plus, Puzzle, ShieldCheck } from 'lucide-react'
import { openPluginsPanel, useEditor } from '@/state/editor'
import { runPluginCommand } from '@/plugins/pluginBridge'
import type { PanelParams } from '@/panels/kinds'
import { useAppearance } from '@/state/appearance'
import { switchClaudeMode } from './claudeMode'
import { useSessions } from '@/state/sessions'
import { useTerminalSettings } from '@/state/terminalSettings'
import { describeUpdate, useUpdates } from '@/state/updates'
import type { NamedLayout } from '@shared/types'
import { api } from '@/lib/api'
import { PANEL_KIND_LIST } from '@/panels/kinds'
import { SnippetExplain } from '@/changes/SnippetExplain'
import { spacesOf, useWorkspace } from '@/state/workspace'
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
import { CommandPalette, type PaletteCommand, type PaletteMode } from './CommandPalette'
import { SaveLayoutDialog } from './SaveLayoutDialog'
import { ShortcutsDialog } from './ShortcutsDialog'
import { ProjectMenu } from './ProjectMenu'
import { ContextSwitcher } from './ContextSwitcher'
import { SpaceChips } from './SpaceChips'
import { useFullScreen, windowControlsWidth } from '@/state/fullscreen'
import { AboutDialog } from './AboutDialog'
import { useAbout } from '@/state/about'
import { activeClaudeSessionId } from '@/changes/reveal'
import { useReviewUi } from '@/state/review'
import { useOverview } from '@/state/overview'
import { useProject } from '@/state/project'
import { useDocs } from '@/state/docs'
import { useExplainSettings } from '@/state/explain'
import { usePresets } from '@/state/presets'
import { previewOf } from '@shared/prompts'
import { PresetsDialog } from './PresetsDialog'
import { AppearanceDialog } from './AppearanceDialog'
import { useAccent } from '@/state/accent'
import { sendPreset } from './presets'
import { openDocsPanel } from '@/docs/DocsPanel'

/** In Electron i pulsanti della finestra (riduci, ingrandisci, chiudi) stanno sopra la barra, a destra. */

const buttonClass =
  'app-no-drag inline-flex h-8 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-lg border border-border px-3 text-[13px] text-text-muted transition-colors hover:bg-border hover:text-foreground data-[state=open]:bg-border data-[state=open]:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'

export function TopBar() {
  const activeSpace = useWorkspace((s) => s.spaces.find((x) => x.id === s.activeSpaceId))
  const setStatus = useWorkspace((s) => s.setStatus)
  const [layouts, setLayouts] = useState<NamedLayout[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<NamedLayout | null>(null)
  const [resetting, setResetting] = useState(false)
  const [newTerminal, setNewTerminal] = useState(false)
  const [palette, setPalette] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('all')
  const [installing, setInstalling] = useState(false)
  const update = useUpdates((s) => s.status)
  const fullScreen = useFullScreen((s) => s.on)
  const appInfo = useUpdates((s) => s.info)
  const project = useProject((s) => s.active)
  const explainOn = useExplainSettings((s) => s.enabled)
  const presets = usePresets((s) => s.presets)
  useEffect(() => void usePresets.getState().load(), [])
  useEffect(() => void useAccent.getState().load(), [])
  useEffect(() => void useExplainSettings.getState().load(), [])
  useEffect(() => useUpdates.getState().init(), [])
  useEffect(() => {
    useProject.getState().init()
    useDocs.getState().init()
  }, [])

  const refreshLayouts = () => void api.layouts.list().then(setLayouts)
  useEffect(refreshLayouts, [])

  // Ctrl+K apre la palette comandi (L7).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Dentro un terminale Ctrl+K resta al terminale (in bash e in Claude Code cancella la riga).
      const inTerminal = (e.target as Element | null)?.closest?.('.xterm')
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !inTerminal) {
        const k = e.key.toLowerCase()
        // Ctrl+K comandi, Ctrl+P vai al file, Ctrl+E file recenti (in un terminale restano alla shell).
        const mode: PaletteMode | null = k === 'k' ? 'all' : k === 'p' ? 'files' : k === 'e' ? 'recent' : null
        if (mode) {
          e.preventDefault()
          e.stopPropagation()
          if (mode === 'all') refreshLayouts()
          setPaletteMode(mode)
          setPalette(true)
        }
      }
      // F1–F9: spazio 1–9 del contesto attivo, anche con il focus dentro un terminale.
      // Sulla scheda di uno spazio F2 resta «rinomina»; nei campi di testo non si intercetta; nell'albero dei file F2, F5 e F6
      // sono rinomina, copia e sposta.
      const fn = /^F([1-9])$/.exec(e.key)
      const target = e.target as Element | null
      if (fn && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && !target?.closest?.('[role="tab"], [role="tree"], input, textarea:not(.xterm-helper-textarea)')) {
        const { spaces, contextId, setActive } = useWorkspace.getState()
        const space = spacesOf(spaces, contextId)[Number(fn[1]) - 1]
        e.preventDefault()
        if (space) setActive(space.id)
      }
      // Ctrl+1…9: spazio n del contesto attivo; Ctrl+Tab: panoramica degli spazi. Valgono anche con il focus nel terminale
      // (le shell non usano queste combinazioni).
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        const { spaces, contextId, setActive } = useWorkspace.getState()
        const space = spacesOf(spaces, contextId)[Number(e.key) - 1]
        e.preventDefault()
        e.stopPropagation()
        if (space) setActive(space.id)
      }
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        useOverview.getState().toggle()
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

  const dock = () => (activeSpace ? dockRegistry.get(activeSpace.id) : undefined)

  /**
   * L6: i permessi sono un pannello. Se nello spazio ce n'è già uno lo attiva; altrimenti lo apre sul
   * progetto del terminale attivo (o di un terminale qualsiasi dello spazio).
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
    if (!d || !activeSpace) return
    try {
      d.fromJSON(layout.layout as unknown as SerializedDockview)
      removeHiddenPanels(d)
      setStatus(`Layout «${layout.name}» applicato a «${activeSpace.name}»`)
    } catch (err) {
      console.error(err)
      setStatus(`Impossibile applicare il layout «${layout.name}»`)
    }
  }

  const installedPlugins = useEditor((s) => s.plugins)
  const commands = useMemo<PaletteCommand[]>(() => {
    const d = () => (activeSpace ? dockRegistry.get(activeSpace.id) : undefined)
    const font = useTerminalSettings.getState()
    return [
      { id: 'new-terminal', title: 'Nuovo terminale', hint: 'Ctrl+Maiusc+T', keywords: 'sessione claude shell', run: () => setNewTerminal(true) },
      { id: 'new-space', title: 'Nuovo spazio', run: () => useWorkspace.getState().addSpace() },
      ...PANEL_KIND_LIST.map((k) => ({
        id: `panel-${k.kind}`,
        title: `Aggiungi pannello: ${k.title}`,
        hint: activeSpace ? `in «${activeSpace.name}»` : undefined,
        run: () => {
          const dd = d()
          if (dd) addPanel(dd, k.kind)
        }
      })),
      ...(project?.data.contexts ?? []).map((c) => ({
        id: `context-${c.id}`,
        title: `Vai al contesto «${c.name}»`,
        keywords: 'contesto progetto',
        run: () => useProject.getState().setContext(c.id)
      })),
      // Prompt predefiniti: un clic li manda alla sessione Claude dello spazio attivo. Il testo è tra le parole cercabili.
      ...presets.map((p) => ({
        id: `preset-${p.id}`,
        title: `Prompt: ${p.name}`,
        hint: previewOf(p.text, 50),
        keywords: `prompt predefinito invia messaggio ${p.text.slice(0, 300)}`,
        run: () => void sendPreset(p)
      })),
      {
        id: 'artifacts',
        title: 'Artifact di claude.ai nelle nuove sessioni: attiva/disattiva',
        keywords: 'artifact claude.ai pubblica pagine online file cartella',
        run: async () => {
          const on = (await api.settings.get('claude.allowArtifacts')) === true
          await api.settings.set('claude.allowArtifacts', !on)
          setStatus(!on ? 'Artifact di claude.ai consentiti nelle nuove sessioni' : 'Artifact di claude.ai disattivati nelle nuove sessioni: Claude scrive i file nella cartella')
        }
      },
      { id: 'accent', title: 'Aspetto…', keywords: 'tema colore accento sfondo animato vetro trasparenza personalizza', run: () => useAccent.getState().openDialog() },
      { id: 'presets-manage', title: 'Gestisci prompt predefiniti…', keywords: 'prompt messaggi salvati aggiungi modifica', run: () => usePresets.getState().openDialog() },
      {
        id: 'explain-toggle',
        title: explainOn ? 'Output smart: nascondi la vista Spiegazione' : 'Output smart: mostra la vista Spiegazione',
        keywords: 'spiega modifiche haiku html',
        run: () => useExplainSettings.getState().setEnabled(!explainOn)
      },
      { id: 'docs', title: 'Apri Documentazione', keywords: 'claude.md markdown progetto riferimenti', run: openDocsPanel },
      { id: 'permissions', title: 'Apri Permessi', keywords: 'regole claude settings', run: openPermissions },
      {
        id: 'review-toggle',
        title: 'Revisione: apri o chiudi il cassetto della sessione',
        keywords: 'modifiche diff approva rifiuta cassetto claude',
        run: () => {
          const id = activeClaudeSessionId()
          if (id) useReviewUi.getState().toggleReview(id)
          else setStatus('Nessuna sessione di Claude aperta in questo spazio')
        }
      },
      { id: 'about', title: 'Informazioni su Magnolia…', keywords: 'versione autore dedica licenza about', run: () => useAbout.getState().show() },
      { id: 'claude-mode', title: 'Claude: passa a Bolle / Schede', keywords: 'bolle schede bot modalità workspace vuoto', run: () => void switchClaudeMode(useAppearance.getState().claudeMode === 'tabs' ? 'bubbles' : 'tabs') },
      { id: 'fullscreen', title: 'Schermo intero', hint: 'F11', keywords: 'finestra tutto schermo full screen', run: () => useFullScreen.getState().toggle() },
      { id: 'plugins', title: 'Apri Plugin', keywords: 'language server linguaggi', run: openPluginsPanel },
      // Comandi contribuiti dai plugin attivi (`contributes.commands`).
      ...installedPlugins
        .filter((p) => p.enabled && p.state === 'ok')
        .flatMap((p) =>
          (p.manifest.contributes?.commands ?? []).map((c) => ({
            id: `plugin-${p.manifest.id}-${c.id}`,
            title: `${p.manifest.name}: ${c.title}`,
            hint: c.hint,
            keywords: c.keywords,
            run: () => runPluginCommand(p.manifest.id, c)
          }))
        ),
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
        run: () => setStatus(`Magnolia ${appInfo?.version ?? ''} · ${describeUpdate(useUpdates.getState().status)}`)
      }
    ]
    // openPermissions e applyLayout dipendono solo dallo spazio attivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSpace, layouts, update, appInfo, project, explainOn, presets, installedPlugins])

  return (
    // La barra non ha sfondo né bordo: i suoi elementi stanno sullo sfondo scuro della finestra, a --cct-gap dal bordo. Il contenitore trascina
    // la finestra anche nei margini; i controlli nativi di Windows stanno a destra, fuori dalla scheda.
    <div className="app-drag mg-glass-1 relative z-30 shrink-0 border-x-0 border-t-0" style={{ paddingRight: windowControlsWidth(fullScreen) || 10 }}>
    <header className="flex h-12 items-center gap-3 pr-3 pl-3">
      <ProjectMenu />
      <ContextSwitcher />

      <div className="h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />
      <div className="flex min-w-0 items-center gap-1">
        <SpaceChips />
      </div>

      {/* Area vuota trascinabile: la finestra si sposta da qui. Almeno 48 px liberi tra l'ultimo chip e i pulsanti. */}
      <div className="min-w-12 flex-1 self-stretch" aria-hidden="true" />

      <div className="app-no-drag flex items-center gap-2">
        <button
          type="button"
          className="app-no-drag inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold text-on-brand transition-opacity hover:opacity-90"
          onClick={() => setNewTerminal(true)}
          title="Nuovo terminale (Ctrl+Maiusc+T)"
        >
          <Plus size={14} /> Terminale
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={buttonClass}>
              <Plus size={14} /> Pannello <ChevronDown size={13} className="text-text-faint" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Aggiungi allo spazio «{activeSpace?.name}»</DropdownMenuLabel>
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
            <DropdownMenuLabel>Applica a «{activeSpace?.name}»</DropdownMenuLabel>
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
        <button
          type="button"
          onClick={() => useFullScreen.getState().toggle()}
          title={fullScreen ? 'Esci dallo schermo intero (F11)' : 'Schermo intero (F11)'}
          aria-label={fullScreen ? 'Esci dallo schermo intero' : 'Schermo intero'}
          aria-pressed={fullScreen}
          className="app-no-drag inline-flex size-8 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-border hover:text-foreground"
        >
          {fullScreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
        <button
          type="button"
          onClick={() => setShortcuts(true)}
          title="Scorciatoie da tastiera"
          aria-label="Scorciatoie da tastiera"
          className="app-no-drag inline-flex size-8 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-border hover:text-foreground"
        >
          <Keyboard size={16} />
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
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
      <PresetsDialog />
      <AppearanceDialog />
      <AboutDialog />

      <SnippetExplain />
      <CommandPalette open={palette} mode={paletteMode} onClose={() => setPalette(false)} commands={commands} />

      <SaveLayoutDialog
        open={saving}
        defaultName={activeSpace?.name ?? ''}
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
        description="Gli spazi che lo usano mantengono la loro disposizione attuale."
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
        title={`Ripristinare il layout predefinito di «${activeSpace?.name ?? ''}»?`}
        description="La disposizione attuale dei pannelli viene sostituita. Se vuoi conservarla, salvala prima con un nome."
        confirmLabel="Ripristina"
        onCancel={() => setResetting(false)}
        onConfirm={() => {
          const d = dock()
          if (d && activeSpace) buildDefaultLayout(d, activeSpace.id)
          setResetting(false)
        }}
      />
    </header>
    </div>
  )
}
