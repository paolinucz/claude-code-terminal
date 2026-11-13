import { useState } from 'react'
import { AlertTriangle, ChevronDown, FolderKanban } from 'lucide-react'
import { api } from '@/lib/api'
import { openDocsPanel } from '@/docs/DocsPanel'
import { useDocs } from '@/state/docs'
import { useProject } from '@/state/project'
import { useAbout } from '@/state/about'
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
import { NewProjectDialog } from './NewProjectDialog'

const buttonClass =
  'app-no-drag inline-flex h-8 max-w-56 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-lg border border-border px-3 text-[13px] text-text-muted transition-colors hover:bg-border hover:text-foreground data-[state=open]:bg-border data-[state=open]:text-foreground'

/** Progetto attivo nella barra in alto: apre, crea e cambia progetto (J1, J9). */
export function ProjectMenu() {
  const active = useProject((s) => s.active)
  const recents = useProject((s) => s.recents)
  const claudeMd = useDocs((s) => s.claudeMd)
  const [creating, setCreating] = useState(false)

  const openFile = async () => {
    const file = await api.project.pickFile(active?.root)
    if (file) await useProject.getState().openPath(file)
  }
  const openFolder = async () => {
    const dir = await api.env.pickFolder(active?.root, 'Apri la cartella di un progetto')
    if (dir) await useProject.getState().openPath(dir)
  }

  const others = recents.filter((r) => r.root.toLowerCase() !== active?.root.toLowerCase())

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && void useProject.getState().refreshRecents()}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={buttonClass} title={active ? active.root : 'Nessun progetto aperto'}>
            <FolderKanban size={14} className={active ? 'text-brand' : undefined} />
            <span className="truncate">{active ? active.data.name : 'Progetto'}</span>
            <ChevronDown size={13} className="shrink-0 text-text-faint" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {active && (
            <>
              <DropdownMenuLabel className="truncate">{active.root}</DropdownMenuLabel>
              {claudeMd === 'missing' && (
                <DropdownMenuItem onSelect={() => openDocsPanel()}>
                  <AlertTriangle size={14} className="text-warn" />
                  <span className="flex-1">Manca CLAUDE.md: crealo…</span>
                </DropdownMenuItem>
              )}
              {!active.file && (
                <DropdownMenuItem onSelect={() => void useProject.getState().createFileForActive()}>
                  Crea il file di progetto (.cctproj)
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => setCreating(true)}>Nuovo progetto…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void openFile()}>Apri file di progetto…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void openFolder()}>Apri cartella…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Recenti</DropdownMenuLabel>
          {others.length === 0 && <DropdownMenuItem disabled>Nessun altro progetto</DropdownMenuItem>}
          {others.slice(0, 8).map((r) => (
            <DropdownMenuItem key={r.root} title={r.root} onSelect={() => void useProject.getState().openPath(r.file ?? r.root)}>
              <span className="flex-1 truncate">{r.name}</span>
              {!r.file && <span className="font-mono text-[11px] text-text-faint">senza file</span>}
            </DropdownMenuItem>
          ))}
          {others.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Rimuovi dai recenti</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {others.slice(0, 8).map((r) => (
                  <DropdownMenuItem key={r.root} onSelect={() => void useProject.getState().forget(r.root)}>
                    {r.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {active && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => useProject.getState().close()}>Chiudi progetto</DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => useAbout.getState().show()}>Informazioni su Magnolia…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
