import { useEffect, useState } from 'react'
import type { ChatItem } from '@shared/transcript'
import { cn } from '@/lib/cn'

export type ToolItem = ChatItem & { kind: 'tool' }

export const timeOf = (ts?: string) => (ts ? new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '')

/** «1 min 12 s», «45 s». */
export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${s % 60} s`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

/** «850», «3,4k», «1,2M». */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace('.', ',').replace(/,0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
}

const SPIN = ['✻', '✺', '✹', '✸', '✷', '✶']
/** Asterisco animato, come quello di Claude Code mentre lavora. */
export function Spinner() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setI((n) => (n + 1) % SPIN.length), 160)
    return () => window.clearInterval(t)
  }, [])
  return <span className="inline-block w-4 text-center text-brand">{SPIN[i]}</span>
}

/** Puntino a sinistra di ogni voce: pieno e acceso a fine lavoro, rosso se fallita, lampeggiante mentre gira. */
export function Dot({ state }: { state: 'run' | 'ok' | 'err' | 'text' | 'quiet' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-[3px] w-4 shrink-0 text-center leading-none select-none',
        state === 'run' && 'animate-pulse text-brand',
        state === 'ok' && 'text-ok',
        state === 'err' && 'text-danger',
        state === 'text' && 'text-foreground',
        state === 'quiet' && 'text-text-faint'
      )}
    >
      ●
    </span>
  )
}
