import type { AppApi } from '../shared/types'

declare global {
  interface Window {
    /** Presente solo in Electron. Nel browser si usa il fallback di src/renderer/src/lib/api.ts. */
    api?: AppApi
  }
}

export {}
