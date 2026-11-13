import { useEffect, useState } from 'react'
import type { IDockviewHeaderActionsProps } from 'dockview-react'
import { AppWindow, ChevronDown, PanelTopOpen, PictureInPicture2, X } from 'lucide-react'
import { IconButton } from '@/components/IconButton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  PortalScope
} from '@/components/ui-kit'
import type { PanelParams } from '@/panels/kinds'
import { useWorkspace } from '@/state/workspace'
import { moveTerminalToSpace, spaceOfPanel } from './panels'

/** 'edge' sono i gruppi agganciati ai bordi (Dockview 8): li trattiamo come la griglia. */
type Location = 'grid' | 'edge' | 'floating' | 'popout'

/**
 * Pulsanti in alto a destra di ogni gruppo di pannelli:
 * «Invia a…» per i terminali (S4), fluttuante / finestra separata / riaggancia (L4), chiudi.
 */
export function GroupActions({ api, containerApi, group }: IDockviewHeaderActionsProps) {
  const [location, setLocation] = useState<Location>(api.location.type)
  const spaces = useWorkspace((s) => s.spaces)
  const setStatus = useWorkspace((s) => s.setStatus)
  // Le intestazioni non vengono ridisegnate quando cambiano i parametri del pannello attivo: lo facciamo noi.
  const [, refresh] = useState(0)
  const activePanel = group.activePanel

  useEffect(() => {
    const subs = [
      api.onDidLocationChange((e) => setLocation(e.location.type)),
      api.onDidActivePanelChange(() => refresh((n) => n + 1))
    ]
    return () => subs.forEach((s) => s.dispose())
  }, [api])

  useEffect(() => {
    const sub = activePanel?.api.onDidParametersChange(() => refresh((n) => n + 1))
    return () => sub?.dispose()
  }, [activePanel])

  const float = () => {
    const box = group.element.getBoundingClientRect()
    containerApi.addFloatingGroup(group, {
      x: Math.max(24, box.left + 40),
      y: Math.max(24, box.top + 40),
      width: Math.min(720, Math.max(360, box.width * 0.8)),
      height: Math.min(520, Math.max(260, box.height * 0.8))
    })
  }

  const popout = () => {
    void containerApi.addPopoutGroup(group)
  }

  const dock = () => {
    // Riaggancia il gruppo a destra della griglia, mantenendo tutte le sue schede.
    group.api.moveTo({ position: 'right' })
  }

  const closeGroup = () => {
    for (const panel of [...group.panels]) panel.api.close()
  }

  const params = activePanel?.params as PanelParams | undefined
  const canSend = params?.kind === 'terminal' && Boolean(params.sessionId)
  const currentSpace = canSend ? spaceOfPanel(containerApi) : undefined
  const targets = spaces.filter((s) => s.id !== currentSpace)

  return (
    <PortalScope>
      <div className="flex h-full items-center gap-0.5 px-1">
        {canSend && currentSpace && targets.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mr-1 inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[12px] text-text-muted transition-colors hover:bg-border hover:text-foreground data-[state=open]:bg-border"
              >
                Invia a… <ChevronDown size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Sposta «{activePanel?.title}» nello spazio</DropdownMenuLabel>
              {targets.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  onSelect={() => {
                    if (activePanel && moveTerminalToSpace(currentSpace, activePanel.id, t.id)) {
                      setStatus(`«${activePanel.title}» inviata a ${t.name} — la sessione continua`)
                    }
                  }}
                >
                  {t.name}
                </DropdownMenuItem>
              ))}
              <p className="px-2 pt-1 pb-1.5 text-[11px] text-text-faint">Il processo continua: cambia solo dove lo vedi.</p>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {(location === 'grid' || location === 'edge') && (
          <>
            <IconButton label="Rendi fluttuante" onClick={float}>
              <PictureInPicture2 size={14} />
            </IconButton>
            <IconButton label="Stacca in una nuova finestra" onClick={popout}>
              <AppWindow size={14} />
            </IconButton>
          </>
        )}
        {location === 'floating' && (
          <>
            <IconButton label="Riaggancia nel layout" onClick={dock}>
              <PanelTopOpen size={14} />
            </IconButton>
            <IconButton label="Stacca in una nuova finestra" onClick={popout}>
              <AppWindow size={14} />
            </IconButton>
          </>
        )}
        {location === 'popout' && (
          <IconButton label="Riaggancia nella finestra principale" onClick={dock}>
            <PanelTopOpen size={14} />
          </IconButton>
        )}
        <IconButton label="Chiudi il gruppo" onClick={closeGroup}>
          <X size={14} />
        </IconButton>
      </div>
    </PortalScope>
  )
}
