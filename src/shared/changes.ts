// Modifiche di Claude ai file (requisiti F4–F8), condivise tra processo principale e interfaccia.

/**
 * - pending: da rivedere
 * - revision: hai chiesto modifiche, si aspetta che Claude le faccia (poi torna «pending»)
 * - approved / rejected: decisione presa
 */
export type ChangeStatus = 'pending' | 'revision' | 'approved' | 'rejected'

/** Una indicazione per Claude (F8): un'accortezza da seguire o un divieto, eventualmente su righe precise. */
export interface ReviewNote {
  kind: 'care' | 'forbid'
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
