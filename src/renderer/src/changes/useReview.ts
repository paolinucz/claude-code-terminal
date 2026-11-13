import { useEffect, useMemo, useState } from 'react'
import { isOpen, isSessionRunning, type ChangeContents, type FileChange, type ReviewNote } from '@shared/changes'
import { api } from '@/lib/api'
import { renderMarkdownDiff } from '@/docs/markdown'
import { pendingCount, splitPath } from '@/state/changes'
import { useExplainSettings } from '@/state/explain'
import { useSessions } from '@/state/sessions'
import { useWorkspace } from '@/state/workspace'
import type { LineSelection } from './DiffView'

export type ReviewFilter = 'open' | 'all'
export type ReviewView = 'diff' | 'explain'
export type ReviewBase = 'original' | 'lastRequest'

/**
 * Revisione delle modifiche di Claude: selezione, contenuti del diff, Approva / Rifiuta / Richiedi modifiche, «tutte», conferme
 * per i file cambiati dopo Claude e blocco finché la sessione lavora. Prima stava dentro `ChangesPanel`; ora la usano sia la
 * panoramica sia il cassetto accanto al terminale (`ReviewDrawer`), con lo stesso comportamento.
 *
 * `changes` è l'insieme su cui si lavora (tutte le visibili nella panoramica, quelle di una sessione nel cassetto).
 * `focusId` porta la selezione su una modifica precisa (clic su una card della conversazione).
 */
export function useReview({ changes, filter = 'open', focusId, focusN }: { changes: FileChange[]; filter?: ReviewFilter; focusId?: string | null; focusN?: number }) {
  const setStatus = useWorkspace((s) => s.setStatus)
  const sessionMap = useSessions((s) => s.sessions)
  // Si revisiona solo a Claude fermo: le sessioni che stanno ancora eseguendo bloccano approva, rifiuta e richiedi modifiche.
  const running = useMemo(() => new Set(Object.values(sessionMap).filter((x) => isSessionRunning(x.status)).map((x) => x.id)), [sessionMap])
  const explainOn = useExplainSettings((s) => s.enabled)
  useEffect(() => void useExplainSettings.getState().load(), [])

  const [view, setView] = useState<ReviewView>('diff')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [contents, setContents] = useState<ChangeContents | null>(null)
  const [rejecting, setRejecting] = useState<{ change: FileChange; force: boolean } | null>(null)
  /** «Respingi tutte»: conferma, poi (se serve) conferma separata per i file cambiati dopo Claude. */
  const [bulk, setBulk] = useState<{ ids: string[]; label: string; created: number; stage: 'confirm' | 'force'; forceIds?: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [composing, setComposing] = useState(false)
  const [composeError, setComposeError] = useState('')
  const [selection, setSelection] = useState<LineSelection | null>(null)
  /** Revisione partita dal tasto destro: ancora una nota alle righe selezionate. */
  const [seed, setSeed] = useState<{ selection: LineSelection; n: number } | null>(null)
  const [base, setBase] = useState<ReviewBase>('lastRequest')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [mdMode, setMdMode] = useState<'layout' | 'source'>('layout')

  const startReview = (sel: LineSelection) => {
    setComposing(true)
    setSeed((s) => ({ selection: sel, n: (s?.n ?? 0) + 1 }))
  }

  const visible = useMemo(() => (filter === 'open' ? changes.filter(isOpen) : changes), [changes, filter])
  const toReview = pendingCount(changes)
  const waitingClaude = changes.filter((c) => c.status === 'revision').length
  const selected = changes.find((c) => c.id === selectedId) ?? null
  const selectedRunning = Boolean(selected && running.has(selected.sessionId))
  const anyPendingRunning = changes.some((c) => c.status === 'pending' && running.has(c.sessionId))
  /** Modifiche in attesa tra quelle considerate: su queste agiscono «tutte». */
  const pendingIds = useMemo(() => changes.filter((c) => c.status === 'pending').map((c) => c.id), [changes])

  // Selezione: resta sulla modifica scelta finché esiste nell'elenco visibile, altrimenti passa alla prima.
  useEffect(() => {
    if (selectedId && visible.some((c) => c.id === selectedId)) return
    setSelectedId(visible[0]?.id ?? null)
  }, [visible, selectedId])

  // Selezione richiesta da fuori (card della conversazione, panoramica).
  useEffect(() => {
    if (focusId && changes.some((c) => c.id === focusId)) setSelectedId(focusId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, focusN])

  useEffect(() => {
    setComposing(false)
    setComposeError('')
    setSelection(null)
    setSeed(null)
    setHistoryOpen(false)
  }, [selectedId])

  // Contenuti del diff: si ricaricano quando cambia la selezione o la modifica stessa (nuovi Edit sullo stesso file).
  useEffect(() => {
    if (!selected) {
      setContents(null)
      return
    }
    let stale = false
    void api.changes.contents(selected.id).then((c) => !stale && setContents(c))
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.updatedAt, selected?.status, selected?.requests])

  const approveIds = async (ids: string[], label: string) => {
    const n = await api.changes.approveMany(ids)
    setStatus(`${n} ${n === 1 ? 'modifica approvata' : 'modifiche approvate'} (${label})`)
  }

  const startRejectMany = (ids: string[], label: string) => {
    const created = changes.filter((c) => ids.includes(c.id) && c.created).length
    setBulk({ ids, label, created, stage: 'confirm' })
  }

  /** Ripristina tutte le modifiche scelte. Quelle cambiate dopo Claude si chiedono a parte (non si sovrascrive in silenzio). */
  const runRejectMany = async (force: boolean) => {
    if (!bulk) return
    const ids = force ? bulk.forceIds ?? [] : bulk.ids
    setBusy(true)
    const res = await api.changes.rejectMany(ids, force)
    setBusy(false)
    const failed = res.failed.length
    const text = `${res.rejected} ${res.rejected === 1 ? 'modifica respinta' : 'modifiche respinte'}: Claude lo saprà al prossimo messaggio`
    setStatus(failed ? `${text} · ${failed} non ripristinate: ${res.failed[0].error}` : text)
    if (!force && res.needsForce.length > 0) setBulk({ ...bulk, stage: 'force', forceIds: res.needsForce })
    else setBulk(null)
  }

  const nextOpenAfter = (id: string) => {
    const list = changes.filter((c) => c.status === 'pending')
    const i = list.findIndex((c) => c.id === id)
    return list[i + 1]?.id ?? list[i - 1]?.id ?? null
  }

  const approve = async (c: FileChange) => {
    setBusy(true)
    await api.changes.approve(c.id)
    setBusy(false)
    if (filter === 'open') setSelectedId(nextOpenAfter(c.id))
  }

  const reject = async (c: FileChange, force: boolean) => {
    setBusy(true)
    const res = await api.changes.reject(c.id, force)
    setBusy(false)
    if (res.needsForce) {
      setRejecting({ change: c, force: true })
      return
    }
    setRejecting(null)
    if (!res.ok) {
      setStatus(res.error ?? 'Impossibile rifiutare la modifica')
      return
    }
    setStatus(`${splitPath(c).name} ripristinato: Claude lo saprà al prossimo messaggio`)
    if (filter === 'open') setSelectedId(nextOpenAfter(c.id))
  }

  const requestRevision = async (c: FileChange, notes: ReviewNote[]) => {
    setBusy(true)
    setComposeError('')
    const res = await api.changes.requestRevision(c.id, notes)
    setBusy(false)
    if (!res.ok) {
      setComposeError(res.error ?? 'Impossibile inviare la richiesta')
      return
    }
    setComposing(false)
    setStatus(`Richiesta inviata a «${c.sessionTitle}»: ${splitPath(c).name} tornerà qui quando Claude lo aggiorna`)
  }

  // Confronto: dopo una richiesta conviene vedere solo cosa ha cambiato Claude da allora.
  const canCompareLast = Boolean(contents?.lastRequestBase !== null && contents?.lastRequestBase !== undefined && selected?.status === 'pending')
  const diffBefore = canCompareLast && base === 'lastRequest' ? contents!.lastRequestBase! : contents?.before

  // Markdown: il diff si può vedere impaginato (blocchi aggiunti in verde, tolti in rosso) o come sorgente.
  const isMd = selected ? /\.(md|markdown)$/i.test(selected.filePath) : false
  const mdDiff = useMemo(
    () =>
      isMd && mdMode === 'layout' && selected && diffBefore != null && contents?.after != null
        ? renderMarkdownDiff(diffBefore, contents.after, selected.filePath.replace(/[\\/][^\\/]*$/, ''))
        : null,
    [isMd, mdMode, selected, diffBefore, contents?.after]
  )

  return {
    // dati
    changes,
    visible,
    selected,
    selectedId,
    setSelectedId,
    contents,
    diffBefore,
    toReview,
    waitingClaude,
    pendingIds,
    running,
    selectedRunning,
    anyPendingRunning,
    explainOn,
    // stato dell'interfaccia
    view,
    setView,
    busy,
    composing,
    setComposing,
    composeError,
    selection,
    setSelection,
    seed,
    startReview,
    base,
    setBase,
    canCompareLast,
    historyOpen,
    setHistoryOpen,
    isMd,
    mdMode,
    setMdMode,
    mdDiff,
    rejecting,
    setRejecting,
    bulk,
    setBulk,
    // azioni
    approve,
    reject,
    approveIds,
    startRejectMany,
    runRejectMany,
    requestRevision
  }
}

export type ReviewApi = ReturnType<typeof useReview>
