/** Prompt predefinito: un messaggio pronto da mandare a Claude con un clic dalla palette comandi. */
export interface PromptPreset {
  id: string
  name: string
  text: string
}

/** Quanti prompt predefiniti al massimo e quanto lunghi (per non gonfiare le impostazioni). */
export const PRESET_LIMITS = { count: 100, name: 60, text: 20_000 } as const

/** Esempi proposti la prima volta: si possono modificare o togliere. */
export const DEFAULT_PRESETS: PromptPreset[] = [
  {
    id: 'default-riassunto',
    name: 'Riassumi le modifiche',
    text: 'Riassumi in modo breve le modifiche fatte finora in questa sessione: elenca i file toccati e il motivo di ciascuna.'
  },
  {
    id: 'default-test',
    name: 'Esegui i test e correggi',
    text: 'Esegui i test del progetto. Se ci sono errori, correggili e rilancia i test. Alla fine spiegami cosa hai cambiato.'
  },
  {
    id: 'default-revisione',
    name: 'Rivedi il codice',
    text: 'Rivedi le modifiche non ancora committate: cerca bug, casi limite non gestiti e codice duplicato. Non modificare nulla: elenca solo i problemi, dal più grave.'
  },
  {
    id: 'default-panoramica',
    name: 'Spiega il progetto',
    text: 'Dammi una panoramica del progetto: struttura delle cartelle, moduli principali e come si avvia.'
  }
]

/** Rende valido ciò che arriva dalle impostazioni: scarta voci rotte e taglia i testi troppo lunghi. */
export function sanitizePresets(raw: unknown): PromptPreset[] | null {
  if (!Array.isArray(raw)) return null
  const out: PromptPreset[] = []
  for (const p of raw) {
    if (typeof p !== 'object' || p === null) continue
    const { id, name, text } = p as Record<string, unknown>
    if (typeof id !== 'string' || typeof name !== 'string' || typeof text !== 'string') continue
    if (!name.trim() || !text.trim()) continue
    out.push({ id, name: name.trim().slice(0, PRESET_LIMITS.name), text: text.slice(0, PRESET_LIMITS.text) })
  }
  return out.slice(0, PRESET_LIMITS.count)
}

/** Una riga sola, per mostrare un'anteprima del testo. */
export const previewOf = (text: string, max = 70): string => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1) + '…' : one
}
