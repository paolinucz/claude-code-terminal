import { useEffect, useState } from 'react'
import { DECISIONS, isValidRule, type Decision } from '@shared/permissions'
import { cn } from '@/lib/cn'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Segmented } from '@/components/ui-kit'

/** Strumenti più comuni, con un esempio di specificatore. */
const TOOLS: { id: string; hint: string; example: string }[] = [
  { id: 'Bash', hint: 'Comando, con * come jolly alla fine', example: 'npm run test:*' },
  { id: 'Read', hint: 'Percorso o modello (gitignore)', example: '.env*' },
  { id: 'Edit', hint: 'Percorso o modello dei file modificabili', example: 'src/**' },
  { id: 'Write', hint: 'Percorso o modello dei file creabili', example: 'docs/**' },
  { id: 'WebFetch', hint: 'domain:<dominio>', example: 'domain:docs.github.com' },
  { id: 'WebSearch', hint: 'Di solito senza specificatore', example: '' },
  { id: 'Glob', hint: 'Di solito senza specificatore', example: '' },
  { id: 'Grep', hint: 'Di solito senza specificatore', example: '' }
]

/** Nuova regola per l'ambito scelto (P2). */
export function NewRuleDialog(props: {
  open: boolean
  scopeLabel: string
  existing: { rule: string; decision: Decision }[]
  onAdd(rule: string, decision: Decision): void
  onClose(): void
}) {
  const [tool, setTool] = useState('Bash')
  const [custom, setCustom] = useState('')
  const [specifier, setSpecifier] = useState('')
  const [decision, setDecision] = useState<Decision>('allow')

  useEffect(() => {
    if (!props.open) return
    setTool('Bash')
    setCustom('')
    setSpecifier('')
    setDecision('allow')
  }, [props.open])

  const toolName = tool === 'altro' ? custom.trim() : tool
  const rule = specifier.trim() ? `${toolName}(${specifier.trim()})` : toolName
  const valid = Boolean(toolName) && isValidRule(rule)
  const duplicate = props.existing.find((e) => e.rule === rule)
  const info = TOOLS.find((t) => t.id === tool)

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) props.onAdd(rule, decision)
          }}
        >
          <DialogHeader>
            <DialogTitle>Nuova regola · {props.scopeLabel}</DialogTitle>
            <DialogDescription>Una regola indica a Claude Code se un'azione è consentita, va chiesta o è vietata.</DialogDescription>
          </DialogHeader>

          <p className="mt-4 mb-1.5 text-[12px] text-text-subtle">Strumento</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Strumento">
            {[...TOOLS.map((t) => t.id), 'altro'].map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={tool === id}
                onClick={() => setTool(id)}
                className={cn(
                  'h-8 rounded-lg border px-2.5 font-mono text-[12px] transition-colors',
                  tool === id ? 'border-brand bg-border text-foreground' : 'border-border text-text-muted hover:text-foreground'
                )}
              >
                {id === 'altro' ? 'Altro…' : id}
              </button>
            ))}
          </div>
          {tool === 'altro' && (
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="es. mcp__github__create_issue oppure NotebookEdit"
              aria-label="Nome dello strumento"
              className="mt-2 h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-[12px] text-foreground outline-none placeholder:text-text-faint focus:border-brand"
            />
          )}

          <label className="mt-4 mb-1.5 block text-[12px] text-text-subtle" htmlFor="rule-spec">
            Specificatore <span className="text-text-faint">· facoltativo{info ? ` · ${info.hint}` : ''}</span>
          </label>
          <input
            id="rule-spec"
            autoFocus
            value={specifier}
            onChange={(e) => setSpecifier(e.target.value)}
            placeholder={info?.example ? `es. ${info.example}` : 'lascia vuoto per tutto lo strumento'}
            className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-[12px] text-foreground outline-none placeholder:text-text-faint focus:border-brand"
          />

          <p className="mt-4 mb-1.5 text-[12px] text-text-subtle">Decisione</p>
          <Segmented label="Decisione" value={decision} onChange={setDecision} options={DECISIONS} />

          <div className="mt-4 rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px]">
            <span className="text-text-faint">Regola: </span>
            <span className={valid ? 'text-foreground' : 'text-danger'}>{rule || '—'}</span>
          </div>
          <p className="mt-1.5 min-h-4 text-[12px] text-warn">
            {duplicate
              ? duplicate.decision === decision
                ? 'Questa regola esiste già con la stessa decisione.'
                : `Esiste già: verrà spostata da «${DECISIONS.find((d) => d.id === duplicate.decision)?.label}» a «${DECISIONS.find((d) => d.id === decision)?.label}».`
              : ''}
          </p>

          <DialogFooter className="mt-3">
            <button type="button" onClick={props.onClose} className="h-9 rounded-lg border border-border px-4 text-text-muted hover:bg-border hover:text-foreground">
              Annulla
            </button>
            <button type="submit" disabled={!valid || duplicate?.decision === decision} className="h-9 rounded-lg bg-brand px-4 font-semibold text-on-brand disabled:opacity-40">
              Aggiungi
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
