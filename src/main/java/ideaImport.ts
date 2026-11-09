import type { IdeaImportResult, RunConfig } from '@shared/java'
import { child, childrenOf, descendants, parseXml, type XmlNode } from '@shared/xml'
import { splitArgs } from './runConfig'
import type { Disk } from './services'

const BS = '\\'
const sep = (p: string) => p.replace(/\//g, BS).replace(/\\+$/, '')

/** Valore di <option name="X" value="Y"/> tra i figli diretti. */
function opt(n: XmlNode | undefined, name: string): string | undefined {
  return n?.children.find((c) => c.tag === 'option' && c.attrs.name === name)?.attrs.value
}

/** Elenco <option name="X"><list><option value="a"/>…</list></option> (o <set>). */
function optList(n: XmlNode | undefined, name: string): string[] {
  const holder = n?.children.find((c) => c.tag === 'option' && c.attrs.name === name)
  const list = child(holder, 'list') ?? child(holder, 'set')
  return childrenOf(list, 'option').map((o) => o.attrs.value).filter((v): v is string => Boolean(v))
}

/** Mappa <option name="X"><map><entry key="K" value="V"/>…</map></option>. */
function optMap(n: XmlNode | undefined, name: string): Record<string, string> {
  const holder = n?.children.find((c) => c.tag === 'option' && c.attrs.name === name)
  const out: Record<string, string> = {}
  for (const e of childrenOf(child(holder, 'map'), 'entry')) if (e.attrs.key) out[e.attrs.key] = e.attrs.value ?? ''
  return out
}

/** Porta di debug scritta nelle opzioni (-Ddebug=5006, -Dsuspend…), se c'è. */
const debugPortIn = (...texts: string[]): number | undefined => {
  for (const t of texts) {
    const m = /-Ddebug=(\d{2,5})/.exec(t) ?? /address=(?:[\w.*]+:)?(\d{2,5})/.exec(t)
    if (m) return Number(m[1])
  }
  return undefined
}

interface Ctx {
  /** Cartella del progetto IntelliJ (quella con .idea). */
  projectDir: string
  newId(): string
}

const macro = (value: string | undefined, ctx: Ctx): string | undefined => {
  if (value === undefined) return undefined
  return value
    .replace(/\$PROJECT_DIR\$/g, sep(ctx.projectDir))
    .replace(/\$MODULE_DIR\$/g, sep(ctx.projectDir))
    .replace(/\$USER_HOME\$/g, process.env.USERPROFILE ?? process.env.HOME ?? '')
    .replace(/\//g, BS)
}

/** JDK richiesto da IntelliJ (nome tipo «21», «temurin-21», «corretto-17»): solo la versione, per segnalarla. */
const jdkHint = (name: string | undefined): string | undefined => /(\d{1,2})(?:\.\d+)*$/.exec(name ?? '')?.[1]

function base(name: string, type: RunConfig['type'], root: string, ctx: Ctx): RunConfig {
  return { id: ctx.newId(), name, type, root, env: {}, vmOptions: '', args: '', debugPort: 5005, origin: 'intellij' }
}

function convert(c: XmlNode, ctx: Ctx, warnings: string[]): RunConfig | null {
  const name = c.attrs.name ?? 'Senza nome'
  const type = c.attrs.type ?? ''
  const factory = c.attrs.factoryName ?? ''
  if (c.attrs.default === 'true') return null

  // ---- Maven ----
  if (type === 'MavenRunConfiguration' || /Maven/i.test(factory) || descendants(c, 'MavenRunnerParameters').length) {
    const params = descendants(c, 'MavenRunnerParameters')[0]
    const runner = descendants(c, 'MavenRunnerSettings')[0]
    const goals = optList(params, 'goals').join(' ')
    const profiles = [...optList(params, 'profiles')]
    // profilesMap: «-P» attivi e disattivati (!nome)
    const map = optMap(params, 'profilesMap')
    for (const [p, on] of Object.entries(map)) if (on === 'true' && !profiles.includes(p)) profiles.push(p)
    const root = macro(opt(params, 'workingDirPath'), ctx) ?? sep(ctx.projectDir)
    const cfg = base(name, goals.split(/\s+/).some((g) => /quarkus:dev/.test(g)) ? 'quarkus' : 'maven', root, ctx)
    if (cfg.type === 'quarkus') cfg.tool = 'maven'
    cfg.goals = goals
    cfg.profiles = profiles.join(',')
    cfg.vmOptions = opt(runner, 'vmOptions') ?? ''
    cfg.env = optMap(runner, 'environmentProperties')
    const props = optMap(runner, 'mavenProperties')
    cfg.args = Object.entries(props).map(([k, v]) => (v ? `-D${k}=${v}` : `-D${k}`)).join(' ')
    cfg.debugPort = debugPortIn(cfg.args, cfg.vmOptions) ?? 5005
    const hint = jdkHint(opt(runner, 'jreName'))
    if (hint) warnings.push(`«${name}»: IntelliJ usava il JDK ${hint}; scegli il JDK del servizio nell'elenco dei servizi.`)
    if (!goals) {
      warnings.push(`«${name}»: nessun obiettivo Maven indicato, importata vuota.`)
    }
    return cfg
  }

  // ---- Gradle ----
  if (type === 'GradleRunConfiguration' || /Gradle/i.test(factory) || descendants(c, 'ExternalSystemSettings').length) {
    const s = descendants(c, 'ExternalSystemSettings')[0]
    const tasks = optList(s, 'taskNames').join(' ')
    const root = macro(opt(s, 'externalProjectPath'), ctx) ?? sep(ctx.projectDir)
    const cfg = base(name, /quarkusDev/.test(tasks) ? 'quarkus' : 'gradle', root, ctx)
    if (cfg.type === 'quarkus') cfg.tool = 'gradle'
    cfg.tasks = tasks
    cfg.args = opt(s, 'scriptParameters') ?? ''
    cfg.vmOptions = opt(s, 'vmOptions') ?? ''
    cfg.env = optMap(s, 'env')
    cfg.debugPort = debugPortIn(cfg.args, cfg.vmOptions) ?? 5005
    if (!tasks) warnings.push(`«${name}»: nessun task Gradle indicato, importata vuota.`)
    return cfg
  }

  // ---- Applicazione Java (anche Spring Boot di IntelliJ Ultimate) ----
  if (type === 'Application' || /SpringBoot/i.test(type) || opt(c, 'MAIN_CLASS_NAME')) {
    const mainClass = opt(c, 'MAIN_CLASS_NAME')
    const root = macro(opt(c, 'WORKING_DIRECTORY'), ctx) ?? sep(ctx.projectDir)
    const cfg = base(name, 'application', root, ctx)
    cfg.mainClass = mainClass
    cfg.vmOptions = opt(c, 'VM_PARAMETERS') ?? ''
    cfg.args = opt(c, 'PROGRAM_PARAMETERS') ?? ''
    for (const e of descendants(c, 'env')) if (e.attrs.name) cfg.env[e.attrs.name] = e.attrs.value ?? ''
    const module = child(c, 'module')?.attrs.name
    if (!mainClass) warnings.push(`«${name}»: manca la classe con il main${module ? ` (modulo ${module})` : ''}.`)
    if (module) warnings.push(`«${name}»: il modulo IntelliJ «${module}» non si importa; la cartella di lavoro è ${root}.`)
    const jre = opt(c, 'ALTERNATIVE_JRE_PATH')
    if (jre && opt(c, 'ALTERNATIVE_JRE_PATH_ENABLED') === 'true') warnings.push(`«${name}»: IntelliJ usava un JRE alternativo (${jre}); scegli il JDK nell'elenco dei servizi.`)
    cfg.debugPort = debugPortIn(cfg.vmOptions) ?? 5005
    return cfg
  }

  // ---- Debug remoto ----
  if (type === 'Remote' || /Remote/i.test(factory)) {
    const cfg = base(name, 'attach', sep(ctx.projectDir), ctx)
    cfg.host = opt(c, 'HOST') ?? 'localhost'
    cfg.port = Number(opt(c, 'PORT') ?? opt(c, 'ADDRESS') ?? '5005') || 5005
    cfg.debugPort = cfg.port
    return cfg
  }

  warnings.push(`«${name}»: tipo «${type || factory}» non supportato (non importata).`)
  return null
}

/** Run configuration di un file XML di IntelliJ (runConfigurations/*.xml, .run/*.run.xml o workspace.xml). */
export function parseIdeaXml(xml: string, ctx: Ctx): IdeaImportResult {
  const warnings: string[] = []
  const configs: RunConfig[] = []
  let doc: XmlNode
  try {
    doc = parseXml(xml)
  } catch {
    return { configs, warnings: ['File XML non leggibile.'] }
  }
  for (const c of descendants(doc, 'configuration')) {
    // In workspace.xml dentro RunManager; altrove <configuration> compare anche annidato (es. dentro altri elementi): si tengono solo quelli con un tipo.
    if (!c.attrs.type && !c.attrs.factoryName) continue
    const cfg = convert(c, ctx, warnings)
    if (cfg) configs.push(cfg)
  }
  return { configs, warnings }
}

/** Legge tutte le run configuration di IntelliJ di un progetto: .idea/runConfigurations, .run e workspace.xml. */
export function readIdeaProject(projectDir: string, disk: Disk, newId: () => string): IdeaImportResult {
  const ctx: Ctx = { projectDir, newId }
  const out: IdeaImportResult = { configs: [], warnings: [] }
  const add = (text: string | null, source: string) => {
    if (!text) return
    const r = parseIdeaXml(text, ctx)
    out.configs.push(...r.configs)
    out.warnings.push(...r.warnings.map((w) => (r.warnings.length > 1 ? `${w}` : w)))
    void source
  }
  const dirs = [`${sep(projectDir)}\\.idea\\runConfigurations`, `${sep(projectDir)}\\.run`]
  for (const dir of dirs) {
    for (const e of disk.list(dir)) if (!e.dir && /\.xml$/i.test(e.name)) add(disk.read(`${dir}\\${e.name}`), e.name)
  }
  add(disk.read(`${sep(projectDir)}\\.idea\\workspace.xml`), 'workspace.xml')
  // Lo stesso nome può comparire in più file (workspace.xml ripete le condivise): si tiene la prima.
  const seen = new Set<string>()
  out.configs = out.configs.filter((c) => {
    const k = `${c.type}|${c.name}|${c.root}|${c.goals ?? c.tasks ?? c.mainClass ?? ''}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return out
}

export { splitArgs }
