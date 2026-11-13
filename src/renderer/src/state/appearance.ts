import { create } from 'zustand'
import { api } from '@/lib/api'

/** Quando lo sfondo animato si muove: sempre, solo se non c'è input da 30 s, mai. */
export type BackgroundMode = 'always' | 'idle' | 'never'
export const BACKGROUND_MODES: { id: BackgroundMode; label: string }[] = [
  { id: 'always', label: 'Sempre' },
  { id: 'idle', label: 'Solo quando inattivo' },
  { id: 'never', label: 'Mai' }
]

/** Come si lavora con Claude: terminali in schede nel layout, oppure bolle (e un workspace vuoto). Le due modalità sono separate. */
export type ClaudeMode = 'tabs' | 'bubbles'
export const CLAUDE_MODES: { id: ClaudeMode; label: string }[] = [
  { id: 'tabs', label: 'Schede' },
  { id: 'bubbles', label: 'Bolle' }
]

/** Font della vista grafica della conversazione: JetBrains Mono (come il terminale) o Geist. */
export type ChatFont = 'mono' | 'sans'
export const CHAT_FONTS: { id: ChatFont; label: string }[] = [
  { id: 'mono', label: 'JetBrains Mono' },
  { id: 'sans', label: 'Geist' }
]

const KEY_CLAUDE_MODE = 'ui.claudeMode'
const KEY_CHAT_FONT = 'ui.chatFont'
const KEY_BACKGROUND = 'ui.background'
const KEY_GLASS = 'ui.glass'

interface AppearanceStore {
  background: BackgroundMode
  /** Effetto vetro (trasparenza e sfocatura). Spento = fondi opachi equivalenti. */
  glass: boolean
  chatFont: ChatFont
  claudeMode: ClaudeMode
  loaded: boolean
  /** Le impostazioni sono state lette (la modalità di Claude decide cosa montare all'avvio). */
  ready: boolean
  load(): Promise<void>
  setBackground(mode: BackgroundMode): void
  setGlass(on: boolean): void
  setChatFont(f: ChatFont): void
  /** Solo l'impostazione: per cambiare modalità con le sessioni vive usa `switchClaudeMode` (workspace/claudeMode.ts). */
  setClaudeMode(m: ClaudeMode): void
}

/** Siamo in modalità Bolle? (Fuori da React: `isBubbleMode()`.) */
export const isBubbleMode = (): boolean => useAppearance.getState().claudeMode === 'bubbles'

/** Il CSS legge `html[data-glass]`: con «off» tutte le classi .mg-glass-* tornano ai fondi opachi. */
function applyGlass(on: boolean): void {
  document.documentElement.dataset.glass = on ? 'on' : 'off'
}

/** Il CSS legge `html[data-chat-font]` (vedi `.cct-chat` in styles.css). */
function applyChatFont(f: ChatFont): void {
  document.documentElement.dataset.chatFont = f
}

export const useAppearance = create<AppearanceStore>((set, get) => ({
  background: 'always',
  glass: true,
  chatFont: 'mono',
  claudeMode: 'tabs',
  loaded: false,
  ready: false,
  async load() {
    if (get().loaded) return
    set({ loaded: true })
    const [bg, glass, font, mode] = await Promise.all([api.settings.get(KEY_BACKGROUND), api.settings.get(KEY_GLASS), api.settings.get(KEY_CHAT_FONT), api.settings.get(KEY_CLAUDE_MODE)])
    if (mode === 'tabs' || mode === 'bubbles') set({ claudeMode: mode })
    if (bg === 'always' || bg === 'idle' || bg === 'never') set({ background: bg })
    if (typeof glass === 'boolean') set({ glass })
    if (font === 'mono' || font === 'sans') set({ chatFont: font })
    applyGlass(get().glass)
    applyChatFont(get().chatFont)
    set({ ready: true })
  },
  setBackground(mode) {
    set({ background: mode })
    void api.settings.set(KEY_BACKGROUND, mode)
  },
  setClaudeMode(m) {
    set({ claudeMode: m })
    void api.settings.set(KEY_CLAUDE_MODE, m)
  },
  setChatFont(f) {
    set({ chatFont: f })
    applyChatFont(f)
    void api.settings.set(KEY_CHAT_FONT, f)
  },
  setGlass(on) {
    set({ glass: on })
    applyGlass(on)
    void api.settings.set(KEY_GLASS, on)
  }
}))
