import { useEffect, useState } from 'react'
import { Pencil, Play, Trash2 } from 'lucide-react'
import { PRESET_LIMITS, previewOf } from '@shared/prompts'
import { usePresets } from '@/state/presets'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui-kit'
import { sendPreset } from './presets'

/** Gestione dei prompt predefiniti: elenco, aggiunta, modifica, eliminazione. Si usano dalla palette comandi (Ctrl+K). */
export function PresetsDialog() {
  const presets = usePresets((s) => s.presets)
  const dialog = usePresets((s) => s.dialog)
  const [editId, setEditId] = useState<string | undefined>()
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!dialog.open) return
    setEditId(undefined)
    setName('')
    setText(dialog.draft ?? '')
    setError('')
  }, [dialog.open, dialog.draft])

  const reset = () => {
    setEditId(undefined)
    setName('')
    setText('')
    setError('')
  }

  const submit = async () => {
    const err = await usePresets.getState().save({ id: editId, name, text })
    if (err) setError(err)
    else reset()
  }

  const inputClass = 'mt-1 w-full rounded-lg border border-input bg-background px-3 text-[13px] text-foreground outline-none focus:border-brand'

  return (
    <Dialog open={dialog.open} onOpenChange={(open) => !open && usePresets.getState().closeDialog()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prompt predefiniti</DialogTitle>
          <DialogDescription>
            Messaggi pronti da mandare a Claude con un clic. Premi <kbd className="rounded border border-border px-1 font-mono text-[11px]">Ctrl K</kbd> e
            scrivi il nome: il prompt va alla sessione Claude dello spazio attivo.
          </DialogDescription>
        </DialogHeader>

        <ul className="mt-3 max-h-56 space-y-1 overflow-auto" aria-label="Prompt salvati">
          {presets.length === 0 && <li className="px-2 py-4 text-center text-[12px] text-text-faint">Nessun prompt. Aggiungine uno qui sotto.</li>}
          {presets.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-foreground">{p.name}</span>
                <span className="block truncate text-[12px] text-text-faint">{previewOf(p.text, 90)}</span>
              </span>
              <button type="button" title="Manda alla sessione Claude dello spazio" aria-label={`Manda «${p.name}»`} onClick={() => void sendPreset(p)} className="rounded p-1.5 text-text-muted hover:bg-border hover:text-foreground">
                <Play size={14} />
              </button>
              <button
                type="button"
                title="Modifica"
                aria-label={`Modifica «${p.name}»`}
                onClick={() => {
                  setEditId(p.id)
                  setName(p.name)
                  setText(p.text)
                  setError('')
                }}
                className="rounded p-1.5 text-text-muted hover:bg-border hover:text-foreground"
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                title="Elimina"
                aria-label={`Elimina «${p.name}»`}
                onClick={() => {
                  void usePresets.getState().remove(p.id)
                  if (editId === p.id) reset()
                }}
                className="rounded p-1.5 text-text-muted hover:bg-border hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>

        <form
          className="mt-4 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <p className="text-[12px] font-semibold text-foreground">{editId ? 'Modifica prompt' : 'Nuovo prompt'}</p>
          <label htmlFor="preset-name" className="mt-2 block text-[12px] text-text-subtle">
            Nome (quello che cerchi nella palette)
          </label>
          <input id="preset-name" value={name} maxLength={PRESET_LIMITS.name} onChange={(e) => setName(e.target.value)} className={inputClass + ' h-9'} />
          <label htmlFor="preset-text" className="mt-2 block text-[12px] text-text-subtle">
            Testo del messaggio
          </label>
          <textarea id="preset-text" value={text} rows={4} onChange={(e) => setText(e.target.value)} className={inputClass + ' resize-y py-2 leading-snug'} />
          <p className="mt-1 min-h-4 text-[12px] text-danger">{error}</p>
          <DialogFooter className="mt-2">
            <button type="button" onClick={() => void usePresets.getState().restoreDefaults()} className="mr-auto h-9 rounded-lg px-3 text-[12px] text-text-faint hover:text-foreground">
              Ripristina gli esempi
            </button>
            {(editId || name || text) && (
              <button type="button" onClick={reset} className="h-9 rounded-lg border border-border px-4 text-text-muted hover:bg-border hover:text-foreground">
                Annulla
              </button>
            )}
            <button type="submit" disabled={!name.trim() || !text.trim()} className="h-9 rounded-lg bg-brand px-4 font-semibold text-on-brand transition-opacity disabled:opacity-40">
              {editId ? 'Salva' : 'Aggiungi'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
