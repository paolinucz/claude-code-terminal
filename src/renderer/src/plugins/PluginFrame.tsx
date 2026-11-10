import { useEffect, useRef } from 'react'
import { IS_WIN, normPath, type GitMark } from '@shared/files'
import { pluginUiUrl, type PluginPermission } from '@shared/plugins'
import { api } from '@/lib/api'
import { openFile } from '@/state/editor'
import { useAccent } from '@/state/accent'
import { openPluginPage, pluginConfirm, pluginNotify, pluginPrompt, usePluginUi } from '@/state/pluginUi'
import { useSessions } from '@/state/sessions'
import { hasPermission, parseHive, pluginName, settingKey, showHive, showSessionTerminal } from './pluginBridge'

/** Cosa l'Esplora file sa dei file, in percorsi normalizzati (stessa regola di `normPath`): git, Claude, errori. */
export interface ExplorerDecor {
  git: Record<string, GitMark>
  claude: string[]
  errors: Record<string, number>
}

/** Nessun segno sui file: per le pagine che non sono una vista dell'Esplora file. */
export const EMPTY_DECOR: ExplorerDecor = { git: {}, claude: [], errors: {} }

/** Variabili CSS dell'app che la pagina del plugin riceve, per avere lo stesso tema (e il colore d'accento scelto). */
const THEME_VARS = ['--cct-bg', '--cct-surface', '--cct-surface-2', '--cct-border', '--cct-border-strong', '--cct-text', '--cct-text-muted', '--cct-text-faint', '--cct-accent', '--cct-accent-soft', '--cct-on-accent', '--cct-ok', '--cct-warn', '--cct-danger', '--cct-info']
const themeNow = () => {
  const cs = getComputedStyle(document.documentElement)
  return Object.fromEntries(THEME_VARS.map((v) => [v, cs.getPropertyValue(v).trim()]))
}

/**
 * Pagina di un plugin dentro l'app (contributi). Gira in un iframe isolato: senza `allow-same-origin`, quindi senza
 * accesso all'app, ai cookie o alla rete. Parla solo con messaggi; metodi, eventi e permessi sono in
 * docs/PLUGIN_API_DOCS.md (§3–§6), che è il riferimento: se aggiungi un metodo qui, aggiorna il documento.
 *
 * L'app non sa cosa mostri il plugin: questi sono gli unici servizi che gli dà.
 */
export function PluginFrame({ pluginId, entry, cwd, decor, modalId, params }: { pluginId: string; entry: string; cwd: string; decor: ExplorerDecor; modalId?: number; params?: unknown }) {
  const initMsg = () => ({ cct: 'init', win: IS_WIN, cwd: cwdRef.current, theme: themeNow(), plugin: { id: pluginId, name: pluginName(pluginId) }, params: params ?? null })
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
        post(initMsg())
        post({ cct: 'state', decor: decorRef.current })
        return
      }
      if (m.cct !== 'rpc' || typeof m.id !== 'number') return
      const reply = (ok: boolean, value?: unknown, error?: string) => post({ cct: 'rpc-result', id: m.id, ok, value, error })
      try {
        const p = m.params ?? {}
        const need = (perm: PluginPermission) => {
          if (!hasPermission(pluginId, perm)) throw new Error(`Permesso «${perm}» non dichiarato nel manifest del plugin`)
        }
        const name = pluginName(pluginId)
        switch (m.method) {
          // Solo la cartella dell'Esplora file: il plugin non sceglie quale elenco leggere.
          case 'files.index':
            return reply(true, await api.files.index(cwdRef.current))
          case 'editor.open':
            if (!inProject(p.path)) return reply(false, undefined, `File fuori dal progetto (${cwdRef.current || 'nessuna cartella'})`)
            openFile(p.path as string, Number.isInteger(p.line) && (p.line as number) > 0 ? { line: p.line as number, column: Number.isInteger(p.column) ? (p.column as number) : 1 } : undefined, cwdRef.current)
            return reply(true)
          case 'files.reveal':
            if (!inProject(p.path)) return reply(false, undefined, `File fuori dal progetto (${cwdRef.current || 'nessuna cartella'})`)
            await api.files.reveal(p.path as string)
            return reply(true)
          // La pagina parla con l'adapter del proprio plugin, mai con quello di altri.
          case 'plugin.call':
            return reply(true, await api.plugins.call(pluginId, String(p.method ?? ''), (p.params as Record<string, unknown>) ?? {}))
          case 'clipboard.copy':
            await navigator.clipboard.writeText(String(p.text ?? '').slice(0, 10_000))
            return reply(true)
          // Dati del progetto aperto: servono i permessi `files.read` / `files.write` e il file deve stare nel progetto.
          case 'files.read':
            need('files.read')
            if (!inProject(p.path)) return reply(false, undefined, `File fuori dal progetto (${cwdRef.current || 'nessuna cartella'})`)
            return reply(true, await api.files.read(p.path as string))
          case 'files.write':
            need('files.write')
            if (!inProject(p.path)) return reply(false, undefined, `File fuori dal progetto (${cwdRef.current || 'nessuna cartella'})`)
            return reply(true, await api.files.write(p.path as string, String(p.text ?? ''), typeof p.expectedMtime === 'number' ? p.expectedMtime : undefined))
          // Terminale di una sessione avviata dall'adapter (`app.session.create`).
          case 'terminal.show':
            need('terminal')
            return reply(true, showSessionTerminal(String(p.sessionId ?? '')))
          // Gruppo di terminali nella vista «alveare» (stessa cosa di `app.terminal.hive` per gli adapter).
          case 'terminal.hive': {
            need('terminal')
            const hive = parseHive(pluginId, p)
            if (!hive) return reply(false, undefined, 'Gruppo di terminali non valido')
            return reply(true, showHive(hive))
          }
          // Indirizzo web nel browser predefinito (per esempio http://localhost:8080 di un container): solo http e https.
          case 'system.openUrl': {
            need('openUrl')
            const url = String(p.url ?? '')
            if (url.length > 2000 || !/^https?:\/\/[^\s]+$/i.test(url)) return reply(false, undefined, 'Indirizzo non valido: servono http o https')
            window.open(url, '_blank', 'noopener')
            return reply(true)
          }
          // Una pagina del plugin in una finestra grande; la pagina aperta si chiude da sola con `ui.close`.
          case 'ui.openPage':
            openPluginPage(pluginId, name, p)
            return reply(true)
          case 'ui.close':
            if (modalId === undefined) return reply(false, undefined, 'Questa pagina non è in una finestra')
            usePluginUi.getState().closePage(modalId)
            return reply(true)
          // Impostazioni del plugin: nomi corti, l'app li mette nello spazio `plugin.<id>.`.
          case 'settings.get':
            return reply(true, (await api.settings.get(settingKey(pluginId, p.key))) ?? null)
          case 'settings.set':
            await api.settings.set(settingKey(pluginId, p.key), p.value ?? null)
            return reply(true)
          // Avvisi e dialoghi: li disegna l'app, con il nome del plugin.
          case 'ui.notify':
            pluginNotify(name, p.message, p.kind)
            return reply(true)
          case 'ui.confirm':
            return reply(true, await pluginConfirm(name, p))
          case 'ui.prompt':
            return reply(true, await pluginPrompt(name, p))
          case 'dialog.pickFolder':
            return reply(true, await api.env.pickFolder(typeof p.defaultPath === 'string' ? p.defaultPath : cwdRef.current, typeof p.title === 'string' ? p.title : undefined))
          case 'dialog.pickFile':
            return reply(true, await api.env.pickFile({ title: p.title as string | undefined, defaultPath: (p.defaultPath as string | undefined) ?? cwdRef.current, filters: p.filters as { name: string; extensions: string[] }[] | undefined }))
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

  // Eventi dell'app per la pagina (docs/PLUGIN_API_DOCS.md §3.2): file cambiati nel progetto e sessioni terminate.
  useEffect(() => {
    const send = (event: string, data: unknown) => ready.current && post({ cct: 'event', event, data })
    const offFiles = api.files.onChanged((root, paths) => {
      if (normPath(root) !== normPath(cwdRef.current)) return
      send('app.file.changed', { paths })
    })
    const exited = new Set(Object.values(useSessions.getState().sessions).filter((x) => x.status === 'exited').map((x) => x.id))
    const offSessions = useSessions.subscribe((s) => {
      for (const x of Object.values(s.sessions)) {
        if (x.status !== 'exited' || exited.has(x.id)) continue
        exited.add(x.id)
        send('app.session.exit', { sessionId: x.id, exitCode: x.exitCode ?? null })
      }
    })
    return () => {
      offFiles()
      offSessions()
    }
  }, [pluginId])

  // Le novità (git, revisioni di Claude, errori) e il cambio di colore d'accento arrivano alla pagina già aperta.
  useEffect(() => {
    if (ready.current) post({ cct: 'state', decor })
  }, [decor])
  const accent = useAccent((s) => s.accent)
  useEffect(() => {
    if (ready.current) post(initMsg())
  }, [accent, cwd])
  const lastCwd = useRef(cwd)
  useEffect(() => {
    if (lastCwd.current === cwd) return
    lastCwd.current = cwd
    if (ready.current) post({ cct: 'event', event: 'app.workspace', data: { cwd } })
  }, [cwd])
  // Per `app.file.changed` la cartella dev'essere osservata (il conteggio dei riferimenti la condivide con l'Esplora file).
  useEffect(() => {
    if (!cwd) return
    api.files.watch(cwd)
    return () => api.files.unwatch(cwd)
  }, [cwd])

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
