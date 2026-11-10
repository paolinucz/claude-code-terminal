// Tipi minimi dell'SDK dei plugin (plugins/sdk/cct-plugin-sdk.mjs, scritto in JavaScript).
export interface GutterMarkerOut {
  line: number
  kind: 'breakpoint' | 'breakpoint-disabled' | 'stopped'
  hint?: string
  reveal?: boolean
}
export interface AdapterApp {
  log(level: 'info' | 'warn' | 'error', message: string): void
  settings: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }
  session: { create(request: Record<string, unknown>): Promise<{ id: string }>; kill(id: string): Promise<unknown>; status(id: string): Promise<string | null> }
  plugin(plugin: string, method: string, params?: Record<string, unknown>): Promise<unknown>
  emit(event: string, data: unknown): void
  notify(message: string, kind?: 'info' | 'ok' | 'warn' | 'error'): void
  terminal: { show(sessionId: string): void; hive(key: string, title: string, sessionIds: string[]): void }
  editor: { markers(path: string, markers: GutterMarkerOut[]): void; clearMarkers(): void }
}
export interface AdapterContext {
  plugin: { id: string; dir: string; downloadsDir: string; dataDir: string }
}
export interface AdapterHandlers {
  initialize?(ctx: AdapterContext, app: AdapterApp): Promise<Record<string, unknown> | void> | Record<string, unknown> | void
  call?(method: string, params: Record<string, any>): Promise<unknown> | unknown
  shutdown?(): Promise<void> | void
}
export function runAdapter(handlers: AdapterHandlers): AdapterApp
