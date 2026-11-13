import { create } from 'zustand'
import { cleanBotName, defaultBotIcon, nextBotColor, nextBotName, type Bot } from '@shared/bots'
import { isSpaceColor } from '@shared/spaces'
import { api } from '@/lib/api'
import { useSessions } from '@/state/sessions'

const KEY_BOTS = 'ui.bots'
const KEY_DOCK = 'ui.botDock'
/** Quanti bot «ripresi» ricordare: oltre, si dimenticano i più vecchi. */
const MAX_RESUMED = 300

export interface BotDock {
  side: 'left' | 'right'
  /** Distanza dall'alto, in px. */
  y: number
}

interface BotStore {
  /** Bot delle sessioni di Claude in vita, per id della sessione dell'app. */
  bots: Record<string, Bot>
  /** Bot delle conversazioni di Claude Code, per id di Claude: riprendendo una sessione il bot resta lo stesso. */
  resumed: Record<string, Bot>
  dock: BotDock
  /** Sessione di cui è aperta la mini-chat. */
  popup: string | null
  /** Sessione la cui bolla è ampliata a tutta l'area di lavoro (al posto del pop-up). */
  expanded: string | null
  /** Aprendo la mini-chat parte subito la rinomina. */
  renameOnOpen: boolean
  loaded: boolean
  load(): Promise<void>
  ensure(): void
  rename(sessionId: string, name: string): void
  style(sessionId: string, patch: Partial<Pick<Bot, 'color' | 'icon'>>): void
  setDock(dock: BotDock): void
  open(sessionId: string, opts?: { rename?: boolean }): void
  /** Amplia la bolla a tutta l'area di lavoro / la riporta a pop-up. */
  expand(sessionId: string): void
  collapse(): void
  close(): void
}

export const useBots = create<BotStore>((set, get) => {
  const saveResumed = () => void api.settings.set(KEY_BOTS, { resumed: get().resumed })
  /** Aggiorna il bot di una sessione e, se la conversazione è nota, anche quello salvato per riprenderla. */
  const update = (sessionId: string, fn: (b: Bot) => Bot) => {
    const cur = get().bots[sessionId]
    if (!cur) return
    const next = fn(cur)
    const cid = useSessions.getState().sessions[sessionId]?.claudeSessionId
    set({ bots: { ...get().bots, [sessionId]: next }, ...(cid ? { resumed: { ...get().resumed, [cid]: next } } : {}) })
    if (cid) saveResumed()
  }
  return {
    bots: {},
    resumed: {},
    dock: { side: 'right', y: 150 },
    popup: null,
    expanded: null,
    renameOnOpen: false,
    loaded: false,
    async load() {
      if (get().loaded) return
      set({ loaded: true })
      const [saved, dock] = await Promise.all([api.settings.get(KEY_BOTS), api.settings.get(KEY_DOCK)])
      const resumed = (saved as { resumed?: Record<string, Bot> } | null)?.resumed
      if (resumed && typeof resumed === 'object') set({ resumed })
      const d = dock as Partial<BotDock> | null
      if (d && (d.side === 'left' || d.side === 'right') && typeof d.y === 'number') set({ dock: { side: d.side, y: Math.max(60, d.y) } })
      get().ensure()
    },
    /** Dà un bot a ogni sessione di Claude viva che non ce l'ha e ricorda quello di chi ha un id di conversazione. */
    ensure() {
      const sessions = Object.values(useSessions.getState().sessions).filter((s) => s.kind === 'claude' && s.status !== 'exited')
      let bots = get().bots
      let resumed = get().resumed
      let touched = false
      for (const s of sessions) {
        let bot = bots[s.id]
        if (!bot) {
          const known = s.claudeSessionId ? resumed[s.claudeSessionId] : undefined
          const live = Object.values(bots)
          bot = known && !live.some((b) => b.name === known.name) ? known : { name: nextBotName(live.map((b) => b.name)), color: nextBotColor(live.map((b) => b.color)), icon: '' }
          bot = { ...bot, icon: bot.icon || defaultBotIcon(bot.name) }
          bots = { ...bots, [s.id]: bot }
        }
        if (s.claudeSessionId && resumed[s.claudeSessionId]?.name !== bot.name) {
          resumed = { ...resumed, [s.claudeSessionId]: bot }
          touched = true
        }
      }
      // Sessioni finite: il loro bot non serve più (resta solo quello ricordato per riprenderle).
      const liveIds = new Set(sessions.map((s) => s.id))
      for (const id of Object.keys(bots)) if (!liveIds.has(id)) (bots = { ...bots }), delete bots[id]
      if (touched) {
        const keys = Object.keys(resumed)
        if (keys.length > MAX_RESUMED) resumed = Object.fromEntries(keys.slice(-MAX_RESUMED).map((k) => [k, resumed[k]]))
      }
      set({ bots, resumed })
      if (touched) saveResumed()
    },
    rename(sessionId, name) {
      const clean = cleanBotName(name)
      if (clean) update(sessionId, (b) => ({ ...b, name: clean, icon: b.icon === defaultBotIcon(b.name) ? defaultBotIcon(clean) : b.icon }))
    },
    style(sessionId, patch) {
      update(sessionId, (b) => ({
        ...b,
        color: patch.color && isSpaceColor(patch.color) ? patch.color : b.color,
        icon: patch.icon !== undefined ? Array.from(patch.icon.trim())[0] ?? defaultBotIcon(b.name) : b.icon
      }))
    },
    setDock(dock) {
      set({ dock })
      void api.settings.set(KEY_DOCK, dock)
    },
    open(sessionId, opts) {
      set({ popup: sessionId, expanded: null, renameOnOpen: Boolean(opts?.rename) })
    },
    expand(sessionId) {
      set({ popup: null, expanded: sessionId, renameOnOpen: false })
    },
    collapse() {
      const id = get().expanded
      set({ popup: id, expanded: null })
    },
    close() {
      set({ popup: null, expanded: null, renameOnOpen: false })
    }
  }
})

/** Il bot di una sessione (se è una sessione di Claude). */
export const useBot = (sessionId: string | undefined): Bot | undefined => useBots((s) => (sessionId ? s.bots[sessionId] : undefined))

/** Nome da mostrare per una sessione: quello del bot, altrimenti il suo titolo. */
export function botNameOf(sessionId: string, fallback: string): string {
  return useBots.getState().bots[sessionId]?.name ?? fallback
}

let started = false
/** Assegna i bot alle sessioni quando arrivano e li ripulisce quando finiscono. */
export function startBots(): void {
  if (started) return
  started = true
  void useBots.getState().load()
  useSessions.subscribe((s, prev) => {
    if (s.sessions !== prev.sessions) useBots.getState().ensure()
  })
}
