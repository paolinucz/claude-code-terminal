// Spazi di lavoro (ex «fogli»): palette e valori predefiniti, condivisi tra l'interfaccia e il database (migrazione).

/** Palette fissa degli spazi: 6 colori smorzati. Non include l'ottanio, che è l'accento dell'app. */
export const SPACE_COLORS = ['#8B93E8', '#D9A35E', '#7FB89A', '#C98BB9', '#6FA8C9', '#B5A28A'] as const

/** Icona predefinita di uno spazio: l'iniziale del nome (una lettera o un simbolo). */
export function defaultSpaceIcon(name: string): string {
  const first = Array.from(name.trim())[0]
  return (first ?? '•').toUpperCase()
}

/** Primo colore della palette non usato dagli altri spazi; se sono finiti, si riparte in ordine. */
export function nextSpaceColor(taken: readonly string[]): string {
  const used = new Set(taken.map((c) => c.toLowerCase()))
  return SPACE_COLORS.find((c) => !used.has(c.toLowerCase())) ?? SPACE_COLORS[taken.length % SPACE_COLORS.length]
}

/** Vero se il valore è un colore della palette. */
export const isSpaceColor = (c: unknown): c is (typeof SPACE_COLORS)[number] => typeof c === 'string' && SPACE_COLORS.some((x) => x.toLowerCase() === c.toLowerCase())
