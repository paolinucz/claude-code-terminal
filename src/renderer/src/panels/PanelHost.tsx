import type { IDockviewPanelProps } from 'dockview-react'
import { PortalScope } from '@/components/ui-kit'
import { ChangesPanel } from '@/changes/ChangesPanel'
import { DocsPanel } from '@/docs/DocsPanel'
import { EditorPanel } from '@/files/EditorPanel'
import { ProblemsPanel } from '@/files/ProblemsPanel'
import { PermissionsPanel } from '@/permissions/PermissionsPanel'
import { PluginsPanel } from '@/plugins/PluginsPanel'
import { TerminalPanel } from '@/terminal/TerminalPanel'
import type { PanelParams } from './kinds'
import { PanelErrorBoundary } from './PanelErrorBoundary'
import { PlaceholderPanel } from './PlaceholderPanel'

/** Unico componente registrato in Dockview: sceglie il contenuto in base al tipo di pannello. */
export function PanelHost(props: IDockviewPanelProps<PanelParams>) {
  const content = (() => {
    switch (props.params.kind) {
      case 'terminal':
        return <TerminalPanel {...props} />
      case 'changes':
        return <ChangesPanel {...props} />
      case 'permissions':
        return <PermissionsPanel {...props} />
      case 'editor':
        return <EditorPanel {...props} />
      case 'problems':
        return <ProblemsPanel />
      case 'plugins':
        return <PluginsPanel />
      case 'docs':
        return <DocsPanel {...props} />
      default:
        return <PlaceholderPanel {...props} />
    }
  })()
  return (
    <PortalScope>
      <PanelErrorBoundary title={props.api.title ?? props.params.kind}>{content}</PanelErrorBoundary>
    </PortalScope>
  )
}
