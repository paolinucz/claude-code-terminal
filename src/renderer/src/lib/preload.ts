import { api } from '@/lib/api'
import { preloadFileIcons } from '@/lib/fileIcons'
import { trackBoot } from '@/state/boot'

/**
 * Caricamento anticipato di ciò che altrimenti si carica alla prima apertura e fa scattare l'interfaccia: l'editor (Monaco e i
 * suoi processi di lavoro), il confronto delle modifiche, le icone dei file, i caratteri dei terminali, il rilevamento delle
 * shell e gli adapter dei plugin con interfaccia. Parte tutto insieme all'avvio e la schermata iniziale ne mostra l'avanzamento
 * (`state/boot.ts`): quando sparisce, aprire un file, un diff o un terminale è immediato.
 */
const FONTS = [
  '400 14px "Geist Variable"',
  '500 14px "Geist Variable"',
  '600 14px "Geist Variable"',
  '400 13px "Geist Mono Variable"',
  '400 14px "JetBrains Mono Variable"',
  '700 14px "JetBrains Mono Variable"',
  'italic 400 14px "JetBrains Mono Variable"',
  'italic 700 14px "JetBrains Mono Variable"'
]

async function loadFonts(): Promise<void> {
  await Promise.all(FONTS.map((f) => document.fonts.load(f).catch(() => [])))
  await document.fonts.ready
}

/** Monaco con il suo tema e i processi di lavoro: si crea (e si distrugge) un modello perché partano. */
async function loadEditor(): Promise<void> {
  await import('@/files/EditorView')
  const { monaco } = await import('@/lib/monaco')
  monaco.editor.createModel('', 'plaintext').dispose()
}

export function preloadAll(): void {
  void trackBoot('fonts', 'Caratteri', loadFonts())
  void trackBoot('editor', 'Editor', loadEditor())
  void trackBoot('diff', 'Confronto delle modifiche', import('@/changes/DiffView'))
  void trackBoot('icons', 'Icone dei file', preloadFileIcons())
  void trackBoot('shells', 'Terminali e shell', Promise.allSettled([api.env.shells(), api.env.claudeCli()]))
  void trackBoot('adapters', 'Avvio dei plugin', api.plugins.warm())
}
