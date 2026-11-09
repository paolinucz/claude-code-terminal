import { useEffect, useState } from 'react'
import type { JavaService, JdkInfo, RunConfig, RunConfigType } from '@shared/java'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui-kit'
import { cn } from '@/lib/cn'

const TYPES: { id: RunConfigType; label: string }[] = [
  { id: 'quarkus', label: 'Quarkus (dev mode)' },
  { id: 'maven', label: 'Maven' },
  { id: 'gradle', label: 'Gradle' },
  { id: 'application', label: 'Applicazione Java' },
  { id: 'attach', label: 'Collegati a una JVM (attach)' }
]

const field = 'h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] text-foreground outline-none placeholder:text-text-faint focus:border-brand'

const envToText = (env: Record<string, string>) => Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')
const textToEnv = (t: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const line of t.split(/\r?\n/)) {
    const m = /^\s*([^=\s#][^=]*?)\s*=(.*)$/.exec(line)
    if (m) out[m[1]] = m[2]
  }
  return out
}

/** Crea o modifica una run configuration. */
export function ConfigDialog({
  open,
  initial,
  services,
  jdks,
  defaultRoot,
  onSave,
  onClose
}: {
  open: boolean
  initial: RunConfig | null
  services: JavaService[]
  jdks: JdkInfo[]
  defaultRoot: string
  onSave(cfg: RunConfig): void
  onClose(): void
}) {
  const [cfg, setCfg] = useState<RunConfig | null>(null)
  const [env, setEnv] = useState('')
  useEffect(() => {
    if (!open) return
    const first = services.find((s) => !s.aggregator) ?? services[0]
    const base: RunConfig = initial ?? {
      id: '',
      name: '',
      type: first?.framework === 'quarkus' ? 'quarkus' : first?.build === 'gradle' ? 'gradle' : 'maven',
      root: first?.root ?? defaultRoot,
      env: {},
      vmOptions: '',
      args: '',
      debugPort: 5005,
      tool: first?.build,
      origin: 'manuale'
    }
    setCfg(base)
    setEnv(envToText(base.env))
  }, [open, initial, services, defaultRoot])
  if (!cfg) return null
  const set = (patch: Partial<RunConfig>) => setCfg({ ...cfg, ...patch })
  const service = services.find((s) => s.root.toLowerCase() === cfg.root.toLowerCase())
  const valid = Boolean(cfg.name.trim() && cfg.root.trim() && (cfg.type !== 'application' || cfg.mainClass?.trim()) && (cfg.type !== 'maven' || cfg.goals?.trim()) && (cfg.type !== 'gradle' || cfg.tasks?.trim()))
  const label = (text: string, child: React.ReactNode, hint?: string) => (
    <label className="block">
      <span className="mb-1 block text-[11px] text-text-subtle">{text}</span>
      {child}
      {hint && <span className="mt-0.5 block text-[10.5px] text-text-faint">{hint}</span>}
    </label>
  )
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogTitle>{initial ? 'Modifica configurazione' : 'Nuova configurazione'}</DialogTitle>
        <DialogDescription className="mb-3 text-[12px] text-text-subtle">Come avviare (e debuggare) un servizio Java.</DialogDescription>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {label('Nome', <input className={field} value={cfg.name} onChange={(e) => set({ name: e.target.value })} placeholder="api [quarkus:dev]" autoFocus />)}
            {label(
              'Tipo',
              <select className={field} value={cfg.type} onChange={(e) => set({ type: e.target.value as RunConfigType })}>
                {TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          {label(
            cfg.type === 'attach' ? 'Cartella del progetto (per i sorgenti)' : 'Servizio / cartella di lavoro',
            <div className="flex gap-2">
              {services.length > 0 && (
                <select className={cn(field, 'w-48 shrink-0')} value={service?.root ?? ''} onChange={(e) => e.target.value && set({ root: e.target.value })}>
                  <option value="">Altra cartella…</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.root}>
                      {s.name} ({s.build}
                      {s.framework !== 'plain' ? `, ${s.framework}` : ''})
                    </option>
                  ))}
                </select>
              )}
              <input className={field} value={cfg.root} onChange={(e) => set({ root: e.target.value })} spellCheck={false} />
            </div>
          )}

          {cfg.type === 'maven' && (
            <div className="grid grid-cols-2 gap-3">
              {label('Obiettivi', <input className={field} value={cfg.goals ?? ''} onChange={(e) => set({ goals: e.target.value })} placeholder="clean package" spellCheck={false} />)}
              {label('Profili (virgola)', <input className={field} value={cfg.profiles ?? ''} onChange={(e) => set({ profiles: e.target.value })} placeholder="dev,local" spellCheck={false} />)}
            </div>
          )}
          {cfg.type === 'gradle' && label('Task', <input className={field} value={cfg.tasks ?? ''} onChange={(e) => set({ tasks: e.target.value })} placeholder="bootRun" spellCheck={false} />)}
          {cfg.type === 'quarkus' &&
            label(
              'Avvio con',
              <select className={field} value={cfg.tool ?? 'maven'} onChange={(e) => set({ tool: e.target.value as 'maven' | 'gradle' })}>
                <option value="maven">Maven (quarkus:dev)</option>
                <option value="gradle">Gradle (quarkusDev)</option>
              </select>
            )}
          {cfg.type === 'application' &&
            label('Classe con il main', <input className={field} value={cfg.mainClass ?? ''} onChange={(e) => set({ mainClass: e.target.value })} placeholder="com.acme.App" spellCheck={false} />, 'Il classpath arriva dal language server Java: il progetto deve essere importato.')}
          {cfg.type === 'attach' && (
            <div className="grid grid-cols-2 gap-3">
              {label('Host', <input className={field} value={cfg.host ?? 'localhost'} onChange={(e) => set({ host: e.target.value })} spellCheck={false} />)}
              {label('Porta', <input className={field} type="number" value={cfg.port ?? 5005} onChange={(e) => set({ port: Number(e.target.value) || 5005, debugPort: Number(e.target.value) || 5005 })} />)}
            </div>
          )}

          {cfg.type !== 'attach' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {label('Opzioni della JVM', <input className={field} value={cfg.vmOptions} onChange={(e) => set({ vmOptions: e.target.value })} placeholder="-Xmx1g -Dquarkus.profile=dev" spellCheck={false} />)}
                {label('Argomenti', <input className={field} value={cfg.args} onChange={(e) => set({ args: e.target.value })} placeholder="-DskipTests" spellCheck={false} />)}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {label(
                  'JDK',
                  <select className={field} value={cfg.jdk ?? ''} onChange={(e) => set({ jdk: e.target.value || undefined })}>
                    <option value="">Quello del servizio / predefinito</option>
                    {jdks.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.vendor ? `${j.vendor} ` : ''}
                        {j.version}
                      </option>
                    ))}
                  </select>
                )}
                {label('Porta di debug', <input className={field} type="number" value={cfg.debugPort} onChange={(e) => set({ debugPort: Number(e.target.value) || 5005 })} />)}
              </div>
              {label('Variabili d\'ambiente (una per riga: NOME=valore)', <textarea className={cn(field, 'h-20 py-1.5 font-mono')} value={env} onChange={(e) => setEnv(e.target.value)} spellCheck={false} />)}
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 rounded-md px-3 text-[12px] text-text-subtle hover:bg-border hover:text-foreground">
            Annulla
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => onSave({ ...cfg, name: cfg.name.trim(), env: textToEnv(env) })}
            className="h-8 rounded-md bg-brand px-4 text-[12px] font-semibold text-on-brand disabled:opacity-40"
          >
            Salva
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
