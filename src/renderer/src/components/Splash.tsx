import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import icon from '@/assets/icon-detailed.svg'
import { useBoot } from '@/state/boot'

/** Quanto resta almeno visibile, perché la comparsa non sia un lampo: l'icona e la barra hanno il tempo di animarsi. */
const MIN_VISIBLE_MS = 700
/** Se un caricamento restasse appeso, la schermata non blocca l'app per sempre. */
const MAX_WAIT_MS = 25_000

/**
 * Schermata iniziale con l'icona di Magnolia e una barra di avanzamento: resta finché l'app non ha caricato spazio di lavoro,
 * sessioni, impostazioni e plugin, poi si dissolve. Sotto la barra c'è il caricamento in corso.
 */
export function Splash() {
  // Se c'è la schermata statica di index.html, quella di React ne prende il posto senza rifare l'entrata (niente scatto).
  const [fromStatic] = useState(() => typeof document !== 'undefined' && !!document.getElementById('boot'))
  useEffect(() => {
    const id = window.requestAnimationFrame(() => document.getElementById('boot')?.remove())
    // Se i fotogrammi non arrivano (finestra non visibile) si toglie comunque.
    const t = window.setTimeout(() => document.getElementById('boot')?.remove(), 400)
    return () => {
      window.cancelAnimationFrame(id)
      window.clearTimeout(t)
    }
  }, [])
  const steps = useBoot((s) => s.steps)
  const finished = useBoot((s) => s.finished)
  const [minElapsed, setMinElapsed] = useState(false)
  const [gaveUp, setGaveUp] = useState(false)
  // loading → la barra avanza; done → è al 100% e resta un attimo; leaving → si dissolve; gone → non c'è più. Le fasi
  // si muovono con timer e la dissolvenza è una transizione CSS: non dipendono dai fotogrammi (una finestra non visibile non li produce).
  const [phase, setPhase] = useState<'loading' | 'done' | 'leaving' | 'gone'>('loading')
  useEffect(() => {
    const t = window.setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS)
    const cap = window.setTimeout(() => setGaveUp(true), MAX_WAIT_MS)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(cap)
    }
  }, [])
  useEffect(() => {
    if (phase === 'loading' && (finished || gaveUp) && minElapsed) setPhase('done')
    if (phase !== 'done' && phase !== 'leaving') return
    const t = window.setTimeout(() => setPhase(phase === 'done' ? 'leaving' : 'gone'), phase === 'done' ? 280 : 320)
    return () => window.clearTimeout(t)
  }, [phase, finished, gaveUp, minElapsed])

  const done = steps.filter((s) => s.done).length
  const total = Math.max(steps.length, 1)
  // Mentre si carica la barra non resta ferma a zero: un minimo che cresce con i passi finiti.
  const progress = phase === 'loading' ? Math.min(0.96, 0.08 + (done / total) * 0.88) : 1
  const current = steps.find((s) => !s.done)
  const label = phase !== 'loading' ? 'Pronto' : current ? `${current.label}…` : 'Quasi pronto…'

  return phase === 'gone' ? null : <Overlay progress={progress} label={label} leaving={phase === 'leaving'} instant={fromStatic} />
}

function Overlay({ progress, label, leaving, instant }: { progress: number; label: string; leaving: boolean; instant: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Caricamento di Magnolia"
      style={{ opacity: leaving ? 0 : 1, transition: 'opacity 300ms ease-out', pointerEvents: leaving ? 'none' : 'auto' }}
      className="app-drag fixed inset-0 z-[200] flex flex-col items-center justify-center bg-background"
    >
      {/* Alone dell'ottanio dietro l'icona */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 42%, rgb(22 130 148 / 0.22), transparent 52%)' }} />

      <motion.div
        initial={instant ? false : { opacity: 0, scale: 0.86, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 160, damping: 18 }}
        className="relative"
      >
        <motion.span
          aria-hidden="true"
          className="absolute -inset-3 rounded-[34px] bg-brand/25 blur-2xl"
          animate={{ opacity: [0.45, 0.9, 0.45], scale: [0.96, 1.04, 0.96] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        />
        <img src={icon} alt="" draggable={false} className="relative size-28 drop-shadow-[0_12px_28px_rgb(0_0_0/0.55)]" />
      </motion.div>

      <motion.h1
        initial={instant ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.4 }}
        className="relative mt-6 text-[22px] font-semibold tracking-[0.18em] text-foreground uppercase"
      >
        Magnolia
      </motion.h1>

      <div className="relative mt-8 h-1.5 w-64 overflow-hidden rounded-full bg-surface-2 shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundImage: 'linear-gradient(90deg, #168294, #459ba9)', boxShadow: '0 0 12px rgb(69 155 169 / 0.6)' }}
          initial={{ width: '4%' }}
          animate={{ width: `${Math.round(progress * 100)}%` }}
          transition={{ type: 'spring', stiffness: 90, damping: 20 }}
        />
      </div>
      <p className="relative mt-3 h-4 text-[12px] text-text-faint">{label}</p>
    </div>
  )
}
