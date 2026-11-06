import type { IDockviewPanelProps } from 'dockview-react'
import { PortalScope } from '@/components/ui-kit'
import { ChangesPanel } from '@/changes/ChangesPanel'
import { EditorPanel } from '@/files/EditorPanel'
import { ExplorerPanel } from '@/files/ExplorerPanel'
import { ProblemsPanel } from '@/files/ProblemsPanel'
import { PermissionsPanel } from '@/permissions/PermissionsPanel'
import { TerminalPanel } from '@/terminal/TerminalPanel'
import type { PanelParams } from './kinds'
import { PlaceholderPanel } from './PlaceholderPanel'

/** Unico componente registrato in Dockview: sceglie il contenuto in base al tipo di pannello. */
export function PanelHost(props: IDockviewPanelProps<PanelParams>) {
  const content = (() => {
    switch (props.params.kind) {
      case 'terminal':
        return <TerminalPanel {...props} />
      case 'changes':
        return <ChangesPanel />
      case 'permissions':
        return <PermissionsPanel {...props} />
      case 'explorer':
        return <ExplorerPanel {...props} />
      case 'editor':
        return <EditorPanel {...props} />
      case 'problems':
        return <ProblemsPanel />
      default:
        return <PlaceholderPanel {...props} />
    }
  })()
  return <PortalScope>{content}</PortalScope>
}
