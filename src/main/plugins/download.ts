import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { promisify } from 'node:util'
import type { PluginDownload } from '@shared/plugins'

const run = promisify(execFile)

/**
 * `tar` di Windows (bsdtar, legge gli zip). Non si usa quello del PATH: con Git Bash davanti nel PATH sarebbe il tar GNU,
 * che prende «C:\…» per «macchina:percorso» e non apre né zip né percorsi con la lettera del disco.
 */
export const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe') : 'tar'

/** SHA-256 di un file, in esadecimale. */
export function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

/**
 * Scarica un file con avanzamento e lo verifica (X4): SHA-256 esadecimale oppure integrity npm
 * («sha512-<base64>»). Se non corrisponde il file viene cancellato e l'installazione si ferma.
 */
export async function downloadVerified(d: Pick<PluginDownload, 'url' | 'sha256' | 'integrity'>, target: string, onProgress: (fraction: number) => void): Promise<void> {
  if (!d.sha256 && !d.integrity) throw new Error(`Download senza checksum: ${d.url}`)
  const res = await fetch(d.url)
  if (!res.ok || !res.body) throw new Error(`Download non riuscito (${res.status}): ${d.url}`)
  const total = Number(res.headers.get('content-length')) || 0
  const integrityAlgo = d.integrity?.split('-')[0]
  const hash = createHash(d.sha256 ? 'sha256' : (integrityAlgo ?? 'sha512'))
  mkdirSync(join(target, '..'), { recursive: true })
  const file = createWriteStream(target)
  let done = 0
  let last = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done: end, value } = await reader.read()
    if (end) break
    hash.update(value)
    if (!file.write(value)) await new Promise((r) => file.once('drain', r))
    done += value.length
    if (total && Date.now() - last > 150) {
      last = Date.now()
      onProgress(done / total)
    }
  }
  await new Promise<void>((resolve, reject) => file.end((err?: Error | null) => (err ? reject(err) : resolve())))
  const ok = d.sha256
    ? hash.digest('hex').toLowerCase() === d.sha256.toLowerCase()
    : `${integrityAlgo}-${hash.digest('base64')}` === d.integrity
  if (!ok) {
    rmSync(target, { force: true })
    throw new Error(`Il file scaricato non corrisponde al checksum dichiarato dal plugin: ${basename(d.url)}`)
  }
  onProgress(1)
}

/** Estrae zip o tar.gz con il tar di Windows. Con `strip` toglie la prima cartella dell'archivio. */
export async function extract(archive: string, type: 'zip' | 'tar.gz', dest: string, strip: boolean): Promise<void> {
  const tmp = `${dest}.extract`
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  await run(TAR, [type === 'zip' ? '-xf' : '-xzf', archive, '-C', tmp], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  let source = tmp
  if (strip) {
    const entries = readdirSync(tmp)
    if (entries.length === 1 && statSync(join(tmp, entries[0])).isDirectory()) source = join(tmp, entries[0])
  }
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(join(dest, '..'), { recursive: true })
  renameSync(source, dest)
  rmSync(tmp, { recursive: true, force: true })
}

/**
 * Impronta dei file di un plugin (X7): SHA-256 di percorsi e contenuti, in ordine. La cartella dei
 * download è esclusa: quei file sono verificati con il loro checksum all'installazione.
 */
export async function treeHash(dir: string, exclude: string[] = ['downloads']): Promise<{ hash: string; size: number }> {
  const files: string[] = []
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      const rel = relative(dir, p)
      if (exclude.includes(rel.split(/[\\/]/)[0])) continue
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) files.push(p)
    }
  }
  if (existsSync(dir)) await walk(dir)
  files.sort()
  const h = createHash('sha256')
  let size = 0
  for (const f of files) {
    const buf = await readFile(f)
    size += buf.length
    h.update(relative(dir, f).replace(/\\/g, '/'))
    h.update('\0')
    h.update(createHash('sha256').update(buf).digest())
  }
  return { hash: h.digest('hex'), size }
}

/** Dimensione totale di una cartella (per mostrare quanto occupa un plugin con i suoi download). */
export async function dirSize(dir: string): Promise<number> {
  let size = 0
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) size += statSync(p).size
    }
  }
  await walk(dir)
  return size
}
