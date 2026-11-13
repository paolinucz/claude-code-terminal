import { create } from 'zustand'
import type { SerializedLayout, Space } from '@shared/types'
import { defaultSpaceIcon, isSpaceColor, nextSpaceColor, SPACE_COLORS } from '@shared/spaces'
import { api } from '@/lib/api'
import { pushMessage } from '@/state/messages'

/**
 * Finestra di uno spazio solo (`?space=<id>`, «Apri in una nuova finestra»): mostra quello spazio e non modifica l'elenco degli
 * spazi né l'attivo (lo fa la finestra principale); salva soltanto il layout, come sempre.
 */
export const SOLO_SPACE_ID: string | null = new URLSearchParams(window.location.search).get('space')

/** Spazi predefiniti (L1). L'id (fino ai due punti) decide anche il layout iniziale (vedi workspace/panels.ts). */
export const DEFAULT_SPACES: Space[] = [
  { id: 'sviluppo', name: 'Sviluppo', contextId: null, layout: null, icon: 'S', color: SPACE_COLORS[0] },
  { id: 'revisione', name: 'Revisione', contextId: null, layout: null, icon: 'R', color: SPACE_COLORS[1] },
  { id: 'debug', name: 'Debug', contextId: null, layout: null, icon: 'D', color: SPACE_COLORS[2] }
]

const PRESETS = [
  { preset: 'sviluppo', name: 'Sviluppo' },
  { preset: 'revisione', name: 'Revisione' },
  { preset: 'debug', name: 'Debug' }
]

/** Spazi di un contesto (`null` = spazi senza progetto, come nella 1.0). */
export function spacesOf(spaces: Space[], contextId: string | null): Space[] {
  return spaces.filter((s) => (s.contextId ?? null) === contextId)
}

interface WorkspaceStore {
  loaded: boolean
  /** Tutti gli spazi di tutti i contesti: restano montati anche se non visibili, così le sessioni non si interrompono. */
  spaces: Space[]
  activeSpaceId: string
  /** Contesto attivo (J5): la barra in alto mostra solo i suoi spazi. */
  contextId: string | null
  /** Numero di pannelli per spazio, aggiornato da SpaceView a ogni cambio di layout. */
  panelCounts: Record<string, number>
  /** Quali sessioni sono aperte in ogni spazio (firma dei pannelli): cambia solo quando cambia l'elenco, non a ogni ridimensionamento. */
  panelSigs: Record<string, string>
  /** Spazi aperti in un'altra finestra: qui non si monta il loro Dockview (un solo proprietario). */
  externalSpaces: string[]
  /** Aggiorna l'elenco; quando uno spazio torna qui, ne rilegge il layout salvato dalla finestra che lo teneva. */
  setExternalSpaces(ids: string[]): Promise<void>
  load(): Promise<void>
  setActive(id: string): void
  /** Passa a un contesto: riapre il suo ultimo spazio e, se non ne ha, crea Sviluppo, Revisione e Debug. */
  setContext(contextId: string | null): void
  /** Il primo contesto di un progetto prende gli spazi aperti finora (senza contesto) per non perdere il lavoro. */
  adoptLooseSpaces(contextId: string): void
  /** Chiude gli spazi di un contesto eliminato. */
  removeContextSpaces(contextId: string): void
  addSpace(): string
  /** Nuovo spazio con la stessa disposizione dei pannelli di `id` (senza le sessioni). */
  duplicateSpace(id: string, layout: SerializedLayout | null): string
  renameSpace(id: string, name: string): void
  /** Icona (una lettera o un simbolo) e/o colore (della palette) di uno spazio. */
  styleSpace(id: string, style: { icon?: string; color?: string }): void
  closeSpace(id: string): void
  moveSpace(id: string, toIndex: number): void
  /** Messaggio breve per l'utente (layout salvato, ecc.): compare come toast. */
  setStatus(message: string): void
  setPanelCount(spaceId: string, count: number, sig?: string): void
}

function persist(spaces: Space[], activeSpaceId: string): void {
  if (SOLO_SPACE_ID) return
  void api.workspace.saveSpaces(
    spaces.map(({ id, name, contextId, icon, color }) => ({ id, name, contextId, icon, color })),
    activeSpaceId
  )
}

function nextSpaceName(spaces: Space[]): string {
  const names = new Set(spaces.map((s) => s.name.toLowerCase()))
  let n = spaces.length + 1
  while (names.has(`spazio ${n}`)) n++
  return `Spazio ${n}`
}

/** Spazi iniziali di un contesto: stessi nomi e layout di quelli predefiniti, con id propri. */
function defaultSpacesFor(contextId: string | null, taken: Set<string>): Space[] {
  const colors: string[] = []
  return PRESETS.map(({ preset, name }) => {
    const id = contextId === null && !taken.has(preset) ? preset : `${preset}:${crypto.randomUUID().slice(0, 8)}`
    const color = nextSpaceColor(colors)
    colors.push(color)
    return { id, name, contextId, layout: null, icon: defaultSpaceIcon(name), color }
  })
}

/** Icona valida: una sola lettera/simbolo (anche emoji), senza spazi. */
export function cleanIcon(icon: string | undefined, fallbackName: string): string {
  const first = Array.from((icon ?? '').trim())[0]
  return first ?? defaultSpaceIcon(fallbackName)
}

export const useWorkspace = create<WorkspaceStore>((set, get) => {
  /** Ultimo spazio attivo di ogni contesto (chiave `''` per nessun contesto). Solo in memoria. */
  const lastSpace = new Map<string, string>()

  return {
    loaded: false,
    spaces: [],
    activeSpaceId: '',
    contextId: null,
    panelCounts: {},
    panelSigs: {},
    externalSpaces: [],

    async setExternalSpaces(ids) {
      const back = get().externalSpaces.filter((id) => !ids.includes(id))
      if (back.length > 0) {
        // Il layout più recente l'ha salvato l'altra finestra nel database: si rilegge prima di rimontare lo spazio.
        const state = await api.workspace.load()
        const fresh = new Map(state.spaces.map((s) => [s.id, s.layout]))
        set({ spaces: get().spaces.map((s) => (back.includes(s.id) && fresh.has(s.id) ? { ...s, layout: fresh.get(s.id) ?? null } : s)) })
      }
      set({ externalSpaces: ids })
    },

    async load() {
      const state = await api.workspace.load()
      let spaces = state.spaces.map((s, i): Space => ({
        ...s,
        contextId: s.contextId ?? null,
        icon: cleanIcon(s.icon, s.name),
        color: isSpaceColor(s.color) ? s.color : SPACE_COLORS[i % SPACE_COLORS.length]
      }))
      if (spaces.length === 0) spaces = DEFAULT_SPACES
      // Il contesto attivo si decide dopo, quando il progetto è aperto: all'inizio vale «nessun contesto».
      const persisted = spaces.find((s) => s.id === state.activeSpaceId)
      if (persisted?.contextId) lastSpace.set(persisted.contextId, persisted.id)
      if (spacesOf(spaces, null).length === 0) {
        spaces = [...spaces, ...defaultSpacesFor(null, new Set(spaces.map((s) => s.id)))]
      }
      const loose = spacesOf(spaces, null)
      const activeSpaceId = persisted && !persisted.contextId ? persisted.id : loose[0].id
      persist(spaces, activeSpaceId)
      if (SOLO_SPACE_ID && spaces.some((s) => s.id === SOLO_SPACE_ID)) {
        set({ loaded: true, spaces, activeSpaceId: SOLO_SPACE_ID, contextId: spaces.find((s) => s.id === SOLO_SPACE_ID)?.contextId ?? null })
        return
      }
      set({ loaded: true, spaces, activeSpaceId, contextId: null })
      void api.windows.externalSpaces().then((ids) => set({ externalSpaces: ids }))
    },

    setActive(id) {
      const space = get().spaces.find((s) => s.id === id)
      if (space) lastSpace.set(space.contextId ?? '', id)
      set({ activeSpaceId: id })
      persist(get().spaces, id)
    },

    setContext(contextId) {
      if (SOLO_SPACE_ID) return
      let spaces = get().spaces
      if (spacesOf(spaces, contextId).length === 0) {
        spaces = [...spaces, ...defaultSpacesFor(contextId, new Set(spaces.map((s) => s.id)))]
      }
      const mine = spacesOf(spaces, contextId)
      const remembered = lastSpace.get(contextId ?? '')
      const active = mine.find((s) => s.id === remembered) ?? mine[0]
      set({ spaces, contextId, activeSpaceId: active.id })
      persist(spaces, active.id)
    },

    adoptLooseSpaces(contextId) {
      const spaces = get().spaces.map((s) => (s.contextId ? s : { ...s, contextId }))
      const active = get().activeSpaceId
      set({ spaces })
      persist(spaces, active)
    },

    removeContextSpaces(contextId) {
      const spaces = get().spaces.filter((s) => s.contextId !== contextId)
      lastSpace.delete(contextId)
      set({ spaces })
      persist(spaces, get().activeSpaceId)
    },

    addSpace() {
      const { contextId } = get()
      const mine = spacesOf(get().spaces, contextId)
      const name = nextSpaceName(mine)
      const space: Space = {
        id: crypto.randomUUID(),
        name,
        contextId,
        layout: null,
        icon: defaultSpaceIcon(name),
        color: nextSpaceColor(mine.map((s) => s.color))
      }
      const spaces = [...get().spaces, space]
      lastSpace.set(contextId ?? '', space.id)
      set({ spaces, activeSpaceId: space.id })
      persist(spaces, space.id)
      return space.id
    },

    duplicateSpace(id, layout) {
      const { contextId } = get()
      const source = get().spaces.find((s) => s.id === id)
      const mine = spacesOf(get().spaces, contextId)
      const name = `${source?.name ?? 'Spazio'} (copia)`
      const space: Space = {
        id: crypto.randomUUID(),
        name,
        contextId,
        layout,
        icon: source?.icon ?? defaultSpaceIcon(name),
        color: nextSpaceColor(mine.map((s) => s.color))
      }
      const spaces = [...get().spaces, space]
      lastSpace.set(contextId ?? '', space.id)
      set({ spaces, activeSpaceId: space.id })
      persist(spaces, space.id)
      // Il layout copiato si salva subito: lo spazio nuovo parte con la stessa disposizione.
      if (layout) void api.workspace.saveSpaceLayout(space.id, layout)
      return space.id
    },

    renameSpace(id, name) {
      const clean = name.trim()
      if (!clean) return
      const spaces = get().spaces.map((s) => (s.id === id ? { ...s, name: clean } : s))
      set({ spaces })
      persist(spaces, get().activeSpaceId)
    },

    styleSpace(id, style) {
      const spaces = get().spaces.map((s) => {
        if (s.id !== id) return s
        return {
          ...s,
          icon: style.icon !== undefined ? cleanIcon(style.icon, s.name) : s.icon,
          color: style.color !== undefined && isSpaceColor(style.color) ? style.color : s.color
        }
      })
      set({ spaces })
      persist(spaces, get().activeSpaceId)
    },

    closeSpace(id) {
      const { spaces, activeSpaceId, contextId } = get()
      const mine = spacesOf(spaces, contextId)
      if (mine.length <= 1) return
      const index = mine.findIndex((s) => s.id === id)
      const rest = spaces.filter((s) => s.id !== id)
      const mineRest = mine.filter((s) => s.id !== id)
      const nextActive = activeSpaceId === id ? mineRest[Math.max(0, index - 1)].id : activeSpaceId
      lastSpace.set(contextId ?? '', nextActive)
      set({ spaces: rest, activeSpaceId: nextActive })
      persist(rest, nextActive)
    },

    moveSpace(id, toIndex) {
      const { spaces, contextId } = get()
      const mine = [...spacesOf(spaces, contextId)]
      const from = mine.findIndex((s) => s.id === id)
      if (from < 0) return
      const [item] = mine.splice(from, 1)
      mine.splice(Math.max(0, Math.min(toIndex, mine.length)), 0, item)
      const next = [...spaces.filter((s) => (s.contextId ?? null) !== contextId), ...mine]
      set({ spaces: next })
      persist(next, get().activeSpaceId)
    },

    setStatus(message) {
      pushMessage(message)
    },

    setPanelCount(spaceId, count, sig = '') {
      const s = get()
      if (s.panelCounts[spaceId] === count && s.panelSigs[spaceId] === sig) return
      set({ panelCounts: { ...s.panelCounts, [spaceId]: count }, panelSigs: { ...s.panelSigs, [spaceId]: sig } })
    }
  }
})
