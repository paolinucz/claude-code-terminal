import type { RunConfig } from '@shared/java'

/** Divide una riga di argomenti come farebbe una shell: spazi, con virgolette doppie e singole. */
export function splitArgs(line: string | undefined): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let any = false
  for (const ch of (line ?? '').trim()) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      any = true
    } else if (/\s/.test(ch)) {
      if (cur || any) out.push(cur)
      cur = ''
      any = false
    } else cur += ch
  }
  if (cur || any) out.push(cur)
  return out
}

/** Argomento della JVM per il debug (JDWP). `suspend` ferma l'avvio finché il debugger non si collega. */
export const jdwpAgent = (port: number, suspend: boolean): string => `-agentlib:jdwp=transport=dt_socket,server=y,suspend=${suspend ? 'y' : 'n'},address=127.0.0.1:${port}`

export interface LaunchContext {
  mode: 'run' | 'debug'
  /** Cartella del JDK scelto. */
  jdkHome: string
  /** mvnw.cmd / mvn.cmd e gradlew.bat / gradle.bat già risolti. */
  mavenCmd?: string
  gradleCmd?: string
  /** PATH attuale (si antepone la cartella bin del JDK). */
  path: string
  /** Variabili già presenti nell'ambiente dell'utente (per non sovrascrivere le sue scelte). */
  userEnv?: Record<string, string | undefined>
  /** Windows: usa i certificati di sistema (antivirus o proxy che ispezionano HTTPS). */
  windowsRootCerts: boolean
  /** application: percorsi di classi e librerie risolti da jdtls. */
  classpath?: string[]
}

export interface Launch {
  title: string
  cwd: string
  file: string
  args: string[]
  env: Record<string, string>
  /** Porta di debug a cui collegarsi dopo l'avvio. */
  debugPort?: number
  /** Riga leggibile, per mostrarla all'utente. */
  line: string
}

/** Separa gli argomenti dello strumento di build (-Dx, -Pprofilo) da quelli del programma. */
const partition = (a: string[]): [string[], string[]] => [a.filter((x) => /^-[DP]/.test(x)), a.filter((x) => !/^-[DP]/.test(x))]

const TRUST = '-Djavax.net.ssl.trustStoreType=Windows-ROOT'
const quoteForLine = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)

function baseEnv(cfg: RunConfig, ctx: LaunchContext): Record<string, string> {
  const env: Record<string, string> = { ...cfg.env, JAVA_HOME: ctx.jdkHome, PATH: `${ctx.jdkHome}\\bin;${ctx.path}` }
  // JAVA_TOOL_OPTIONS arriva anche ai processi figli (daemon di Gradle, JVM forkate da Maven): serve per scaricare le dipendenze.
  const existing = cfg.env.JAVA_TOOL_OPTIONS ?? ctx.userEnv?.JAVA_TOOL_OPTIONS ?? ''
  const tool = [existing, ctx.windowsRootCerts && !existing.includes(TRUST) ? TRUST : ''].filter(Boolean).join(' ')
  if (tool) env.JAVA_TOOL_OPTIONS = tool
  return env
}

/** Esegue uno script .cmd/.bat: cmd.exe /c call «script» argomenti. */
const viaCmd = (script: string, args: string[]) => ({ file: 'cmd.exe', args: ['/d', '/c', 'call', script, ...args] })

/**
 * Costruisce il comando per avviare una run configuration, anche in debug.
 * Maven e Gradle passano la porta di debug nel modo giusto per ciò che avviano (Quarkus dev, Spring Boot, test…).
 */
export function buildLaunch(cfg: RunConfig, ctx: LaunchContext): Launch {
  const debug = ctx.mode === 'debug'
  const port = cfg.debugPort || 5005
  const env = baseEnv(cfg, ctx)
  const title = `${debug ? 'Debug' : 'Esegui'} · ${cfg.name}`
  const vm = splitArgs(cfg.vmOptions)
  const extra = splitArgs(cfg.args)

  if (cfg.type === 'application') {
    if (!cfg.mainClass) throw new Error('Manca la classe con il main.')
    if (!ctx.classpath?.length) throw new Error('Classpath non disponibile: aspetta che il progetto sia importato dal language server Java.')
    const args = [...(debug ? [jdwpAgent(port, true)] : []), ...vm, '-cp', ctx.classpath.join(';'), cfg.mainClass, ...extra]
    const file = `${ctx.jdkHome}\\bin\\java.exe`
    return { title, cwd: cfg.root, file, args, env, debugPort: debug ? port : undefined, line: [file, ...args].map(quoteForLine).join(' ') }
  }

  const isGradle = cfg.type === 'gradle' || (cfg.type === 'quarkus' && cfg.tool === 'gradle')
  const goals = cfg.type === 'quarkus' ? (isGradle ? 'quarkusDev' : 'quarkus:dev') : isGradle ? (cfg.tasks ?? '') : (cfg.goals ?? '')
  const items = splitArgs(goals)
  if (!items.length) throw new Error(isGradle ? 'Indica almeno un task di Gradle.' : 'Indica almeno un obiettivo di Maven.')
  const has = (re: RegExp) => items.some((g) => re.test(g))
  const quarkus = cfg.type === 'quarkus' || has(/quarkus:dev|quarkusDev/)
  const args: string[] = [...items]
  let debugPort: number | undefined

  if (!isGradle) {
    if (!ctx.mavenCmd) throw new Error('Maven non trovato: nel progetto non c\'è mvnw e mvn non è nel PATH.')
    for (const p of splitArgs((cfg.profiles ?? '').replace(/,/g, ' '))) args.push('-P' + p)
    if (cfg.type === 'quarkus' || quarkus) {
      if (vm.length) args.push(`-Djvm.args=${vm.join(' ')}`)
      // -D e -P sono di Maven (per esempio quelli importati da IntelliJ); il resto va al programma.
      const [forTool, forApp] = partition(extra)
      args.push(...forTool)
      if (forApp.length && cfg.type === 'quarkus') args.push(`-Dquarkus.args=${forApp.join(' ')}`)
      else args.push(...forApp)
    } else {
      if (vm.length) env.MAVEN_OPTS = [env.MAVEN_OPTS ?? ctx.userEnv?.MAVEN_OPTS, ...vm].filter(Boolean).join(' ')
      args.push(...extra)
    }
    if (debug) {
      debugPort = port
      if (quarkus) args.push(`-Ddebug=${port}`, '-Dsuspend=false')
      else if (has(/spring-boot:run/)) args.push(`-Dspring-boot.run.jvmArguments=${jdwpAgent(port, false)}`)
      else if (has(/^(test|verify|integration-test|surefire:test)$/)) args.push(`-Dmaven.surefire.debug=${jdwpAgent(port, true)}`, `-Dmaven.failsafe.debug=${jdwpAgent(port, true)}`)
      else env.MAVEN_OPTS = [env.MAVEN_OPTS ?? ctx.userEnv?.MAVEN_OPTS, jdwpAgent(port, false)].filter(Boolean).join(' ')
    }
    const r = viaCmd(ctx.mavenCmd, args)
    return { title, cwd: cfg.root, file: r.file, args: r.args, env, debugPort, line: [ctx.mavenCmd, ...args].map(quoteForLine).join(' ') }
  }

  if (!ctx.gradleCmd) throw new Error('Gradle non trovato: nel progetto non c\'è gradlew e gradle non è nel PATH.')
  if (quarkus) {
    if (vm.length) args.push(`-Djvm.args=${vm.join(' ')}`)
    const [forTool, forApp] = partition(extra)
    args.push(...forTool)
    if (forApp.length && cfg.type === 'quarkus') args.push(`-Dquarkus.args=${forApp.join(' ')}`)
    else args.push(...forApp)
  } else {
    if (vm.length) env.GRADLE_OPTS = [env.GRADLE_OPTS ?? ctx.userEnv?.GRADLE_OPTS, ...vm].filter(Boolean).join(' ')
    args.push(...extra)
  }
  if (debug) {
    if (quarkus) {
      debugPort = port
      args.push(`-Ddebug=${port}`, '-Dsuspend=false')
    } else {
      // --debug-jvm usa la porta 5005 e aspetta il debugger (suspend): va bene per run, bootRun e test.
      debugPort = 5005
      args.push('--debug-jvm')
    }
  }
  const r = viaCmd(ctx.gradleCmd, args)
  return { title, cwd: cfg.root, file: r.file, args: r.args, env, debugPort, line: [ctx.gradleCmd, ...args].map(quoteForLine).join(' ') }
}
