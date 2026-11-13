import { useState } from 'react'
import { AlertTriangle, CheckCircle2, PackagePlus, Puzzle, Settings, Trash2 } from 'lucide-react'
import type { InstalledPlugin, PluginPreview } from '@shared/plugins'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui-kit'
import { useSidebar } from '@/state/sidebar'
import { EMPTY_DECOR, PluginFrame } from './PluginFrame'
import { useEditor } from '@/state/editor'
import { useWorkspace } from '@/state/workspace'
import { formatBytes } from './format'
import { InstallPluginDialog } from './InstallPluginDialog'

const STATE_LABEL: Record<string, string> = { starting: 'avvio', ready: 'attivo', error: 'errore', stopped: 'fermo' }

/**
 * Plugin di linguaggio (X8): installati, con versione, linguaggi, server e stato; importa,
 * attiva/disattiva, aggiorna (importando una versione nuova) e disinstalla.
 */
export function PluginsPanel() {
  const plugins = useEditor((s) => s.plugins)
  const servers = useEditor((s) => s.servers)
  const setStatus = useWorkspace((s) => s.setStatus)
  const [preview, setPreview] = useState<PluginPreview | null>(null)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<InstalledPlugin | null>(null)
  const [configuring, setConfiguring] = useState<InstalledPlugin | null>(null)
  const cwd = useSidebar((s) => s.explorerCwd)

  const importPackage = async () => {
    setError('')
    const res = await api.plugins.pick()
    if (!res) return
    if (!res.ok || !res.preview) setError(res.error ?? 'Pacchetto non valido')
    else setPreview(res.preview)
  }

  const sorted = [...plugins].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <Puzzle size={15} className="text-text-subtle" />
        <h2 className="text-[14px] font-semibold text-foreground">Plugin</h2>
        <span className="text-[12px] text-text-subtle">· linguaggi e language server dell'editor</span>
        <button
          type="button"
          onClick={() => void importPackage()}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-semibold text-on-brand"
        >
          <PackagePlus size={14} /> Importa plugin…
        </button>
      </div>
      {error && <p className="mx-4 mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}

      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-4">
        {sorted.length === 0 && (
          <div className="mx-auto max-w-md pt-8 text-center text-text-subtle">
            <Puzzle size={26} className="mx-auto text-text-faint" />
            <p className="mt-2 font-semibold text-foreground">Nessun plugin installato</p>
            <p className="mt-1 text-[12px] leading-relaxed">
              Il supporto ai linguaggi (completamento, errori, vai alla definizione) arriva dai plugin. Importa un pacchetto <span className="font-mono">.ccplugin</span>, per esempio TypeScript, Python, Java o Maven.
            </p>
          </div>
        )}
        {sorted.map((p) => {
          const m = p.manifest
          const running = Object.values(servers).filter((s) => s.pluginId === m.id)
          return (
            <div key={m.id} className={cn('rounded-xl border p-3', p.state === 'ok' ? 'border-border' : 'border-warn/40')}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13px] font-semibold text-foreground">{m.name}</span>
                    <span className="font-mono text-[11px] text-text-faint">
                      {m.id} · {m.version} · {m.publisher}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[12px] text-text-subtle">{m.description}</p>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[12px] text-text-subtle" title={p.enabled ? 'Disattiva' : 'Attiva'}>
                  {p.enabled ? 'Attivo' : 'Disattivato'}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={p.enabled}
                    aria-label={`${p.enabled ? 'Disattiva' : 'Attiva'} ${m.name}`}
                    onClick={() => void api.plugins.setEnabled(m.id, !p.enabled)}
                    className={cn('flex h-5 w-9 items-center rounded-full p-0.5 transition-colors', p.enabled ? 'justify-end bg-ok' : 'justify-start bg-strong')}
                  >
                    <span className="size-4 rounded-full bg-white" />
                  </button>
                </label>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                {(m.languages ?? []).map((l) => (
                  <span key={l.id} className="rounded border border-border px-1.5 py-0.5 font-mono text-text-muted">
                    {[...(l.filenames ?? []), ...(l.extensions ?? [])].join(' ') || l.id}
                  </span>
                ))}
                {Object.keys(m.provides?.runtimes ?? {}).map((r) => (
                  <span key={r} className="rounded border border-info/40 px-1.5 py-0.5 font-mono text-info">
                    fornisce {r}
                  </span>
                ))}
                {(m.requires ?? []).map((r) => (
                  <span key={r} className="rounded border border-border px-1.5 py-0.5 font-mono text-text-faint">
                    richiede {r}
                  </span>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-text-subtle">
                {p.state === 'ok' ? (
                  <span className="inline-flex items-center gap-1 text-ok">
                    <CheckCircle2 size={12} /> verificato
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-warn">
                    <AlertTriangle size={12} /> {p.message}
                  </span>
                )}
                {m.main &&
                  (running.length ? (
                    running.map((r) => (
                      <span key={r.key} title={`${r.root}${r.message ? `\n${r.message}` : ''}`} className={r.state === 'error' ? 'text-danger' : undefined}>
                        {r.name}
                        {r.root ? ` · ${r.root.split(/[\\/]/).pop()}` : ''}: {STATE_LABEL[r.state]}
                      </span>
                    ))
                  ) : (
                    <span>parte quando apri un file</span>
                  ))}
                {p.sizeBytes > 0 && <span>{formatBytes(p.sizeBytes)}</span>}
                <span>installato {new Date(p.installedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                {m.contributes?.settings && p.enabled && p.state === 'ok' && (
                  <button type="button" onClick={() => setConfiguring(p)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-text-subtle hover:bg-border hover:text-foreground">
                    <Settings size={12} /> Impostazioni
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setRemoving(p)}
                  className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-text-subtle hover:bg-danger/10 hover:text-danger', !(m.contributes?.settings && p.enabled && p.state === 'ok') && 'ml-auto')}
                >
                  <Trash2 size={12} /> Disinstalla
                </button>
              </div>
            </div>
          )
        })}
        {sorted.length > 0 && (
          <p className="pt-2 text-center text-[11px] text-text-faint">Per aggiornare un plugin importa il pacchetto della versione nuova.</p>
        )}
      </div>

      <InstallPluginDialog
        preview={preview}
        onClose={(installed) => {
          if (installed && preview) setStatus(`Plugin «${preview.manifest.name}» ${preview.installedVersion ? 'aggiornato' : 'installato'}`)
          setPreview(null)
        }}
      />
      {/* Pagina di impostazioni del plugin (contributo `settings`): sta in un iframe isolato come le altre. */}
      <Dialog open={configuring !== null} onOpenChange={(o) => !o && setConfiguring(null)}>
        <DialogContent className="flex h-[70vh] max-w-2xl flex-col">
          <DialogHeader>
            <DialogTitle>{configuring?.manifest.contributes?.settings?.title ?? `Impostazioni di ${configuring?.manifest.name ?? ''}`}</DialogTitle>
            <DialogDescription>Plugin {configuring?.manifest.id}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
            {configuring?.manifest.contributes?.settings && (
              <PluginFrame pluginId={configuring.manifest.id} entry={configuring.manifest.contributes.settings.entry} cwd={cwd} decor={EMPTY_DECOR} />
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        title={`Disinstallare «${removing?.manifest.name ?? ''}»?`}
        description="I suoi language server vengono fermati e i suoi file cancellati, compresi quelli scaricati. Potrai reinstallarlo importando di nuovo il pacchetto."
        confirmLabel="Disinstalla"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          const res = await api.plugins.uninstall(removing.manifest.id)
          setStatus(res.ok ? `Plugin «${removing.manifest.name}» disinstallato` : (res.error ?? 'Disinstallazione non riuscita'))
          setRemoving(null)
        }}
      />
    </div>
  )
}
