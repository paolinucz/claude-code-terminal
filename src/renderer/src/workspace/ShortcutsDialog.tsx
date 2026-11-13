import { Fragment, useMemo } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui-kit'
import { useSidebarViews } from './sidebarViews'

interface Shortcut {
  keys: string
  label: string
}

interface Group {
  title: string
  items: Shortcut[]
}

/** Scorciatoie dell'app. Quelle dei plugin (viste con `shortcut` nel manifest) si aggiungono da sole sotto «Barra laterale». */
const GROUPS: Group[] = [
  {
    title: 'Generale',
    items: [
      { keys: 'Ctrl K', label: 'Palette dei comandi' },
      { keys: 'Ctrl P', label: 'Vai a un file' },
      { keys: 'Ctrl E', label: 'File aperti di recente' },
      { keys: 'Ctrl Maiusc T', label: 'Nuovo terminale' },
      { keys: '↑ ↓', label: 'Nella revisione: file precedente / successivo (con l\'elenco dei file selezionato)' },
      { keys: 'F11', label: 'Schermo intero (di nuovo F11 per uscire)' },
      { keys: 'Ctrl+1…9', label: 'Vai allo spazio 1–9 (anche dentro un terminale)' },
      { keys: 'Ctrl+Tab', label: 'Panoramica degli spazi (Esc per chiuderla)' },
      { keys: 'F1…F9', label: 'Vai allo spazio 1–9' },
      { keys: 'F2', label: 'Rinomina lo spazio (con la sua scheda selezionata)' }
    ]
  },
  {
    title: 'Barra laterale',
    items: [
      { keys: 'Ctrl Maiusc E', label: 'Esplora file' },
      { keys: 'Ctrl Maiusc F', label: 'Cerca nei file' },
      { keys: 'Ctrl F', label: 'Cerca nel Markdown impaginato' },
      { keys: 'F2', label: 'Esplora file: rinomina (anche nella vista Package)' },
      { keys: 'F6', label: 'Esplora file: sposta in…' },
      { keys: 'F5', label: 'Esplora file: copia in…' },
      { keys: 'Ctrl clic / Ctrl trascina', label: 'Esplora file: seleziona più elementi / copia invece di spostare' }
    ]
  },
  {
    title: 'Terminale',
    items: [
      { keys: 'Ctrl + / Ctrl −', label: 'Carattere più grande / più piccolo' },
      { keys: 'Ctrl 0', label: 'Carattere normale' },
      { keys: 'Ctrl rotellina', label: 'Cambia la dimensione del carattere' },
      { keys: '', label: 'Dentro un terminale Ctrl+K, Ctrl+P e Ctrl+E restano alla shell (non aprono la palette)' }
    ]
  },
  {
    title: 'Editor',
    items: [
      { keys: 'Ctrl S', label: 'Salva il file' },
      { keys: 'Ctrl F', label: 'Cerca nel file' },
      { keys: 'Ctrl H', label: 'Sostituisci' },
      { keys: 'Ctrl G', label: 'Vai alla riga' },
      { keys: 'Ctrl D', label: 'Seleziona l\'occorrenza successiva' }
    ]
  }
]

/**
 * Una scorciatoia come tasti separati, con lo stile dei tasti dell'app. Alternative separate da « / »; i tasti di una
 * combinazione separati da spazio («Ctrl Maiusc T») oppure da «+» («Ctrl+Maiusc+D», come nei manifest dei plugin).
 */
function Keys({ keys }: { keys: string }) {
  if (!keys) return null
  return (
    <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      {keys.split(' / ').map((alt, a) => (
        <span key={a} className="inline-flex items-center gap-1">
          {(alt.includes(' ') ? alt.split(' ') : alt.split('+')).map((k, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="text-text-faint">+</span>}
              <kbd className="rounded-md border border-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-foreground shadow-[inset_0_-1px_0_rgb(0_0_0/0.4)]">{k}</kbd>
            </Fragment>
          ))}
        </span>
      ))}
    </span>
  )
}

/** Finestra con tutte le scorciatoie da tastiera, aperta dal pulsante a tastiera nella barra in alto. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const views = useSidebarViews()
  const groups = useMemo<Group[]>(() => {
    const fromViews = views.filter((v) => v.shortcut && !['explorer', 'search'].includes(v.id)).map((v) => ({ keys: v.shortcut!, label: v.title }))
    return GROUPS.map((g) => (g.title === 'Barra laterale' ? { ...g, items: [...g.items.slice(0, 2), ...fromViews, ...g.items.slice(2)] } : g))
  }, [views])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[86vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Scorciatoie da tastiera</DialogTitle>
          <DialogDescription>Quelle dei plugin compaiono qui da sole.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {groups.map((g) => (
            <section key={g.title} aria-label={g.title}>
              <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-text-subtle uppercase">{g.title}</h3>
              <ul className="space-y-1.5">
                {g.items.map((s) => (
                  <li key={s.keys + s.label} className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-[12.5px] text-text-muted">{s.label}</span>
                    <Keys keys={s.keys} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
