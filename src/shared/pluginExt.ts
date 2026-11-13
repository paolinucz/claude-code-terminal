// Punti di estensione dell'interfaccia (Plugin API v2): menu, barra di stato, eventi dell'app.
// Un plugin non apre finestre: dichiara nel manifest dove vuole comparire e l'app lo disegna con i propri componenti.
// Riferimento: docs/plugin-estensioni.md.

/** Versione minima della Plugin API ancora accettata (i plugin v1 non usano i punti di estensione sotto). */
export const PLUGIN_API_MIN_VERSION = 1

/**
 * Menu a cui un comando si può agganciare. Ogni menu ha un suo contesto (le chiavi che le condizioni `when` possono usare)
 * e lo stesso contesto arriva all'adapter nella chiamata (`params.context`).
 */
export const PLUGIN_MENUS = {
  /** Tasto destro su un file o una cartella dell'Esplora file. Contesto: resourcePath, resourceName, resourceExt, isDir, multiple. */
  'explorer/context': 'Menu del tasto destro dell\'Esplora file',
  /** Tasto destro nell'editor. Contesto: resourcePath, resourceName, resourceExt, languageId, hasSelection. */
  'editor/context': 'Menu del tasto destro dell\'editor',
  /** Barra di stato di un terminale. Contesto: sessionId, sessionKind, sessionStatus, cwd. */
  'terminal/toolbar': 'Barra di un terminale'
} as const
export type PluginMenuId = keyof typeof PLUGIN_MENUS

/** Valori di contesto per le condizioni `when` e per l'adapter. */
export type MenuContext = Record<string, string | number | boolean | undefined>

/** Voce di un menu: richiama un comando del plugin (`contributes.commands`). */
export interface PluginMenuItem {
  /** Id di un comando dello stesso plugin. */
  command: string
  /** Condizione di visibilità (vedi `evalWhen`). Assente = sempre. */
  when?: string
  /** Gruppo per ordinare e separare le voci (le voci dello stesso gruppo restano insieme). */
  group?: string
}

/** Elemento della barra di stato dell'app. Testo e stato li aggiorna l'adapter con `app.ui.statusItem`. */
export interface PluginStatusItem {
  /** Unico dentro il plugin. */
  id: string
  align?: 'left' | 'right'
  /** Testo iniziale (di solito vuoto: lo manda l'adapter). */
  text?: string
  tooltip?: string
  /** Comando del plugin eseguito al clic. */
  command?: string
}

/** Aggiornamento di un elemento della barra di stato, mandato dall'adapter. */
export interface StatusItemPatch {
  text?: string
  tooltip?: string
  /** Mostra un'icona/pallino colorato prima del testo. */
  tone?: 'neutral' | 'ok' | 'warn' | 'error' | 'busy'
  visible?: boolean
}

/** Eventi dell'app che un adapter può chiedere in `events` (arrivano come notifica `app/event` con `{event, data}`). */
export const PLUGIN_APP_EVENTS = {
  'session.created': 'Si apre una sessione (terminale, shell o attività)',
  'session.status': 'Una sessione cambia stato (in corso, in attesa, inattiva)',
  'session.exited': 'Una sessione termina'
} as const
export type PluginAppEvent = keyof typeof PLUGIN_APP_EVENTS

/** Eventi riservati adapter → app per la barra di stato (come `$ui.notify`: non arrivano alle pagine). */
export const HOST_EVENT_STATUS_ITEM = '$ui.statusItem'

/** Chiave unica di un elemento dell'interfaccia di un plugin. */
export const extKey = (pluginId: string, id: string) => `${pluginId}/${id}`

// ---- condizioni `when` ----------------------------------------------------------------------------------------------

/**
 * Valuta una condizione `when` sul contesto di un menu, senza `eval`:
 *   isDir                         vero se la chiave è vera / diversa da vuoto
 *   !isDir   a && b   a || b   (a)
 *   resourceExt == .java          uguaglianza (testo, senza distinguere maiuscole)
 *   resourceName != pom.xml
 *   languageId in [java, kotlin]  appartenenza a un elenco
 * Una condizione illeggibile vale falso: una voce sbagliata non appare, ma non rompe il menu.
 */
export function evalWhen(expr: string | undefined, ctx: MenuContext): boolean {
  if (expr === undefined || expr.trim() === '') return true
  try {
    const p = new WhenParser(expr, ctx)
    const v = p.parse()
    return v
  } catch {
    return false
  }
}

/** Per i controlli sul manifest: la condizione si legge senza errori? */
export function whenIsValid(expr: string): boolean {
  try {
    new WhenParser(expr, {}).parse()
    return true
  } catch {
    return false
  }
}

type Tok = { t: 'id' | 'str' | 'op' | 'eof'; v: string }

class WhenParser {
  private toks: Tok[] = []
  private i = 0
  private readonly ctx: MenuContext
  // Niente «parameter properties»: il file si prova da solo con `node --experimental-strip-types`.
  constructor(src: string, ctx: MenuContext) {
    this.ctx = ctx
    const re = /\s*(&&|\|\||==|!=|[()!\[\],]|"[^"]*"|'[^']*'|[^\s()!\[\],&|=]+)/gy
    let m: RegExpExecArray | null
    let last = 0
    while (last < src.length && (m = re.exec(src))) {
      last = re.lastIndex
      const s = m[1]
      if (/^(&&|\|\||==|!=|[()!\[\],])$/.test(s)) this.toks.push({ t: 'op', v: s })
      else if (s[0] === '"' || s[0] === "'") this.toks.push({ t: 'str', v: s.slice(1, -1) })
      else this.toks.push({ t: 'id', v: s })
    }
    if (src.slice(last).trim()) throw new Error('condizione non leggibile')
    this.toks.push({ t: 'eof', v: '' })
  }
  parse(): boolean {
    const v = this.or()
    if (this.peek().t !== 'eof') throw new Error('testo in più')
    return v
  }
  private peek = () => this.toks[this.i]
  private next = () => this.toks[this.i++]
  private isOp = (v: string) => this.peek().t === 'op' && this.peek().v === v
  private or(): boolean {
    let v = this.and()
    while (this.isOp('||')) {
      this.next()
      const r = this.and()
      v = v || r
    }
    return v
  }
  private and(): boolean {
    let v = this.not()
    while (this.isOp('&&')) {
      this.next()
      const r = this.not()
      v = v && r
    }
    return v
  }
  private not(): boolean {
    if (this.isOp('!')) {
      this.next()
      return !this.not()
    }
    if (this.isOp('(')) {
      this.next()
      const v = this.or()
      if (!this.isOp(')')) throw new Error('manca )')
      this.next()
      return v
    }
    return this.cmp()
  }
  private cmp(): boolean {
    const a = this.next()
    if (a.t !== 'id') throw new Error('manca la chiave')
    const raw = this.ctx[a.v]
    const left = raw === undefined || raw === false ? '' : String(raw)
    if (this.isOp('==') || this.isOp('!=')) {
      const eq = this.next().v === '=='
      const b = this.next()
      if (b.t !== 'id' && b.t !== 'str') throw new Error('manca il valore')
      return (left.toLowerCase() === b.v.toLowerCase()) === eq
    }
    if (this.peek().t === 'id' && this.peek().v === 'in') {
      this.next()
      if (!this.isOp('[')) throw new Error('manca [')
      this.next()
      const items: string[] = []
      while (!this.isOp(']')) {
        const x = this.next()
        if (x.t !== 'id' && x.t !== 'str') throw new Error('elenco non valido')
        items.push(x.v.toLowerCase())
        if (this.isOp(',')) this.next()
      }
      this.next()
      return items.includes(left.toLowerCase())
    }
    return left !== '' && left !== '0'
  }
}
