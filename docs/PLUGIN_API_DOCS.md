# CCT Plugin API: riferimento per chi scrive un plugin

Questo è il documento di riferimento per **tutto ciò che un plugin può fare**. Principio: l'app non conosce nessun linguaggio né strumento; offre servizi generici e il plugin porta il resto (motore, interfaccia, dati). Niente di specifico di un plugin va nel core: se manca un servizio, si aggiunge qui in forma generica.

Documenti collegati:
- [plugin-api.md](plugin-api.md): protocollo JSON-RPC tra app e adapter per i language server (completamento, diagnostica…).
- [plugin-contributi.md](plugin-contributi.md): storia e piano per portare Java fuori dal core.

## 1. Anatomia di un plugin

Un pacchetto `.ccplugin` (zip) contiene:

```
plugin.json        manifest
adapter.mjs        motore: processo Node separato (opzionale)
ui/*.html|js|css   pagine che l'app mostra in un iframe isolato (opzionali)
ui/*.svg           icone
```

| Parte | Dove gira | Cosa fa | Come parla con l'app |
| --- | --- | --- | --- |
| **Adapter** | Processo Node (`ELECTRON_RUN_AS_NODE`), avviato quando serve | Logica, language server, processi, file, rete | SDK `app.*` (§5), JSON-RPC su stdin/stdout |
| **Pagine** | Iframe `sandbox="allow-scripts"`, senza `allow-same-origin`, CSP che vieta rete e frame | Interfaccia | Messaggi `postMessage` (§3) |
| **Manifest** | | Dichiara linguaggi, contributi, permessi, download | Letto dall'app |

Le pagine non hanno rete né accesso al sistema: per fare qualcosa chiamano l'adapter (`plugin.call`) o un servizio dell'app. L'adapter ha i permessi dell'utente (come qualsiasi programma installato): per questo si mostra cosa farà prima dell'installazione.

## 2. Manifest (`plugin.json`)

```json
{
  "id": "cct.mio-plugin",
  "name": "Mio plugin",
  "version": "1.0.0",
  "publisher": "Nome",
  "description": "Cosa fa, in una frase.",
  "apiVersion": 1,
  "main": "adapter.mjs",
  "requires": ["cct.java"],
  "permissions": ["terminal", "files.read"],
  "activities": ["Avvia X", "Scarica Y"],
  "storage": { "settingsPrefixes": ["miopl."] },
  "languages": [{ "id": "miolang", "extensions": [".ml"], "monaco": "plaintext" }],
  "contributes": { "...": "vedi sotto" },
  "downloads": [{ "id": "tool", "url": "https://…", "sha256": "…", "type": "zip", "to": "tool", "strip": true }]
}
```

| Campo | Note |
| --- | --- |
| `id` | Minuscole, cifre, punti, trattini. Unico. |
| `main` | Adapter `.mjs`/`.cjs`/`.js` dentro il pacchetto. Senza adapter il plugin può dare solo colorazione e pagine che non chiamano l'adapter. |
| `apiVersion` | Versione della Plugin API implementata dall'adapter (oggi **1**). Se diversa, l'installazione avvisa. |
| `requires` | Plugin che devono essere attivi; solo questi si possono chiamare con `app.plugin` (§5). |
| `permissions` | Servizi sensibili usati dalle pagine e dall'adapter (§6). |
| `activities` | Frasi per l'utente, mostrate prima dell'installazione. |
| `storage.settingsPrefixes` | Prefissi aggiuntivi alle impostazioni dell'app, oltre a `plugin.<id>.`. Servono solo per tenere dati già salvati sotto un nome storico (per Java `["java."]`). |
| `downloads` | File da scaricare all'installazione: checksum obbligatorio (`sha256` o `integrity`), tipo `zip`, `tar.gz` o `file`. |

I percorsi nel pacchetto devono essere relativi, senza `..`. Il manifest è validato all'importazione (`validate` in `PluginManager.ts`).

### 2.1 Contributi (`contributes`)

| Contributo | Cosa aggiunge |
| --- | --- |
| `sidebarViews: [{id, title, entry, icon?, shortcut?}]` | Voce nella barra laterale: icona SVG del pacchetto e pagina. `shortcut` è solo il testo del suggerimento. L'id completo della vista è `<id-plugin>:<id>`. |
| `explorerViews: [{id, title, entry}]` | Vista alternativa dell'Esplora file (pulsante accanto a «File»). Riceve in `state` i segni di git, revisioni e errori. |
| `editorGutter: {languages, click}` | Margine dell'editor per i file di quei linguaggi. L'adapter decide i segni (`app.editor.markers`), il clic chiama `click` con `{path, line}`. |
| `commands: [{id, title, keywords?, hint?, method \| openView}]` | Comandi nella palette (Ctrl+K), mostrati come «Nome plugin: titolo». Con `method` l'app chiama quel metodo dell'adapter con `{command: id}`; con `openView` apre la vista della barra laterale con quell'id. Uno solo dei due. |
| `settings: {entry, title?}` | Pagina di impostazioni: compare un pulsante «Impostazioni» nella scheda del plugin (pannello Plugin) che la apre in una finestra. |

Le pagine sono HTML/JS/CSS statici dentro il pacchetto, servite da `app://plugin/<id-plugin>/<percorso>` solo se il plugin è **attivo e non modificato**. Estensioni ammesse: `.html .js .css .svg .png .json`.

## 3. Pagine: protocollo dei messaggi

Ogni pagina comunica con `window.parent.postMessage`. Schema consigliato:

```js
let nextId = 1; const pending = new Map()
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  parent.postMessage({ cct: 'rpc', id, method, params }, '*')
})
addEventListener('message', (e) => {
  const m = e.data
  if (m?.cct === 'rpc-result') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.value) : p.reject(new Error(m.error)) }
  else if (m?.cct === 'init') { /* m.win, m.cwd, m.theme, m.plugin */ }
  else if (m?.cct === 'event') { /* m.event, m.data */ }
  else if (m?.cct === 'state') { /* m.decor (solo explorerViews) */ }
})
parent.postMessage({ cct: 'ready' }, '*')   // dopo aver registrato i listener
```

Esempi completi: `plugins/java/ui/packages.html` (vista a package), `plugins/java-dev/ui/run.html` (pannello con adapter e dialoghi propri).

### 3.1 Pagina → app

`{cct:'ready'}` dice che la pagina è pronta: l'app risponde con `init` e `state`. `{cct:'rpc', id, method, params}` chiama un servizio e riceve `{cct:'rpc-result', id, ok, value | error}`.

| Metodo | Parametri | Risultato | Permesso |
| --- | --- | --- | --- |
| `plugin.call` | `{method, params}` | Risposta del metodo `call(method, params)` dell'**adapter di questo plugin** (mai di altri) | no |
| `editor.open` | `{path, line?, column?}` (da 1) | Apre il file nell'editor (alla riga) | no (il file deve stare nel progetto) |
| `files.reveal` | `{path}` | Mostra il file nell'Esplora file di sistema | no (nel progetto) |
| `files.index` | | Elenco dei file della cartella dell'Esplora file (relativi, `.gitignore` rispettato) | no |
| `files.read` | `{path}` | Contenuto del file (`FileContent`) | `files.read` (nel progetto) |
| `files.write` | `{path, text, expectedMtime?}` | Esito del salvataggio; con `expectedMtime` rifiuta se il file è cambiato | `files.write` (nel progetto) |
| `terminal.show` | `{sessionId}` | Apre il terminale di una sessione (per esempio avviata dall'adapter con `app.session.create`); `true` se l'ha trovata | `terminal` |
| `settings.get` | `{key}` | Valore salvato (`null` se manca) | no |
| `settings.set` | `{key, value}` | | no |
| `ui.notify` | `{message, kind?}` | Avviso (toast) nell'app. `kind`: `info` `ok` `warn` `error` | no |
| `ui.confirm` | `{message, title?, okLabel?, danger?}` | `true` se l'utente conferma | no |
| `ui.prompt` | `{message, title?, value?, placeholder?, okLabel?}` | Testo inserito, `null` se annulla | no |
| `dialog.pickFolder` | `{title?, defaultPath?}` | Percorso scelto o `null` | no |
| `dialog.pickFile` | `{title?, defaultPath?, filters?: [{name, extensions}]}` | Percorso scelto o `null` | no |
| `clipboard.copy` | `{text}` | Copia negli appunti (max 10.000 caratteri) | no |

Note:
- `settings.*`: la chiave è un nome corto (`[\w.-]{1,100}`); l'app la salva come `plugin.<id>.<chiave>`. Una pagina non può leggere le impostazioni di altri.
- `ui.*`: li disegna l'app nel suo stile e **sempre con il nome del plugin** («Richiesta del plugin X»): una pagina non può spacciare un messaggio per dell'app. Una finestra alla volta, al massimo 3 in coda.
- Un metodo sconosciuto o un permesso mancante dà `ok:false` con l'errore.
- «Nel progetto» significa dentro la cartella mostrata dall'Esplora file; fuori da lì la richiesta è rifiutata.

### 3.2 App → pagina

| Messaggio | Contenuto | Quando |
| --- | --- | --- |
| `{cct:'init', win, cwd, theme, plugin:{id, name}}` | `win`: è Windows; `cwd`: cartella del progetto; `theme`: variabili CSS (`--cct-bg`, `--cct-surface`, `--cct-surface-2`, `--cct-border`, `--cct-border-strong`, `--cct-text`, `--cct-text-muted`, `--cct-text-faint`, `--cct-accent`, `--cct-accent-soft`, `--cct-on-accent`, `--cct-ok`, `--cct-warn`, `--cct-danger`, `--cct-info`) | Dopo `ready`; di nuovo se cambia la cartella o l'accento |
| `{cct:'state', decor:{git, claude, errors}}` | Segni sui file (percorsi normalizzati) | Dopo `ready` e a ogni cambiamento |
| `{cct:'event', event, data}` | Evento dell'adapter (`app.emit`) o dell'app (sotto) | Quando accade |
| `{cct:'rpc-result', id, ok, value \| error}` | Risposta a una `rpc` | |

Eventi dell'app (nome sempre con prefisso `app.`, quindi non confondibili con quelli dell'adapter):

| Evento | `data` | Quando |
| --- | --- | --- |
| `app.workspace` | `{cwd}` | Cambia la cartella del progetto (foglio o cartella dell'Esplora file) |
| `app.file.changed` | `{paths}` | File cambiati nella cartella del progetto (raggruppati, ~300 ms) |
| `app.session.exit` | `{sessionId, exitCode}` | Una sessione (terminale, task) è terminata |

Per applicare il tema: `for (const [k, v] of Object.entries(m.theme)) document.documentElement.style.setProperty(k, v)`.

## 4. Adapter: ciclo di vita e SDK

```js
import { runAdapter } from '../sdk/cct-plugin-sdk.mjs'   // nel pacchetto: copiato dallo script di build

runAdapter({
  async initialize(ctx, app) { /* ctx.plugin = {id, dir, downloadsDir, dataDir}; restituisce le capacità */ },
  async call(method, params) { /* risposta a plugin.call delle pagine e ai comandi con `method` */ },
  async shutdown() { /* chiudi processi figli */ }
})
```

L'adapter parte quando serve (primo uso, un file del suo linguaggio, una chiamata) e si ferma alla disattivazione, all'aggiornamento o alla chiusura dell'app. `ctx.plugin.dataDir` è la cartella per i dati del plugin (sopravvive agli aggiornamenti).

## 5. Servizi `app.*` per l'adapter

| Servizio | Descrizione | Permesso |
| --- | --- | --- |
| `app.log(level, message)` | Registro dell'app (`info` `warn` `error`) | no |
| `app.status({id, name, root, state, message})` | Stato mostrato nell'interfaccia (`starting` `ready` `error` `stopped`) | no |
| `app.diagnostics(path, source, items)` | Errori e avvisi di un file (language server) | no |
| `app.settings.get(key)` / `set(key, value)` | Impostazioni dell'app. Valgono solo chiavi `plugin.<id>.…` o dei `storage.settingsPrefixes` | no |
| `app.session.create(request)` / `kill(id)` / `status(id)` | Terminali «task»: un comando in un PTY (avviare un'applicazione, un build) | no |
| `app.terminal.show(sessionId)` | Mostra in un pannello il terminale di una sessione | `terminal` |
| `app.notify(message, kind?)` | Avviso (toast) nell'app, con il nome del plugin | no |
| `app.emit(event, data)` | Evento per le pagine di questo plugin (`{cct:'event'}`) | no |
| `app.plugin(idPlugin, metodo, parametri)` | Richiesta all'adapter di un plugin dichiarato in `requires` | no (ma serve `requires`) |
| `app.editor.markers(path, [{line, kind, hint?, reveal?}])` / `clearMarkers()` | Segni nel margine dell'editor (`kind`: `breakpoint` `breakpoint-disabled` `stopped`); `reveal` apre il file alla riga | no (serve `editorGutter`) |

Il clic nel margine arriva all'adapter come `call(<editorGutter.click>, {path, line})`. I tipi sono in `plugins/java-dev/src/cct-plugin-sdk.d.mts` (se scrivi l'adapter in TypeScript).

Gli eventi `app.notify` e `app.terminal.show` viaggiano come eventi riservati (`$ui.notify`, `$terminal.show`) gestiti dall'app: non arrivano mai alle pagine.

## 6. Permessi

Dichiarati in `permissions`, mostrati all'utente prima dell'installazione («Permessi richiesti»), controllati a ogni richiesta.

| Permesso | Consente |
| --- | --- |
| `terminal` | `terminal.show` (pagine) e `app.terminal.show` (adapter) |
| `files.read` | `files.read` dalle pagine, nel progetto |
| `files.write` | `files.write` dalle pagine, nel progetto |

Quello che non richiede permesso è a basso rischio o mediato dall'utente: aprire un file nell'editor, avvisi, dialoghi, selettori di file e cartelle, impostazioni del proprio plugin, chiamate al proprio adapter. Il permesso riguarda le **pagine** (codice isolato); l'adapter, essendo un processo Node con i permessi dell'utente, può già leggere e scrivere i file: per questo resta tra le cose che si mostrano in «Cosa eseguirà».

## 7. Sicurezza in breve

- Le pagine non hanno accesso all'app, ai cookie né alla rete; non possono caricare altri frame; l'iframe non ha mai `allow-same-origin`.
- L'app serve solo file statici dentro la cartella di un plugin attivo e non modificato (impronta del pacchetto verificata).
- Ogni richiesta è validata: percorsi dentro il progetto, metodi noti, permessi dichiarati, chiavi delle impostazioni nel proprio spazio, dialoghi e avvisi con testo limitato e nome del plugin.
- Un plugin può chiamare solo il proprio adapter e quelli dei plugin in `requires`.

## 8. Aggiungere un servizio all'API

1. **Pagine**: nuovo `case` in `renderer/src/plugins/PluginFrame.tsx` (con `need('permesso')` se sensibile). **Adapter**: richiesta o notifica in `main/plugins/PluginHost.ts` (`registerHostRequests`) e metodo in `plugins/sdk/cct-plugin-sdk.mjs` più tipo in `cct-plugin-sdk.d.mts`.
2. Se serve il processo principale: i quattro punti (handler in `main/index.ts`, `AppApi` in `shared/types.ts`, ponte in `preload/index.ts`, versione finta in `renderer/src/lib/api.ts`).
3. Nuovo permesso: aggiungilo a `PLUGIN_PERMISSIONS` in `shared/plugins.ts` (validazione e dialogo di installazione lo prendono da lì).
4. **Aggiorna questo documento.** Il servizio deve essere generico: se ha senso solo per un plugin, va nel plugin.

## 9. Ancora da fare

- Stile di base per le pagine (CSS condiviso con controlli già coerenti con l'app) per evitare che ogni plugin riscriva pulsanti, campi e modali.
- Versione dell'API delle pagine negoziata in `init` (oggi implicita nella versione dell'app).
- Build dell'interfaccia di un plugin (piccolo bundler) e aggiornamenti dei plugin.
- Conversione della vista «Esegui e debug» di Java in pagina del plugin e rimozione del codice Java dal core (vedi [plugin-contributi.md](plugin-contributi.md)).
