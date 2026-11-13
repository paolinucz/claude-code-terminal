import { Check } from 'lucide-react'
import { ACCENT_PRESETS, DEFAULT_ACCENT, useAccent } from '@/state/accent'
import { BACKGROUND_MODES, CHAT_FONTS, CLAUDE_MODES, useAppearance } from '@/state/appearance'
import { switchClaudeMode } from './claudeMode'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Segmented, Switch } from '@/components/ui-kit'

/** Aspetto dell'app: colore d'accento, sfondo animato ed effetto vetro. Vale per tutti i progetti e cambia subito. */
export function AppearanceDialog() {
  const open = useAccent((s) => s.dialog)
  const accent = useAccent((s) => s.accent)
  const background = useAppearance((s) => s.background)
  const glass = useAppearance((s) => s.glass)
  const chatFont = useAppearance((s) => s.chatFont)
  const claudeMode = useAppearance((s) => s.claudeMode)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && useAccent.getState().closeDialog()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Aspetto</DialogTitle>
          <DialogDescription>Le modifiche si applicano subito, senza riavviare. L'editor e il cursore del terminale usano il colore d'accento alla prossima apertura.</DialogDescription>
        </DialogHeader>

        <section className="mt-4 space-y-2" aria-labelledby="ap-accent">
          <h3 id="ap-accent" className="text-[12px] font-semibold text-text-subtle">
            Colore d'accento
          </h3>
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
        </section>

        <section className="mt-5 space-y-2" aria-labelledby="ap-bg">
          <h3 id="ap-bg" className="text-[12px] font-semibold text-text-subtle">
            Sfondo animato
          </h3>
          <Segmented value={background} onChange={(v) => useAppearance.getState().setBackground(v)} options={BACKGROUND_MODES} label="Sfondo animato" />
          <p className="text-[12px] text-text-faint">Si ferma da solo quando la finestra non è in primo piano, a batteria e con «riduci animazioni» attivo nel sistema.</p>
        </section>

        <section className="mt-5 space-y-2" aria-labelledby="ap-font">
          <h3 id="ap-font" className="text-[12px] font-semibold text-text-subtle">
            Font della vista grafica
          </h3>
          <Segmented value={chatFont} onChange={(v) => useAppearance.getState().setChatFont(v)} options={CHAT_FONTS} label="Font della vista grafica" />
        </section>

        <section className="mt-5 space-y-2" aria-labelledby="ap-claude">
          <h3 id="ap-claude" className="text-[12px] font-semibold text-text-subtle">
            Claude
          </h3>
          <Segmented value={claudeMode} onChange={(v) => void switchClaudeMode(v)} options={CLAUDE_MODES} label="Modalità di Claude" />
          <p className="text-[12px] text-text-faint">
            {claudeMode === 'tabs'
              ? 'Ogni sessione di Claude è una scheda nel layout. Le bolle non ci sono.'
              : 'Ogni sessione di Claude è una bolla sul bordo della finestra e il workspace resta vuoto; una bolla si può ampliare a tutta l\'area di lavoro. Le schede di Claude non ci sono.'}
          </p>
        </section>

        <section className="mt-5 flex items-center gap-3" aria-labelledby="ap-glass">
          <div className="min-w-0 flex-1">
            <h3 id="ap-glass" className="text-[13px] font-medium text-foreground">
              Effetto vetro
            </h3>
            <p className="text-[12px] text-text-faint">Trasparenza e sfocatura di barre, menu e finestre. Spento: fondi opachi.</p>
          </div>
          <Switch checked={glass} onCheckedChange={(v) => useAppearance.getState().setGlass(v)} aria-labelledby="ap-glass" />
        </section>
      </DialogContent>
    </Dialog>
  )
}
