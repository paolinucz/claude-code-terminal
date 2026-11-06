import type { IDockviewPanelProps } from 'dockview-react'
import { PortalScope } from '@/components/ui-kit'
import { ChangesPanel } from '@/changes/ChangesPanel'
import { PermissionsPanel } from '@/permissions/PermissionsPanel'
import { TerminalPanel } from '@/terminal/TerminalPanel'
import type { PanelParams } from './kinds'
import { PlaceholderPanel } from './PlaceholderPanel'

/** Unico componente registrato in Dockview: sceglie il contenuto in base al tipo di pannello. */
export function PanelHost(props: IDockviewPanelProps<PanelParams>) {
  const content =
    props.params.kind === 'terminal' ? (
      <TerminalPanel {...props} />
    ) : props.params.kind === 'changes' ? (
      <ChangesPanel />
    ) : props.params.kind === 'permissions' ? (
      <PermissionsPanel {...props} />
    ) : (
      <PlaceholderPanel {...props} />
    )
  return <PortalScope>{content}</PortalScope>
}
