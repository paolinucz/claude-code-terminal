import { Ban, CircleHelp, Lightbulb, ThumbsUp } from 'lucide-react'
import type { ReviewKind } from '@shared/changes'

const ICONS = { warn: Lightbulb, danger: Ban, info: CircleHelp, ok: ThumbsUp } as const
const COLORS = { warn: 'text-warn', danger: 'text-danger', info: 'text-info', ok: 'text-ok' } as const
export const TONE_BORDER = { warn: 'border-border', danger: 'border-danger/40', info: 'border-info/40', ok: 'border-ok/40' } as const
export const TONE_LABEL = { warn: 'Giallo', danger: 'Rosso', info: 'Blu', ok: 'Verde' } as const

/** Icona colorata di un tipo di nota. */
export function ToneIcon({ tone = 'info', size = 14, className = '' }: { tone?: ReviewKind['tone']; size?: number; className?: string }) {
  const Icon = ICONS[tone]
  return <Icon size={size} className={`shrink-0 ${COLORS[tone]} ${className}`} />
}
