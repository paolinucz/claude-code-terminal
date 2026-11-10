import { useState } from 'react'
import { AlertTriangle, Download, FileCode, Server, ShieldCheck } from 'lucide-react'
import { PLUGIN_PERMISSIONS, type PluginPreview } from '@shared/plugins'
import { api } from '@/lib/api'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui-kit'
import { useEditor } from '@/state/editor'
import { formatBytes } from './format'

/**
 * Installazione di un plugin (X3): prima di confermare si vede cosa fa — linguaggi, comandi che
 * eseguirà, file che scaricherà con il loro checksum, plugin richiesti e impronta del pacchetto.
 */
export function InstallPluginDialog({ preview, onClose }: { preview: PluginPreview | null; onClose(installed: boolean): void }) {
  const progress = useEditor((s) => s.installProgress)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')
  const m = preview?.manifest

  const close = async (installed: boolean) => {
    if (installing) return
    if (!installed && preview) await api.plugins.cancel(preview.token)
    setError('')
    onClose(installed)
  }

  const install = async () => {
    if (!preview) return
    setInstalling(true)
    setError('')
    const res = await api.plugins.install(preview.token)
    setInstalling(false)
    if (!res.ok) {
      setError(res.error ?? 'Installazione non riuscita')
      return
    }
    onClose(true)
  }

  const downloadTotal = (m?.downloads ?? []).reduce((n, d) => n + (d.size ?? 0), 0)
  const live = progress && preview && progress.pluginId === m?.id && installing

  return (
    <Dialog open={preview !== null} onOpenChange={(o) => !o && void close(false)}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
        {m && preview && (
          <>
            <DialogHeader>
              <DialogTitle>
                {preview.installedVersion ? 'Aggiorna' : 'Installa'} «{m.name}» <span className="font-normal text-text-subtle">{preview.installedVersion ? `${preview.installedVersion} → ${m.version}` : m.version}</span>
              </DialogTitle>
              <DialogDescription>
                {m.description} <span className="text-text-faint">· {m.publisher}{m.license ? ` · licenza ${m.license}` : ''}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-3 text-[12px]">
              {(m.languages ?? []).length > 0 && (
                <Section icon={<FileCode size={14} />} title="Linguaggi">
                  <div className="flex flex-wrap gap-1.5">
                    {(m.languages ?? []).map((l) => (
                      <span key={l.id} className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
                        {l.id} <span className="text-text-faint">{[...(l.filenames ?? []), ...(l.extensions ?? [])].join(' ')}</span>
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              {preview.entry && (
                <Section icon={<Server size={14} />} title="Cosa eseguirà">
                  {(m.activities ?? []).length > 0 && (
                    <ul className="mb-1.5 list-disc pl-4 text-text-muted">
                      {(m.activities ?? []).map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mb-1 text-text-subtle">
                    Adapter <span className="font-mono text-[11px]">{preview.entry.main}</span> · Plugin API v{preview.entry.apiVersion}
                  </div>
                  <p className="text-text-faint">L'adapter e i language server girano come processi sul tuo PC, con i tuoi permessi: installa solo plugin di cui ti fidi.</p>
                </Section>
              )}

              {(m.permissions ?? []).length > 0 && (
                <Section icon={<ShieldCheck size={14} />} title="Permessi richiesti">
                  <ul className="list-disc pl-4 text-text-muted">
                    {(m.permissions ?? []).map((x) => (
                      <li key={x}>{PLUGIN_PERMISSIONS[x] ?? x}</li>
                    ))}
                  </ul>
                </Section>
              )}

              {(m.downloads ?? []).length > 0 && (
                <Section icon={<Download size={14} />} title={`Scaricherà all'installazione${downloadTotal ? ` · ${formatBytes(downloadTotal)}` : ''}`}>
                  {(m.downloads ?? []).map((d) => (
                    <div key={d.id} className="mb-1 font-mono text-[11px]">
                      <span className="text-text-muted">{d.url}</span>
                      <span className="text-text-faint">
                        {' '}
                        · {d.size ? formatBytes(d.size) : '?'} · {d.sha256 ? `sha256 ${d.sha256.slice(0, 12)}…` : `${d.integrity?.slice(0, 20)}…`}
                      </span>
                    </div>
                  ))}
                  <p className="text-text-faint">Ogni file viene verificato con il suo checksum: se non corrisponde l'installazione si annulla.</p>
                </Section>
              )}

              {(m.requires ?? []).length > 0 && (
                <Section icon={<ShieldCheck size={14} />} title="Richiede">
                  {(m.requires ?? []).map((r) => (
                    <span key={r} className={`mr-2 font-mono text-[11px] ${preview.missingRequirements.includes(r) ? 'text-danger' : 'text-ok'}`}>
                      {r} {preview.missingRequirements.includes(r) ? '(non installato)' : '✓'}
                    </span>
                  ))}
                  {preview.missingRequirements.length > 0 && (
                    <p className="mt-1 text-warn">Puoi installarlo, ma i suoi server partiranno solo dopo aver installato i plugin richiesti.</p>
                  )}
                </Section>
              )}

              {preview.warnings.map((w) => (
                <p key={w} className="flex items-center gap-1.5 text-warn">
                  <AlertTriangle size={13} /> {w}
                </p>
              ))}

              <p className="font-mono text-[11px] text-text-faint">
                Pacchetto {formatBytes(preview.packageSize)} · SHA-256 {preview.packageHash}
              </p>

              {live && (
                <div>
                  <p className="text-text-subtle">{progress.step}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                    <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
                  </div>
                </div>
              )}
              {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{error}</p>}
            </div>

            <DialogFooter className="mt-4">
              <button type="button" disabled={installing} onClick={() => void close(false)} className="h-9 rounded-lg border border-border px-4 text-text-muted hover:bg-border hover:text-foreground disabled:opacity-40">
                Annulla
              </button>
              <button type="button" disabled={installing} onClick={() => void install()} className="h-9 rounded-lg bg-brand px-4 font-semibold text-on-brand disabled:opacity-40">
                {installing ? 'Installazione…' : preview.installedVersion ? 'Aggiorna' : 'Installa'}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-foreground">
        <span className="text-text-subtle">{icon}</span>
        {title}
      </p>
      {children}
    </div>
  )
}
