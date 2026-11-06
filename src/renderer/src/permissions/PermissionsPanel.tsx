import { useCallback, useEffect, useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { diffLines } from 'diff'
import { AlertTriangle, FolderOpen, Info, Plus, RefreshCw, Save, Search, Undo2, X } from 'lucide-react'
import {
  DECISIONS,
  mergeScope,
  renderSettings,
  SCOPES,
  toolOf,
  type Decision,
  type ExternalChange,
  type PermissionRule,
  type PermissionScope,
  type PermissionsState,
  type ScopeData
} from '@shared/permissions'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { PanelParams } from '@/panels/kinds'
import { useWorkspace } from '@/state/workspace'
import { NewRuleDialog } from './NewRuleDialog'

type Drafts = Record<PermissionScope, ScopeData>

const DECISION_STYLE: Record<Decision, { fg: string; bg: string }> = {
  allow: { fg: 'var(--cct-ok)', bg: 'rgb(111 211 155 / 0.12)' },
  ask: { fg: 'var(--cct-warn)', bg: 'rgb(245 196 107 / 0.12)' },
  deny: { fg: 'var(--cct-danger)', bg: 'rgb(255 138 138 / 0.12)' }
}

function dataOf(state: PermissionsState, scope: PermissionScope): ScopeData {
  const s = state.scopes.find((x) => x.scope === scope)!
  const by = (d: Decision) => s.rules.filter((r) => r.decision === d).map((r) => r.rule)
  return { allow: by('allow'), ask: by('ask'), deny: by('deny'), additionalDirectories: [...s.additionalDirectories] }
}

const sameData = (a: ScopeData, b: ScopeData) =>
  (['allow', 'ask', 'deny', 'additionalDirectories'] as const).every((k) => a[k].length === b[k].length && a[k].every((v, i) => v === b[k][i]))

function originLabel(rule: PermissionRule | undefined, scope: PermissionScope): string {
  if (!rule) return 'nuova · non salvata'
  const when = rule.addedAt ? ` · ${formatWhen(rule.addedAt)}` : ''
  switch (rule.origin) {
    case 'terminal':
      return `salvata dal terminale${when}`
    case 'manual':
      return `aggiunta a mano${when}`
    case 'external':
      return `aggiunta fuori dall'app${when}`
    default:
      return scope === 'project' ? 'condivisa col team' : scope === 'user' ? 'tutti i progetti' : 'già presente'
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? `oggi ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

/**
 * Schermata Permessi (P1–P6): legge e scrive direttamente i file di impostazioni di Claude Code,
 * così Claude Code applica le regole da solo. Le modifiche si salvano dopo averne visto l'anteprima.
 */
export function PermissionsPanel(props: IDockviewPanelProps<PanelParams>) {
  const setStatus = useWorkspace((s) => s.setStatus)
  const [cwd, setCwd] = useState(props.params.cwd ?? '')
  const [state, setState] = useState<PermissionsState | null>(null)
  const [drafts, setDrafts] = useState<Drafts | null>(null)
  const [scope, setScope] = useState<PermissionScope>('local')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [newDir, setNewDir] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [external, setExternal] = useState<{ change: ExternalChange; conflict: boolean } | null>(null)

  // Cartella di progetto: quella del pannello, altrimenti l'ultimo progetto usato, altrimenti la home.
  useEffect(() => {
    if (cwd) return
    void api.env.recentProjects().then(async (list) => setCwd(list[0]?.cwd ?? (await api.env.homeDir())))
  }, [cwd])

  const load = useCallback(
    async (keepScopes: PermissionScope[] = []) => {
      if (!cwd) return
      const next = await api.permissions.read(cwd)
      if (!next) return
      setState(next)
      setDrafts((old) => {
        const fresh = Object.fromEntries(SCOPES.map((s) => [s.id, dataOf(next, s.id)])) as Drafts
        if (!old) return fresh
        // Le modifiche non salvate degli ambiti indicati restano.
        for (const s of keepScopes) fresh[s] = old[s]
        return fresh
      })
    },
    [cwd]
  )

  useEffect(() => {
    setDrafts(null)
    setExternal(null)
    void load()
    if (cwd && props.params.cwd !== cwd) props.api.updateParameters({ ...props.params, cwd })
    if (cwd) props.api.setTitle(`Permessi · ${cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  const dirtyScopes = useMemo(
    () => (state && drafts ? SCOPES.filter((s) => !sameData(drafts[s.id], dataOf(state, s.id))).map((s) => s.id) : []),
    [state, drafts]
  )

  // P6: un file è cambiato fuori dall'app (es. «Sì, e ricorda» nel terminale).
  useEffect(() => {
    return api.permissions.onExternalChange((change) => {
      if (change.scope !== 'user' && change.cwd.toLowerCase() !== cwd.toLowerCase()) return
      const conflict = dirtyScopes.includes(change.scope)
      setExternal({ change, conflict })
      if (!conflict) void load(dirtyScopes)
    })
  }, [cwd, dirtyScopes, load])

  if (!state || !drafts) {
    return <div className="flex h-full items-center justify-center bg-surface text-text-faint">Caricamento dei permessi…</div>
  }

  const current = state.scopes.find((s) => s.scope === scope)!
  const draft = drafts[scope]
  const readOnly = Boolean(current.parseError)
  const savedRules = new Map(current.rules.map((r) => [r.rule, r]))
  const rows = (['deny', 'ask', 'allow'] as Decision[])
    .flatMap((d) => draft[d].map((rule) => ({ rule, decision: d })))
    .filter((r) => !query.trim() || r.rule.toLowerCase().includes(query.trim().toLowerCase()))

  const setDraft = (next: ScopeData) => setDrafts({ ...drafts, [scope]: next })
  const setDecision = (rule: string, d: Decision) => {
    const next: ScopeData = { ...draft, allow: draft.allow.filter((r) => r !== rule), ask: draft.ask.filter((r) => r !== rule), deny: draft.deny.filter((r) => r !== rule) }
    next[d] = [...next[d], rule]
    setDraft(next)
  }
  const revoke = (rule: string) =>
    setDraft({ ...draft, allow: draft.allow.filter((r) => r !== rule), ask: draft.ask.filter((r) => r !== rule), deny: draft.deny.filter((r) => r !== rule) })

  // P5: anteprima del file che verrà scritto, con le righe cambiate evidenziate.
  let preview = current.raw
  let previewParts: { value: string; added?: boolean; removed?: boolean }[] = [{ value: current.raw }]
  if (!readOnly) {
    let base: Record<string, unknown> = {}
    try {
      base = current.raw.trim() ? (JSON.parse(current.raw.replace(/^﻿/, '')) as Record<string, unknown>) : {}
    } catch {
      base = {}
    }
    preview = renderSettings(mergeScope(base, draft))
    previewParts = dirtyScopes.includes(scope) ? diffLines(current.raw, preview) : [{ value: preview }]
  }

  const save = async () => {
    setSaving(true)
    setError('')
    for (const s of dirtyScopes) {
      const res = await api.permissions.save(cwd, s, drafts[s])
      if (!res.ok) {
        setError(res.error ?? 'Salvataggio non riuscito')
        setSaving(false)
        return
      }
    }
    setSaving(false)
    setExternal(null)
    await load()
    setStatus(`Permessi salvati (${dirtyScopes.map((s) => SCOPES.find((x) => x.id === s)!.label).join(', ')}): Claude Code li applica alla prossima azione`)
  }

  const discard = () => {
    setDrafts(Object.fromEntries(SCOPES.map((s) => [s.id, dataOf(state, s.id)])) as Drafts)
    setError('')
  }

  return (
    <div className="@container h-full overflow-hidden bg-surface">
      <div className="flex h-full flex-col">
        {/* Intestazione: progetto e salvataggio */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-[14px] font-semibold text-foreground">Permessi</h2>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              spellCheck={false}
              aria-label="Cartella del progetto"
              className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 font-mono text-[12px] text-foreground outline-none focus:border-brand"
            />
            <button
              type="button"
              title="Scegli la cartella del progetto"
              onClick={async () => {
                const dir = await api.env.pickFolder(cwd)
                if (dir) setCwd(dir)
              }}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-text-muted hover:bg-border hover:text-foreground"
            >
              <FolderOpen size={14} />
            </button>
          </div>
          {dirtyScopes.length > 0 && (
            <>
              <button type="button" onClick={discard} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] text-text-subtle hover:bg-border hover:text-foreground">
                <Undo2 size={13} /> Annulla modifiche
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-semibold text-on-brand disabled:opacity-40"
              >
                <Save size={13} /> {saving ? 'Salvataggio…' : `Salva ${dirtyScopes.length > 1 ? `(${dirtyScopes.length} file)` : ''}`}
              </button>
            </>
          )}
        </div>

        {/* P6: avviso di modifica esterna */}
        {external && (
          <div className={cn('flex shrink-0 items-start gap-2 border-b px-4 py-2 text-[12px]', external.conflict ? 'border-warn/40 bg-warn/10' : 'border-info/30 bg-info/10')}>
            {external.conflict ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" /> : <RefreshCw size={14} className="mt-0.5 shrink-0 text-info" />}
            <div className="min-w-0 flex-1">
              <p className="text-foreground">
                {SCOPES.find((s) => s.id === external.change.scope)!.label}: il file è cambiato fuori dall'app
                {external.change.fromTerminal ? ' (probabilmente «Sì, e ricorda» nel terminale)' : ''}
                {external.conflict ? ' mentre avevi modifiche non salvate.' : ' ed è stato ricaricato.'}
              </p>
              <ul className="mt-0.5 font-mono text-[11px] text-text-muted">
                {external.change.added.map((a) => (
                  <li key={`a${a.decision}${a.rule}`}>
                    + {a.rule} <span className="text-text-faint">({DECISIONS.find((d) => d.id === a.decision)!.label})</span>
                  </li>
                ))}
                {external.change.removed.map((a) => (
                  <li key={`r${a.decision}${a.rule}`}>
                    − {a.rule} <span className="text-text-faint">({DECISIONS.find((d) => d.id === a.decision)!.label})</span>
                  </li>
                ))}
                {external.change.directoriesAdded.map((d) => <li key={`da${d}`}>+ cartella {d}</li>)}
                {external.change.directoriesRemoved.map((d) => <li key={`dr${d}`}>− cartella {d}</li>)}
              </ul>
              {external.conflict && (
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void load(dirtyScopes.filter((s) => s !== external.change.scope))
                      setExternal(null)
                    }}
                    className="h-7 rounded-md bg-border px-2.5 text-foreground hover:bg-strong"
                  >
                    Ricarica dal file (perdi le tue modifiche a questo ambito)
                  </button>
                  <button type="button" onClick={() => setExternal(null)} className="h-7 rounded-md px-2.5 text-text-subtle hover:bg-border hover:text-foreground">
                    Tieni le mie (sovrascrivono il file al salvataggio)
                  </button>
                </div>
              )}
            </div>
            {!external.conflict && (
              <button type="button" aria-label="Chiudi l'avviso" onClick={() => setExternal(null)} className="text-text-faint hover:text-foreground">
                <X size={13} />
              </button>
            )}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col @[900px]:flex-row">
          {/* Colonna principale: ambiti, regole, cartelle */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto px-4 py-3">
            {/* P1: tre ambiti */}
            <div role="tablist" aria-label="Ambito" className="grid grid-cols-3 gap-2">
              {SCOPES.map((s) => {
                const st = state.scopes.find((x) => x.scope === s.id)!
                const n = drafts[s.id].allow.length + drafts[s.id].ask.length + drafts[s.id].deny.length
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={scope === s.id}
                    onClick={() => setScope(s.id)}
                    title={st.path}
                    className={cn(
                      'flex min-h-[52px] flex-col items-start gap-0.5 rounded-xl border px-3 py-1.5 text-left transition-colors',
                      scope === s.id ? 'border-brand bg-border' : 'border-border hover:bg-surface-2'
                    )}
                  >
                    <span className="flex w-full items-center gap-1.5 font-semibold text-foreground">
                      {s.label}
                      <span className="font-mono text-[11px] font-normal text-text-faint">{n}</span>
                      {dirtyScopes.includes(s.id) && <span className="size-1.5 rounded-full bg-brand" title="Modifiche non salvate" />}
                      {st.parseError && <AlertTriangle size={12} className="text-danger" />}
                    </span>
                    <span className="truncate font-mono text-[11px] text-text-subtle">{s.file}</span>
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-[12px] text-text-faint">{SCOPES.find((s) => s.id === scope)!.description}</p>

            {current.parseError && (
              <p className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                {current.parseError}. Questo ambito è in sola lettura finché non correggi il file: {current.path}
              </p>
            )}

            {/* Cerca e nuova regola */}
            <div className="mt-3 flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cerca, es. Bash(git"
                  aria-label="Cerca tra le regole"
                  className="h-8 w-full rounded-lg border border-input bg-background pr-2.5 pl-8 font-mono text-[12px] text-foreground outline-none placeholder:text-text-faint focus:border-brand"
                />
              </div>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => setAdding(true)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-muted hover:bg-border hover:text-foreground disabled:opacity-40"
              >
                <Plus size={13} /> Nuova regola
              </button>
            </div>

            {/* P2: regole */}
            <div className="mt-2 overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-[minmax(0,1fr)_88px_auto_64px] gap-2 border-b border-border bg-surface-2 px-3 py-1.5 text-[11px] text-text-faint">
                <span>Regola</span>
                <span>Strumento</span>
                <span>Decisione</span>
                <span />
              </div>
              {rows.length === 0 && (
                <p className="px-3 py-5 text-center text-[12px] text-text-faint">{query ? 'Nessuna regola trovata.' : 'Nessuna regola in questo ambito.'}</p>
              )}
              {rows.map(({ rule, decision }) => {
                const saved = savedRules.get(rule)
                const changed = !saved || saved.decision !== decision
                return (
                  <div
                    key={rule}
                    className={cn(
                      'grid grid-cols-[minmax(0,1fr)_88px_auto_64px] items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0',
                      changed && 'bg-brand/5'
                    )}
                  >
                    <div className="min-w-0">
                      <span className="block truncate font-mono text-[12px] text-foreground" title={rule}>
                        {rule}
                      </span>
                      <span className="block truncate text-[11px] text-text-faint">
                        {changed && saved ? `era «${DECISIONS.find((d) => d.id === saved.decision)!.label}» · non salvata` : originLabel(saved, scope)}
                      </span>
                    </div>
                    <span className="truncate font-mono text-[11px] text-text-subtle">{toolOf(rule)}</span>
                    <div role="group" aria-label={`Decisione per ${rule}`} className="flex gap-1">
                      {DECISIONS.map((d) => {
                        const on = d.id === decision
                        const st = DECISION_STYLE[d.id]
                        return (
                          <button
                            key={d.id}
                            type="button"
                            disabled={readOnly}
                            aria-pressed={on}
                            onClick={() => setDecision(rule, d.id)}
                            className="h-7 rounded-md border px-2 text-[11px] transition-colors disabled:cursor-not-allowed"
                            style={on ? { color: st.fg, background: st.bg, borderColor: st.fg, fontWeight: 600 } : { color: 'var(--cct-text-subtle)', borderColor: 'var(--cct-border)' }}
                          >
                            {d.label}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => revoke(rule)}
                      className="h-7 rounded-md text-[11px] text-text-subtle hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                    >
                      Revoca
                    </button>
                  </div>
                )
              })}
            </div>

            {/* P4: cartelle aggiuntive */}
            <section className="mt-4">
              <h3 className="text-[13px] font-semibold text-foreground">Cartelle aggiuntive</h3>
              <p className="text-[12px] text-text-subtle">Claude può lavorare qui senza chiedere ogni volta (additionalDirectories).</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {draft.additionalDirectories.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1 rounded-md border border-border bg-background py-0.5 pr-1 pl-2 font-mono text-[12px] text-text-muted">
                    {d}
                    <button
                      type="button"
                      disabled={readOnly}
                      aria-label={`Rimuovi ${d}`}
                      onClick={() => setDraft({ ...draft, additionalDirectories: draft.additionalDirectories.filter((x) => x !== d) })}
                      className="inline-flex size-5 items-center justify-center rounded text-text-faint hover:bg-border hover:text-foreground"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {!readOnly && (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const d = newDir.trim()
                      if (d && !draft.additionalDirectories.includes(d)) setDraft({ ...draft, additionalDirectories: [...draft.additionalDirectories, d] })
                      setNewDir('')
                    }}
                  >
                    <input
                      value={newDir}
                      onChange={(e) => setNewDir(e.target.value)}
                      placeholder="..\shared-lib"
                      aria-label="Nuova cartella aggiuntiva"
                      className="h-7 w-40 rounded-md border border-input bg-background px-2 font-mono text-[12px] text-foreground outline-none placeholder:text-text-faint focus:border-brand"
                    />
                    <button
                      type="button"
                      title="Scegli una cartella"
                      onClick={async () => {
                        const dir = await api.env.pickFolder(cwd)
                        if (dir && !draft.additionalDirectories.includes(dir)) setDraft({ ...draft, additionalDirectories: [...draft.additionalDirectories, dir] })
                      }}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[12px] text-text-muted hover:bg-border hover:text-foreground"
                    >
                      <Plus size={12} /> Aggiungi cartella
                    </button>
                  </form>
                )}
              </div>
            </section>

            {error && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}
          </div>

          {/* P5: anteprima del file */}
          <aside className="flex max-h-[40%] min-h-0 shrink-0 flex-col border-t border-border @[900px]:max-h-none @[900px]:w-[380px] @[900px]:border-t-0 @[900px]:border-l">
            <div className="flex items-baseline gap-2 px-3 pt-2.5 pb-1.5">
              <h3 className="text-[13px] font-semibold text-foreground">Anteprima file</h3>
              <span className="truncate font-mono text-[11px] text-text-faint" title={current.path}>
                {SCOPES.find((s) => s.id === scope)!.file}
              </span>
              {!current.exists && <span className="shrink-0 text-[11px] text-text-faint">· verrà creato</span>}
            </div>
            <pre className="mx-3 min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-background p-2.5 font-mono text-[12px] leading-relaxed">
              {previewParts.map((p, i) =>
                p.removed ? (
                  <span key={i} className="block bg-danger/15 text-danger line-through decoration-danger/50">
                    {p.value.replace(/\n$/, '')}
                  </span>
                ) : p.added ? (
                  <span key={i} className="block bg-ok/15 text-ok">
                    {p.value.replace(/\n$/, '')}
                  </span>
                ) : (
                  <span key={i} className="block text-text-muted">
                    {p.value.replace(/\n$/, '') || (i === 0 && !preview.trim() ? '(file vuoto)' : '')}
                  </span>
                )
              )}
            </pre>
            <p className="flex gap-1.5 px-3 py-2.5 text-[11px] leading-snug text-text-subtle">
              <Info size={13} className="mt-px shrink-0" />
              <span>
                Precedenza: <strong className="text-danger">Nega</strong> vince sempre, poi <strong className="text-warn">Chiedi</strong>, poi{' '}
                <strong className="text-ok">Consenti</strong>. Le regole «Locale» non finiscono su git. Le altre chiavi del file restano com'erano.
              </span>
            </p>
          </aside>
        </div>
      </div>

      <NewRuleDialog
        open={adding}
        scopeLabel={SCOPES.find((s) => s.id === scope)!.label}
        existing={(['allow', 'ask', 'deny'] as Decision[]).flatMap((d) => draft[d].map((rule) => ({ rule, decision: d })))}
        onClose={() => setAdding(false)}
        onAdd={(rule, d) => {
          setDecision(rule, d)
          setAdding(false)
        }}
      />
    </div>
  )
}
