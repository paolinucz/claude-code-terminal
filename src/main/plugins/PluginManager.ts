import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, join, sep } from 'node:path'
import { promisify } from 'node:util'
import { PLUGIN_PERMISSIONS, type InstalledPlugin, type PluginInstallProgress, type PluginLanguageInfo, type PluginManifest, type PluginPreview } from '@shared/plugins'
import { PLUGIN_API_VERSION } from '@shared/pluginApi'
import type { AppDb } from '../db'
import { dirSize, downloadVerified, extract, fileSha256, TAR, treeHash } from './download'

const run = promisify(execFile)

/** Adapter di un plugin attivo, pronto da avviare. */
export interface AdapterSpec {
  pluginId: string
  name: string
  dir: string
  /** Percorso assoluto del file dell'adapter. */
  main: string
  downloadsDir: string
  dataDir: string
  /** Linguaggi i cui documenti vanno all'adapter. */
  handles: string[]
}

/** Linguaggi gestiti dall'adapter di un plugin: `handles` o, se manca, quelli che definisce. */
const handlesOf = (m: PluginManifest): string[] => (m.main ? (m.handles ?? (m.languages ?? []).map((l) => l.id)) : [])

interface Loaded {
  manifest: PluginManifest
  enabled: boolean
  installedAt: string
  packageHash: string
  treeHash: string
  state: InstalledPlugin['state']
  message?: string
  size: number
}

const ID_RE = /^[a-z0-9][a-z0-9.-]{1,63}$/

/**
 * Plugin di linguaggio (X1–X9): importazione di pacchetti .ccplugin, download verificati,
 * controllo dei file a ogni avvio, e scelta dei language server per ogni file.
 */
export class PluginManager {
  private plugins = new Map<string, Loaded>()
  private staging = new Map<string, { dir: string; preview: PluginPreview }>()

  constructor(
    private readonly db: AppDb,
    private readonly dir: string,
    private readonly dataDir: string,
    private readonly changed: () => void
  ) {
    mkdirSync(dir, { recursive: true })
    rmSync(join(dir, '.staging'), { recursive: true, force: true })
    for (const row of db.listPlugins()) {
      this.plugins.set(row.id, {
        manifest: JSON.parse(row.manifest_json) as PluginManifest,
        enabled: row.enabled === 1,
        installedAt: row.installed_at,
        packageHash: row.package_hash,
        treeHash: row.tree_hash,
        state: 'ok',
        size: 0
      })
    }
    this.refreshRequirements()
  }

  pluginDir(id: string): string {
    return join(this.dir, id)
  }

  /** X7: ricontrolla l'impronta dei file di ogni plugin (in background, all'avvio). */
  async verifyAll(): Promise<void> {
    for (const [id, p] of this.plugins) {
      const { hash } = await treeHash(this.pluginDir(id))
      if (hash !== p.treeHash) {
        p.state = 'modified'
        p.message = 'I file del plugin sono cambiati dopo l\'installazione: è bloccato finché non lo reinstalli.'
      }
      p.size = await dirSize(this.pluginDir(id))
    }
    this.refreshRequirements()
    this.changed()
  }

  private refreshRequirements(): void {
    for (const p of this.plugins.values()) {
      if (p.state === 'modified') continue
      const missing = (p.manifest.requires ?? []).filter((r) => !this.isActive(r))
      p.state = missing.length ? 'missing-requirement' : 'ok'
      p.message = missing.length ? `Richiede: ${missing.join(', ')}` : undefined
    }
  }

  isActive(id: string): boolean {
    const p = this.plugins.get(id)
    return Boolean(p && p.enabled && p.state !== 'modified')
  }

  list(): InstalledPlugin[] {
    return [...this.plugins.values()].map((p) => ({
      manifest: p.manifest,
      enabled: p.enabled,
      installedAt: p.installedAt,
      packageHash: p.packageHash,
      state: p.state,
      message: p.message,
      sizeBytes: p.size
    }))
  }

  private active(): Loaded[] {
    return [...this.plugins.values()].filter((p) => p.enabled && p.state === 'ok')
  }

  /** Linguaggi dei plugin attivi (per la colorazione e i provider dell'editor). */
  languages(): PluginLanguageInfo[] {
    const out: PluginLanguageInfo[] = []
    const served = new Set(this.active().flatMap((p) => handlesOf(p.manifest)))
    for (const p of this.active()) {
      for (const l of p.manifest.languages ?? []) {
        out.push({
          id: l.id,
          monaco: l.monaco,
          extensions: (l.extensions ?? []).map((e) => e.toLowerCase()),
          filenames: (l.filenames ?? []).map((f) => f.toLowerCase()),
          pluginId: p.manifest.id,
          hasServer: served.has(l.id)
        })
      }
    }
    return out
  }

  /** Linguaggio di un file: prima i nomi esatti (pom.xml), poi le estensioni (.xml). */
  languageOf(path: string): PluginLanguageInfo | null {
    const name = basename(path).toLowerCase()
    const langs = this.languages()
    return (
      langs.find((l) => l.filenames.includes(name)) ??
      langs.find((l) => l.extensions.some((e) => name.endsWith(e))) ??
      null
    )
  }

  /** X6: gli adapter dei plugin attivi che gestiscono il linguaggio del file. */
  adaptersFor(path: string): { spec: AdapterSpec; languageId: string }[] {
    const lang = this.languageOf(path)
    if (!lang) return []
    return this.active()
      .filter((p) => handlesOf(p.manifest).includes(lang.id))
      .map((p) => ({ spec: this.adapterSpec(p.manifest), languageId: lang.id }))
  }

  /** Adapter di un plugin attivo (per id), se ne ha uno. */
  adapter(id: string): AdapterSpec | null {
    const p = this.plugins.get(id)
    return p && p.enabled && p.state === 'ok' && p.manifest.main ? this.adapterSpec(p.manifest) : null
  }

  private adapterSpec(m: PluginManifest): AdapterSpec {
    const dir = this.pluginDir(m.id)
    const dataDir = join(this.dataDir, m.id)
    mkdirSync(dataDir, { recursive: true })
    return { pluginId: m.id, name: m.name, dir, main: join(dir, m.main!), downloadsDir: join(dir, 'downloads'), dataDir, handles: handlesOf(m) }
  }

  /** X5: runtime forniti dai plugin attivi (es. «java»), con i percorsi già risolti. */
  runtimes(): Record<string, { command: string; args: string[] }> {
    const out: Record<string, { command: string; args: string[] }> = {}
    for (const p of this.active()) {
      const dir = this.pluginDir(p.manifest.id)
      const expand = (v: string) => v.replace(/\$\{plugin\}/g, dir).replace(/\$\{downloads\}/g, join(dir, 'downloads')).replace(/[\\/]/g, sep)
      for (const [name, rt] of Object.entries(p.manifest.provides?.runtimes ?? {})) {
        out[name] = { command: expand(rt.command), args: (rt.args ?? []).map((a) => a.replace(/\$\{plugin\}/g, dir).replace(/\$\{downloads\}/g, join(dir, 'downloads'))) }
      }
    }
    return out
  }

  // ---- Importazione (X2, X3) ----

  /** Apre un pacchetto e prepara l'anteprima: niente viene installato né eseguito. */
  async preview(file: string): Promise<PluginPreview> {
    const token = randomUUID()
    const dir = join(this.dir, '.staging', token)
    mkdirSync(dir, { recursive: true })
    try {
      await run(TAR, ['-xf', file, '-C', dir], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
    } catch {
      rmSync(dir, { recursive: true, force: true })
      throw new Error('Il file non è un pacchetto valido (zip).')
    }
    const manifestPath = join(dir, 'plugin.json')
    if (!existsSync(manifestPath)) {
      rmSync(dir, { recursive: true, force: true })
      throw new Error('Il pacchetto non contiene plugin.json.')
    }
    let manifest: PluginManifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^﻿/, '')) as PluginManifest
    } catch (err) {
      rmSync(dir, { recursive: true, force: true })
      throw new Error(`plugin.json non valido: ${(err as Error).message}`)
    }
    const problems = validate(manifest)
    if (manifest.main && !existsSync(join(dir, manifest.main))) problems.push(`l'adapter «${manifest.main}» non è nel pacchetto`)
    if (problems.length) {
      rmSync(dir, { recursive: true, force: true })
      throw new Error(`Manifest non valido: ${problems.join('; ')}`)
    }
    const warnings: string[] = []
    for (const d of manifest.downloads ?? []) {
      if (!/^https:\/\//.test(d.url)) warnings.push(`Download non HTTPS: ${d.url}`)
    }
    if (manifest.main && manifest.apiVersion !== PLUGIN_API_VERSION) {
      warnings.push(`Il plugin usa la versione ${manifest.apiVersion ?? '?'} della Plugin API, l'app la ${PLUGIN_API_VERSION}: potrebbe non funzionare.`)
    }
    if (!manifest.main && (manifest.languages ?? []).length) warnings.push('Il plugin non ha un adapter: dà solo la colorazione della sintassi.')
    const preview: PluginPreview = {
      token,
      file,
      manifest,
      packageHash: await fileSha256(file),
      packageSize: statSync(file).size,
      entry: manifest.main ? { main: manifest.main, apiVersion: manifest.apiVersion ?? 0 } : undefined,
      missingRequirements: (manifest.requires ?? []).filter((r) => !this.isActive(r)),
      installedVersion: this.plugins.get(manifest.id)?.manifest.version,
      warnings
    }
    this.staging.set(token, { dir, preview })
    return preview
  }

  cancelPreview(token: string): void {
    const s = this.staging.get(token)
    if (s) rmSync(s.dir, { recursive: true, force: true })
    this.staging.delete(token)
  }

  /** Installa dopo la conferma: copia i file, scarica e verifica i download, registra l'impronta. */
  async install(token: string, onProgress: (p: PluginInstallProgress) => void, beforeReplace: (id: string) => Promise<void>): Promise<void> {
    const s = this.staging.get(token)
    if (!s) throw new Error('Anteprima scaduta: importa di nuovo il pacchetto.')
    this.staging.delete(token)
    const m = s.preview.manifest
    const target = this.pluginDir(m.id)
    const work = `${target}.new`
    rmSync(work, { recursive: true, force: true })
    renameSync(s.dir, work)
    try {
      const downloads = m.downloads ?? []
      for (let i = 0; i < downloads.length; i++) {
        const d = downloads[i]
        const label = `${d.id} (${i + 1}/${downloads.length})`
        // Se la versione installata ha già lo stesso download verificato, si riusa.
        const reuse = join(target, 'downloads', '.verified', `${d.id}.${d.sha256 ?? d.integrity?.slice(7, 30)}`)
        if (existsSync(reuse) && existsSync(join(target, 'downloads', d.to))) {
          mkdirSync(join(work, 'downloads', '.verified'), { recursive: true })
          renameSync(join(target, 'downloads', d.to), join(work, 'downloads', d.to))
          renameSync(reuse, join(work, 'downloads', '.verified', basename(reuse)))
          continue
        }
        const tmpFile = join(work, 'downloads', '.tmp', `${d.id}.${d.type === 'zip' ? 'zip' : d.type === 'tar.gz' ? 'tgz' : 'bin'}`)
        await downloadVerified(d, tmpFile, (f) => onProgress({ pluginId: m.id, step: `Scarico ${label}`, progress: f }))
        onProgress({ pluginId: m.id, step: `Preparo ${label}`, progress: 1 })
        const dest = join(work, 'downloads', d.to)
        if (d.type === 'file') {
          mkdirSync(join(dest, '..'), { recursive: true })
          renameSync(tmpFile, dest)
        } else {
          await extract(tmpFile, d.type, dest, Boolean(d.strip))
        }
        mkdirSync(join(work, 'downloads', '.verified'), { recursive: true })
        await import('node:fs/promises').then((fs) => fs.writeFile(join(work, 'downloads', '.verified', `${d.id}.${d.sha256 ?? d.integrity?.slice(7, 30)}`), d.url))
      }
      rmSync(join(work, 'downloads', '.tmp'), { recursive: true, force: true })
      onProgress({ pluginId: m.id, step: 'Calcolo l\'impronta dei file', progress: 1 })
      const { hash } = await treeHash(work)
      await beforeReplace(m.id)
      rmSync(target, { recursive: true, force: true })
      renameSync(work, target)
      const now = new Date().toISOString()
      this.db.savePlugin({ id: m.id, version: m.version, manifest_json: JSON.stringify(m), enabled: 1, installed_at: now, package_hash: s.preview.packageHash, tree_hash: hash })
      this.plugins.set(m.id, { manifest: m, enabled: true, installedAt: now, packageHash: s.preview.packageHash, treeHash: hash, state: 'ok', size: await dirSize(target) })
      this.refreshRequirements()
      this.changed()
      onProgress({ pluginId: m.id, step: 'Installato', progress: 1, done: true })
    } catch (err) {
      rmSync(work, { recursive: true, force: true })
      onProgress({ pluginId: m.id, step: 'Errore', progress: 0, error: (err as Error).message })
      throw err
    }
  }

  setEnabled(id: string, enabled: boolean): void {
    const p = this.plugins.get(id)
    if (!p) return
    p.enabled = enabled
    this.db.setPluginEnabled(id, enabled)
    this.refreshRequirements()
    this.changed()
  }

  /** Disinstalla. Non si può se un altro plugin installato lo richiede. */
  async uninstall(id: string, beforeRemove: (id: string) => Promise<void>): Promise<{ ok: boolean; error?: string }> {
    const dependents = [...this.plugins.values()].filter((p) => p.manifest.requires?.includes(id)).map((p) => p.manifest.name)
    if (dependents.length) return { ok: false, error: `Prima disinstalla: ${dependents.join(', ')} (lo richiedono).` }
    await beforeRemove(id)
    try {
      rmSync(this.pluginDir(id), { recursive: true, force: true })
      rmSync(join(this.dataDir, id), { recursive: true, force: true })
    } catch (err) {
      return { ok: false, error: `Impossibile cancellare i file: ${(err as Error).message}` }
    }
    this.db.deletePlugin(id)
    this.plugins.delete(id)
    this.refreshRequirements()
    this.changed()
    return { ok: true }
  }
}

/** Controlli sul manifest (X1). */
function validate(m: PluginManifest): string[] {
  const p: string[] = []
  if (!m || typeof m !== 'object') return ['plugin.json non è un oggetto']
  if (!ID_RE.test(m.id ?? '')) p.push('id mancante o non valido (minuscole, cifre, punti, trattini)')
  for (const k of ['name', 'version', 'publisher', 'description'] as const) if (typeof m[k] !== 'string' || !m[k]) p.push(`campo «${k}» mancante`)
  for (const d of m.downloads ?? []) {
    if (!d.url || !d.to || !d.id) p.push(`download incompleto: ${d.id ?? d.url}`)
    if (!d.sha256 && !d.integrity) p.push(`download senza checksum: ${d.id}`)
    if (/\.\.|^[\\/]|:/.test(d.to)) p.push(`destinazione non ammessa: ${d.to}`)
  }
  if (m.main !== undefined && (typeof m.main !== 'string' || /\.\.|^[\\/]|:/.test(m.main) || !/\.(mjs|cjs|js)$/.test(m.main))) {
    p.push('«main» deve essere un file .mjs, .cjs o .js dentro il pacchetto')
  }
  const rel = (v: unknown) => typeof v === 'string' && v !== '' && !/\.\.|^[\\/]|:/.test(v)
  for (const v of m.contributes?.explorerViews ?? []) {
    if (!v.id || !v.title || !rel(v.entry) || !/\.html?$/.test(v.entry)) p.push(`vista dell'Esplora file non valida: ${v.id ?? '?'} (serve id, title ed entry .html dentro il pacchetto)`)
  }
  const gut = m.contributes?.editorGutter
  if (gut && (!Array.isArray(gut.languages) || !gut.languages.length || gut.languages.some((l) => typeof l !== 'string') || typeof gut.click !== 'string' || !gut.click)) {
    p.push('«editorGutter» richiede languages (elenco di id) e click (nome del metodo dell\'adapter)')
  }
  for (const v of m.contributes?.sidebarViews ?? []) {
    if (!v.id || !v.title || !rel(v.entry) || !/\.html?$/.test(v.entry) || (v.icon !== undefined && (!rel(v.icon) || !/\.svg$/.test(v.icon)))) {
      p.push(`voce della barra laterale non valida: ${v.id ?? '?'} (serve id, title, entry .html ed eventuale icon .svg dentro il pacchetto)`)
    }
  }
  if (m.permissions !== undefined && (!Array.isArray(m.permissions) || m.permissions.some((x) => !(x in PLUGIN_PERMISSIONS)))) {
    p.push(`«permissions» deve essere un elenco di: ${Object.keys(PLUGIN_PERMISSIONS).join(', ')}`)
  }
  const ids = new Set<string>()
  for (const c of m.contributes?.commands ?? []) {
    if (!c.id || !c.title || ids.has(c.id) || Boolean(c.method) === Boolean(c.openView)) {
      p.push(`comando non valido: ${c.id ?? '?'} (serve id unico, title e uno solo tra method e openView)`)
    }
    ids.add(c.id)
    if (c.openView && !(m.contributes?.sidebarViews ?? []).some((v) => v.id === c.openView)) p.push(`il comando ${c.id} apre una vista che non esiste: ${c.openView}`)
  }
  const st = m.contributes?.settings
  if (st && (!rel(st.entry) || !/\.html?$/.test(st.entry))) p.push('«settings» richiede entry (.html dentro il pacchetto)')
  if (m.storage?.settingsPrefixes !== undefined && (!Array.isArray(m.storage.settingsPrefixes) || m.storage.settingsPrefixes.some((x) => typeof x !== 'string' || !/^[a-z][\w.-]*\.$/.test(x)))) {
    p.push('«storage.settingsPrefixes» deve essere un elenco di prefissi come «java.»')
  }
  if (m.handles !== undefined && (!Array.isArray(m.handles) || m.handles.some((h) => typeof h !== 'string'))) p.push('«handles» deve essere un elenco di id di linguaggio')
  for (const l of m.languages ?? []) if (!l.id || !l.monaco) p.push(`linguaggio incompleto: ${l.id ?? '?'}`)
  return p
}
