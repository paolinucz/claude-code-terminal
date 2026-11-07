// Adapter Gradle: il language server per build.gradle dell'estensione Gradle for Java (MIT).
// Particolarità:
// - non usa stdio: si collega come client a una named pipe il cui nome riceve come primo
//   argomento. L'SDK apre la pipe (transport «pipe») e sostituisce ${pipe};
// - in initialize vuole initializationOptions.settings (senza, NullPointerException), con le
//   impostazioni di Gradle che userebbe l'estensione di VS Code. Null = predefinite (wrapper).
import { join } from 'node:path'
import { lspAdapter } from './cct-plugin-sdk.mjs'

lspAdapter({
  id: 'gradle-ls',
  name: 'Gradle Language Server',
  rootMarkers: ['settings.gradle', 'settings.gradle.kts', 'build.gradle', '.git'],
  rootStrategy: 'outermost',
  server: (ctx) => ({
    ...ctx.runtime('java', ['-Xmx512m', '-cp', join(ctx.plugin.dir, 'server', '*'), 'com.microsoft.gradle.GradleLanguageServer', '${pipe}']),
    transport: 'pipe'
  }),
  initializationOptions: () => ({
    settings: { gradleWrapperEnabled: true, gradleVersion: null, gradleHome: null, gradleUserHome: null }
  })
})
