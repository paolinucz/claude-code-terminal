import { useEffect, useState } from 'react'
import type { IDockviewHeaderActionsProps } from 'dockview-react'
import { AppWindow, PanelTopOpen, PictureInPicture2, X } from 'lucide-react'
import { IconButton } from '@/components/IconButton'

/** 'edge' sono i gruppi agganciati ai bordi (Dockview 8): li trattiamo come la griglia. */
type Location = 'grid' | 'edge' | 'floating' | 'popout'

/**
 * Pulsanti in alto a destra di ogni gruppo di pannelli (L4):
 * agganciato → fluttuante / finestra separata; fluttuante o staccato → riaggancia.
 */
export function GroupActions({ api, containerApi, group }: IDockviewHeaderActionsProps) {
  const [location, setLocation] = useState<Location>(api.location.type)

  useEffect(() => {
    const sub = api.onDidLocationChange((e) => setLocation(e.location.type))
    return () => sub.dispose()
  }, [api])

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

  return (
    <div className="flex h-full items-center gap-0.5 px-1">
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
  )
}
