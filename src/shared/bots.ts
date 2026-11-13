// Bot: ogni sessione di Claude ha un nome, un colore e un'icona, così si riconosce a colpo d'occhio (bolle, schede, notifiche).
import { SPACE_COLORS } from './spaces'

/** Nomi dei bot: brevi, facili da dire e da distinguere. Finiti questi, «Bot 13», «Bot 14»… */
export const BOT_NAMES = ['Atlas', 'Luna', 'Pixel', 'Nova', 'Ziggy', 'Orion', 'Mochi', 'Iris', 'Rocky', 'Fuji', 'Zeno', 'Pepe', 'Sirio', 'Tango', 'Ombra', 'Briciola'] as const

export interface Bot {
  name: string
  /** Colore della bolla (la stessa palette degli spazi). */
  color: string
  /** Una lettera o un simbolo; predefinita l'iniziale del nome. */
  icon: string
}

/** Primo nome non in uso; se sono finiti tutti, «Bot N». */
export function nextBotName(used: readonly string[]): string {
  const taken = new Set(used.map((n) => n.toLowerCase()))
  const free = BOT_NAMES.find((n) => !taken.has(n.toLowerCase()))
  if (free) return free
  let n = used.length + 1
  while (taken.has(`bot ${n}`)) n++
  return `Bot ${n}`
}

/** Colore meno usato tra quelli dei bot attuali (a parità, il primo della palette). */
export function nextBotColor(used: readonly string[]): string {
  const count = (c: string) => used.filter((u) => u.toLowerCase() === c.toLowerCase()).length
  return [...SPACE_COLORS].sort((a, b) => count(a) - count(b))[0]
}

export const defaultBotIcon = (name: string): string => (Array.from(name.trim())[0] ?? '•').toUpperCase()

/** Nome pulito per salvare: senza spazi ai bordi, al massimo 24 caratteri. */
export const cleanBotName = (name: string): string => name.trim().replace(/\s+/g, ' ').slice(0, 24)
