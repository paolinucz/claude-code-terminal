// Modifiche di Claude ai file (requisiti F4–F8), condivise tra processo principale e interfaccia.

/**
 * - pending: da rivedere
 * - revision: hai chiesto modifiche, si aspetta che Claude le faccia (poi torna «pending»)
 * - approved / rejected: decisione presa
 */
export type ChangeStatus = 'pending' | 'revision' | 'approved' | 'rejected'

/** Una indicazione per Claude (F8): un'accortezza da seguire o un divieto, eventualmente su righe precise. */
/** Tipo di nota della revisione (configurabile dall'utente): `hint` dice a Claude come trattarla. */
export interface ReviewKind {
  id: string
  label: string
  /** Istruzione per Claude, per esempio «da rispettare» o «da non violare». */
  hint: string
  tone: 'warn' | 'danger' | 'info' | 'ok'
  /** Frase d'esempio nel campo di testo. */
  placeholder?: string
}

export const REVIEW_TONES: ReviewKind['tone'][] = ['warn', 'danger', 'info', 'ok']
export const REVIEW_KIND_LIMITS = { count: 12, label: 30, hint: 120 }

export const DEFAULT_REVIEW_KINDS: ReviewKind[] = [
  { id: 'care', label: 'Accortezza', hint: 'da rispettare', tone: 'warn', placeholder: 'Cosa deve fare o a cosa stare attento, es. «gestisci anche il caso null»' },
  { id: 'forbid', label: 'Divieto', hint: 'da non violare', tone: 'danger', placeholder: 'Cosa NON deve fare, es. «non cambiare la firma del metodo»' },
  { id: 'question', label: 'Domanda', hint: 'rispondi nel messaggio senza modificare il codice se non serve', tone: 'info', placeholder: 'Cosa vuoi capire, es. «perché hai scelto una Map?»' }
]

/** Valida la lista salvata: null se non è una lista valida (si usano i predefiniti). */
export function sanitizeReviewKinds(v: unknown): ReviewKind[] | null {
  if (!Array.isArray(v)) return null
  const out: ReviewKind[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const k = x as Record<string, unknown>
    if (typeof k.id !== 'string' || typeof k.label !== 'string' || !k.label.trim()) continue
    out.push({
      id: k.id,
      label: k.label.trim().slice(0, REVIEW_KIND_LIMITS.label),
      hint: typeof k.hint === 'string' ? k.hint.trim().slice(0, REVIEW_KIND_LIMITS.hint) : '',
      tone: REVIEW_TONES.includes(k.tone as ReviewKind['tone']) ? (k.tone as ReviewKind['tone']) : 'info',
      placeholder: typeof k.placeholder === 'string' ? k.placeholder : undefined
    })
  }
  return out.slice(0, REVIEW_KIND_LIMITS.count)
}

export interface ReviewNote {
  /** Id del tipo di nota (vedi ReviewKind). */
  kind: string
  /** Nome e istruzione del tipo al momento dell'invio: restano giusti anche se i tipi cambiano dopo. */
  label?: string
  hint?: string
  tone?: ReviewKind['tone']
  text: string
  /** Righe del file nella versione «dopo» a cui si riferisce la nota. */
  lines?: { start: number; end: number }
  /** Testo di quelle righe, per dare contesto a Claude. */
  excerpt?: string
}

/** Una richiesta di modifiche inviata a Claude su un file. */
export interface RevisionRequest {
  id: string
  changeId: string
  notes: ReviewNote[]
  createdAt: string
}

/**
 * Una modifica = un file toccato da una sessione. Più Edit/Write sullo stesso file, finché la
 * modifica è aperta, si sommano: «prima» resta la versione originale, «dopo» è l'ultima.
 */
export interface FileChange {
  id: string
  /** Sessione dell'app che l'ha fatta. */
  sessionId: string
  /** Titolo della sessione al momento della modifica (resta anche dopo che la sessione è chiusa). */
  sessionTitle: string
  cwd: string
  filePath: string
  /** Strumenti usati, in ordine (Edit, Write, MultiEdit, NotebookEdit). */
  tools: string[]
  /** Il file non esisteva prima: rifiutare vuol dire cancellarlo. */
  created: boolean
  status: ChangeStatus
  added: number
  removed: number
  /** Quante volte hai chiesto modifiche su questo file. */
  requests: number
  createdAt: string
  updatedAt: string
  decidedAt?: string
}

/** Contenuti per il diff affiancato (F6). */
export interface ChangeContents {
  change: FileChange
  before: string | null
  after: string | null
  /** Contenuto al momento dell'ultima richiesta di modifiche: per vedere solo cosa ha cambiato Claude dopo. */
  lastRequestBase: string | null
  requests: RevisionRequest[]
  /** Il file su disco è cambiato dopo l'ultima modifica di Claude (modificato a mano o da altro). */
  modifiedSince: boolean
  binary: boolean
}

export interface RejectResult {
  ok: boolean
  /** Il file era stato cambiato dopo la modifica di Claude: serve una conferma per sovrascriverlo. */
  needsForce?: boolean
  error?: string
}

/** Esito di «Respingi tutte»: quante ripristinate, quali serve confermare (file cambiati dopo Claude) e quali sono fallite. */
export interface RejectManyResult {
  rejected: number
  needsForce: string[]
  failed: { id: string; error: string }[]
}

export interface RevisionResult {
  ok: boolean
  error?: string
}

/** La modifica aspetta ancora qualcosa (da te o da Claude). */
export const isOpen = (c: Pick<FileChange, 'status'>): boolean => c.status === 'pending' || c.status === 'revision'

/** Messaggio mostrato quando l'input è bloccato dalla revisione obbligatoria. */
export const REVIEW_LOCK_MESSAGE =
  'Prima di scrivere a Claude devi revisionare le sue modifiche: approva o rifiuta ogni file nella revisione accanto al terminale.'

/**
 * Revisione obbligatoria: a Claude fermo (stato «idle») con modifiche ancora aperte della sessione,
 * l'input (casella grafica, terminale, prompt predefiniti) è disabilitato. Mentre Claude lavora o aspetta
 * un permesso l'input resta libero, altrimenti non si potrebbe rispondere né interrompere.
 */
export const isReviewLocked = (
  session: { id: string; kind: string; status: string },
  changes: Pick<FileChange, 'sessionId' | 'status'>[]
): boolean => session.kind === 'claude' && session.status === 'idle' && changes.some((c) => c.sessionId === session.id && isOpen(c))

/** Claude sta ancora eseguendo (lavora o aspetta un permesso). */
export const isSessionRunning = (status: string): boolean => status === 'working' || status === 'waiting'

/** Messaggio mostrato quando si prova a revisionare mentre Claude sta ancora eseguendo. */
export const REVIEW_RUNNING_MESSAGE = 'Claude sta ancora eseguendo: approvare o rifiutare si potrà quando ha finito tutti i prompt.'
