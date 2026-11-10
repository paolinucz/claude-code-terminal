import { useEffect, useRef } from 'react'
import { IS_WIN, normPath, type GitMark } from '@shared/files'
import { pluginUiUrl } from '@shared/plugins'
import { api } from '@/lib/api'
import { openFile } from '@/state/editor'
import { useAccent } from '@/state/accent'

/** Cosa l'Esplora file sa dei file, in percorsi normalizzati (stessa regola di `normPath`): git, Claude, errori. */
export interface ExplorerDecor {
  git: Record<string, GitMark>
  claude: string[]
  errors: Record<string, number>
}

/** Variabili CSS dell'app che la pagina del plugin riceve, per avere lo stesso tema (e il colore d'accento scelto). */
const THEME_VARS = ['--cct-bg', '--cct-surface', '--cct-surface-2', '--cct-border', '--cct-border-strong', '--cct-text', '--cct-text-muted', '--cct-text-faint', '--cct-accent', '--cct-accent-soft', '--cct-on-accent', '--cct-ok', '--cct-warn', '--cct-danger', '--cct-info']
const themeNow = () => {
  const cs = getComputedStyle(document.documentElement)
  return Object.fromEntries(THEME_VARS.map((v) => [v, cs.getPropertyValue(v).trim()]))
}

/**
 * Pagina di un plugin dentro l'app (contributi, docs/plugin-contributi.md). Gira in un iframe isolato: senza
 * `allow-same-origin`, quindi senza accesso all'app, ai cookie o alla rete. Parla solo con questi messaggi:
 *
 * - dalla pagina: `{cct:'ready'}` e `{cct:'rpc', id, method, params}` con metodi `files.index`, `editor.open`,
 *   `files.reveal`, `clipboard.copy` e `plugin.call {method, params}` (una richiesta all'adapter del proprio plugin);
 * - verso la pagina: `{cct:'init', win, cwd, theme}`, `{cct:'state', decor}`, `{cct:'event', event, data}` (dall'adapter
 *   del plugin) e `{cct:'rpc-result', id, ok, value|error}`.
 *
 * L'app non sa cosa mostri il plugin: questi sono gli unici servizi che gli dà.
 */
export function PluginFrame({ pluginId, entry, cwd, decor }: { pluginId: string; entry: string; cwd: string; decor: ExplorerDecor }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const decorRef = useRef(decor)
  decorRef.current = decor
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd
  const ready = useRef(false)

  const post = (msg: unknown) => frame.current?.contentWindow?.postMessage(msg, '*')

  useEffect(() => {
    ready.current = false
    const inProject = (p: unknown) => typeof p === 'string' && (normPath(p) + '\\').startsWith(normPath(cwdRef.current) + '\\')
    const onMessage = async (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== 'object') return
      const m = e.data as { cct?: string; id?: number; method?: string; params?: Record<string, unknown> }
      if (m.cct === 'ready') {
        ready.current = true
        post({ cct: 'init', win: IS_WIN, cwd: cwdRef.current, theme: themeNow() })
        post({ cct: 'state', decor: decorRef.current })
        return
      }
      if (m.cct !== 'rpc' || typeof m.id !== 'number') return
      const reply = (ok: boolean, value?: unknown, error?: string) => post({ cct: 'rpc-result', id: m.id, ok, value, error })
      try {
        const p = m.params ?? {}
        switch (m.method) {
          // Solo la cartella dell'Esplora file: il plugin non sceglie quale elenco leggere.
          case 'files.index':
            return reply(true, await api.files.index(cwdRef.current))
          case 'editor.open':
            if (!inProject(p.path)) return reply(false, undefined, 'File fuori dal progetto')
            openFile(p.path as string, undefined, cwdRef.current)
            return reply(true)
          case 'files.reveal':
            if (!inProject(p.path)) return reply(false, undefined, 'File fuori dal progetto')
            await api.files.reveal(p.path as string)
            return reply(true)
          // La pagina parla con l'adapter del proprio plugin, mai con quello di altri.
          case 'plugin.call':
            return reply(true, await api.plugins.call(pluginId, String(p.method ?? ''), (p.params as Record<string, unknown>) ?? {}))
          case 'clipboard.copy':
            await navigator.clipboard.writeText(String(p.text ?? '').slice(0, 10_000))
            return reply(true)
          default:
            return reply(false, undefined, `Metodo sconosciuto: ${String(m.method)}`)
        }
      } catch (err) {
        reply(false, undefined, (err as Error).message)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [pluginId, entry])

  // Eventi dell'adapter del plugin (avanzamento, stato del debug…): arrivano alla pagina così come sono.
  useEffect(
    () => api.plugins.onEvent((e) => e.pluginId === pluginId && post({ cct: 'event', event: e.event, data: e.data })),
    [pluginId]
  )

  // Le novità (git, revisioni di Claude, errori) e il cambio di colore d'accento arrivano alla pagina già aperta.
  useEffect(() => {
    if (ready.current) post({ cct: 'state', decor })
  }, [decor])
  const accent = useAccent((s) => s.accent)
  useEffect(() => {
    if (ready.current) post({ cct: 'init', win: IS_WIN, cwd, theme: themeNow() })
  }, [accent, cwd])

  return (
    <iframe
      ref={frame}
      key={`${pluginId}/${entry}`}
      title={`Vista del plugin ${pluginId}`}
      src={pluginUiUrl(pluginId, entry)}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className="h-full w-full border-0 bg-surface"
    />
  )
}
