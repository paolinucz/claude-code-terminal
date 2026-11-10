// Adapter del plugin Docker (cct.docker): gestisce i container del sistema con il comando `docker`.
// L'app gli dà solo terminali, eventi per le sue pagine e l'apertura degli indirizzi web: niente di Docker nell'app.
import { runAdapter, type AdapterApp } from './cct-plugin-sdk.mjs'
import { DockerService } from './DockerService.mts'
import type { ContainerAction } from './types.mts'

let svc: DockerService
let app: AdapterApp

runAdapter({
  initialize(_ctx, a) {
    app = a
    svc = new DockerService({
      createTask: (req) => app.session.create({ ...req }),
      showTerminal: (id) => app.terminal.show(id),
      showHive: (key, title, ids) => app.terminal.hive(key, title, ids),
      emitEngine: (info) => app.emit('engine', info),
      emitChanged: () => app.emit('changed', null),
      log: (level, message) => app.log(level, message)
    })
  },

  /** Richieste delle pagine del plugin e comandi della palette: un metodo per ogni funzione del servizio. */
  async call(method, p) {
    switch (method) {
      case 'engine': return svc.engine()
      case 'startEngine': return svc.startEngine()
      case 'stopEngine': return svc.stopEngine()
      case 'list': return svc.list()
      case 'stats': return svc.stats((p.ids as string[]) ?? [])
      case 'act': return svc.act(p.action as ContainerAction, (p.ids as string[]) ?? [], { volumes: p.volumes === true })
      case 'logs': return svc.logs((p.ids as string[]) ?? [], String(p.workspace ?? ''))
      case 'shell': return svc.shell(String(p.id ?? ''), String(p.workspace ?? ''))
      // Dalla palette (Ctrl+K): l'app manda `{command: id}`.
      case 'command-start-engine': return svc.startEngine().then((i) => app.notify(i.state === 'ready' ? 'Docker è acceso.' : (i.message ?? 'Docker non è partito.'), i.state === 'ready' ? 'ok' : 'error'))
      default: throw new Error(`Metodo non gestito: ${method}`)
    }
  },

  shutdown() {
    svc?.shutdown()
  }
})
