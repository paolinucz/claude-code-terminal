import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAppearance } from '@/state/appearance'

/** In modalità «Solo quando inattivo» lo sfondo si muove dopo tanti secondi senza input. */
const IDLE_MS = 30_000

/**
 * Perché lo sfondo sta fermo (o si muove): finestra senza focus o nascosta, PC a batteria, «riduci animazioni» del sistema,
 * oppure, in modalità «Solo quando inattivo», input recente. Restituisce `true` se le animazioni vanno in pausa.
 */
function useMotionPaused(idleOnly: boolean): boolean {
  const [blurred, setBlurred] = useState(() => !document.hasFocus() || document.hidden)
  const [battery, setBattery] = useState(false)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const update = () => setBlurred(!document.hasFocus() || document.hidden)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  useEffect(() => {
    let alive = true
    void api.power.onBattery().then((b) => alive && setBattery(b))
    const off = api.power.onChanged(setBattery)
    return () => {
      alive = false
      off()
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    if (!idleOnly) {
      setBusy(false)
      return
    }
    let last = Date.now()
    const touch = () => {
      last = Date.now()
      setBusy(true)
    }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const
    for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true })
    const timer = window.setInterval(() => setBusy(Date.now() - last < IDLE_MS), 1000)
    setBusy(false)
    return () => {
      for (const e of events) window.removeEventListener(e, touch, { capture: true })
      window.clearInterval(timer)
    }
  }, [idleOnly])

  return blurred || battery || reduced || busy
}

/**
 * Sfondo dell'app (DESIGN.md §Sfondo animato): nero puro con un unico livello decorativo sotto tutta l'interfaccia —
 * pavimento a griglia in prospettiva, alone che pulsa e sfera wireframe con impulsi di luce. Non riceve input e non è
 * letto dagli screen reader. Anima solo transform, opacity e stroke-dashoffset (niente layout) e va in pausa quando non serve.
 */
export function AppBackground() {
  const mode = useAppearance((s) => s.background)
  const paused = useMotionPaused(mode === 'idle')
  if (mode === 'never') return null
  return (
    <div className="mg-bg" aria-hidden="true" data-motion={paused ? 'paused' : 'run'}>
      <div className="mg-bg-glow" />
      <svg className="mg-bg-sphere" viewBox="-250 -250 500 500" fill="none">
        <g className="mg-bg-sphere-spin mg-bg-orbits">
          <circle r="220" />
          {[0, 30, 60, 90, 120, 150].map((deg) => (
            <ellipse key={deg} rx="220" ry="70" transform={`rotate(${deg})`} />
          ))}
          <ellipse rx="220" ry="150" />
          <ellipse rx="220" ry="215" opacity="0.6" />
        </g>
        <g className="mg-bg-sphere-spin mg-bg-pulses">
          <ellipse className="mg-bg-pulse mg-bg-pulse-a" rx="220" ry="70" transform="rotate(30)" pathLength="100" />
          <ellipse className="mg-bg-pulse mg-bg-pulse-b" rx="220" ry="70" transform="rotate(120)" pathLength="100" />
          <circle className="mg-bg-pulse mg-bg-pulse-c" r="220" pathLength="100" />
        </g>
      </svg>
      <div className="mg-bg-floor">
        <div className="mg-bg-grid" />
      </div>
    </div>
  )
}
