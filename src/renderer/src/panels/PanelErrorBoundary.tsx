import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  /** Nome del pannello, per il messaggio. */
  title: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Un errore dentro un pannello resta nel pannello: senza, React smonta tutta l'interfaccia e la
 * finestra diventa nera. Mostra il messaggio e permette di riprovare.
 */
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Errore nel pannello «${this.props.title}»`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface p-6 text-center text-[13px]">
        <AlertTriangle size={22} className="text-danger" />
        <div className="font-semibold text-foreground">Il pannello «{this.props.title}» si è interrotto per un errore</div>
        <pre className="max-h-32 max-w-full overflow-auto rounded-md bg-background px-3 py-2 text-left font-mono text-[11px] whitespace-pre-wrap text-text-subtle">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-text-muted hover:bg-border hover:text-foreground"
        >
          <RefreshCw size={13} /> Riprova
        </button>
      </div>
    )
  }
}
