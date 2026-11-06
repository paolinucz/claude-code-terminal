import type { IDockviewPanelProps } from 'dockview-react'
import { PortalScope } from '@/components/ui-kit'
import { TerminalPanel } from '@/terminal/TerminalPanel'
import type { PanelParams } from './kinds'
import { PlaceholderPanel } from './PlaceholderPanel'

/** Unico componente registrato in Dockview: sceglie il contenuto in base al tipo di pannello. */
export function PanelHost(props: IDockviewPanelProps<PanelParams>) {
  return <PortalScope>{props.params.kind === 'terminal' ? <TerminalPanel {...props} /> : <PlaceholderPanel {...props} />}</PortalScope>
}
