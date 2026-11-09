import { Check } from 'lucide-react'
import { ACCENT_PRESETS, DEFAULT_ACCENT, useAccent } from '@/state/accent'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui-kit'

/** Scelta del colore d'accento dell'app (bottoni, selezioni, cursore dei fogli…). Vale per tutti i progetti. */
export function AccentDialog() {
  const open = useAccent((s) => s.dialog)
  const accent = useAccent((s) => s.accent)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && useAccent.getState().closeDialog()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Colore d'accento</DialogTitle>
          <DialogDescription>Cambia subito, senza riavviare. L'editor e il cursore del terminale lo applicano alla prossima apertura.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colori predefiniti">
          {ACCENT_PRESETS.map((c) => {
            const on = c.value.toLowerCase() === accent.toLowerCase()
            return (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={c.name}
                title={c.name}
                onClick={() => useAccent.getState().set(c.value)}
                style={{ background: c.value }}
                className="inline-flex size-9 items-center justify-center rounded-full border-2 border-transparent text-black/70 outline-offset-2 hover:scale-105 focus-visible:outline-2 aria-checked:border-foreground"
              >
                {on && <Check size={16} />}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] text-text-muted">
            Colore a scelta
            <input type="color" value={accent} onChange={(e) => useAccent.getState().set(e.target.value)} className="h-8 w-12 cursor-pointer rounded border border-input bg-background p-0.5" />
          </label>
          <button type="button" onClick={() => useAccent.getState().set(DEFAULT_ACCENT)} className="ml-auto h-8 rounded-lg px-3 text-[13px] text-text-subtle hover:bg-border hover:text-foreground">
            Ripristina
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
