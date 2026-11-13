# CCT Plugin API · versione 1

> Per le pagine dei plugin, i contributi all'interfaccia, i servizi `app.*` e i permessi vedi [PLUGIN_API_DOCS.md](PLUGIN_API_DOCS.md). Questo file descrive il protocollo dell'adapter per i language server.

Specifica dell'interfaccia tra Magnolia e i plugin di linguaggio (requisiti X1–X9).

## 1. Idea

I language server differiscono molto: come si avviano, che trasporto usano (stdio, named pipe), che impostazioni vogliono, che notifiche proprie mandano, quali parti del protocollo LSP implementano davvero. Per non riempire l'app di casi speciali:

- **l'app parla con ogni plugin con una sola API, piccola e stabile** (questa);
- **ogni plugin contiene un adapter**, un modulo JavaScript che implementa l'API e fa l'adattamento vero e proprio verso il suo server;
- per non riscrivere ogni volta la parte LSP comune c'è un **SDK** (`magnolia-plugin-sdk/cct-plugin-sdk.mjs`) da includere nel pacchetto: un adapter tipico è di 20–30 righe.

```
┌───────────── App ─────────────┐   CCT Plugin API (JSON-RPC su stdio)   ┌──── Processo del plugin ────┐
│ editor, Problemi, esplora file│ ◄────────────────────────────────────► │ adapter.mjs  (+ SDK)        │
│ host dei plugin               │                                        │   └─► language server(s)    │
└───────────────────────────────┘                                        │       stdio / pipe / altro  │
                                                                         └─────────────────────────────┘
```

L'app non parla mai direttamente con un language server: vede solo adapter. Un adapter può anche non usare LSP (per esempio un linter da riga di comando).

## 2. Pacchetto

Un plugin è uno zip con estensione `.ccplugin`:

```
plugin.json          manifest
adapter.mjs          adapter (punto di ingresso indicato da "main")
cct-plugin-sdk.mjs   SDK (se l'adapter lo usa)
server/ …            file del server inclusi nel pacchetto (facoltativi)
```

### plugin.json

```json
{
  "id": "cct.java",
  "name": "Java",
  "version": "1.0.0",
  "publisher": "Magnolia",
  "description": "…",
  "license": "EPL-2.0",
  "apiVersion": 1,
  "main": "adapter.mjs",
  "requires": [],
  "languages": [{ "id": "java", "extensions": [".java"], "monaco": "java" }],
  "downloads": [{ "id": "jre", "url": "https://…", "sha256": "…", "size": 58720256, "type": "zip", "to": "jre", "strip": true }],
  "provides": { "runtimes": { "java": { "command": "${downloads}/jre/bin/java.exe", "args": [] } } },
  "activities": ["Avvia Eclipse JDT Language Server con il runtime Java del plugin"]
}
```

| Campo | Significato |
| --- | --- |
| `apiVersion` | Versione di questa API che l'adapter implementa (oggi 1). |
| `main` | File dell'adapter, eseguito con Node (Electron in modalità Node) in un processo separato. |
| `languages` | Linguaggi e file che il plugin gestisce; `monaco` è il linguaggio per la colorazione. Servono all'app per sapere a quale plugin mandare un file, prima ancora di avviarlo. |
| `downloads` | File scaricati all'installazione e verificati (`sha256` o `integrity` npm). Finiscono in `${downloads}/<to>`. |
| `provides.runtimes` | Runtime messi a disposizione degli altri plugin (es. `java`). |
| `requires` | Plugin necessari (per id). I loro runtime arrivano all'adapter in `initialize`. |
| `activities` | Frasi per l'utente: cosa fa il plugin. Si mostrano prima dell'installazione (X3). |

Variabili nei percorsi del manifest: `${plugin}` (cartella del plugin) e `${downloads}`.

## 3. Protocollo

JSON-RPC 2.0 su stdin/stdout del processo dell'adapter, con intestazioni `Content-Length` (stesso formato di LSP). Lo stderr dell'adapter va nel log dell'app.

Convenzioni:
- **percorsi** di file Windows assoluti (`C:\progetti\app\src\Main.java`), non URI;
- **posizioni** con righe e colonne **da 1** (come Monaco);
- testi descrittivi in Markdown.

### 3.1 App → adapter (richieste)

**`initialize`**

```ts
params: {
  apiVersion: 1
  plugin: { id: string; dir: string; downloadsDir: string; dataDir: string }
  runtimes: Record<string, { command: string; args: string[] }>   // dai plugin richiesti
  locale: 'it'
}
result: {
  capabilities: { completion: boolean; hover: boolean; definition: boolean; diagnostics: boolean }
}
```

`dataDir` è una cartella scrivibile tutta per il plugin (cache, workspace del server).

**`completion`** · `{ path, position: { line, column } }` → `{ items: CompletionItem[]; incomplete: boolean }`

```ts
CompletionItem {
  label: string
  kind: 'text' | 'method' | 'function' | 'constructor' | 'field' | 'variable' | 'class' | 'interface' | 'module'
      | 'property' | 'unit' | 'value' | 'enum' | 'keyword' | 'snippet' | 'color' | 'file' | 'reference' | 'folder'
      | 'enumMember' | 'constant' | 'struct' | 'event' | 'operator' | 'typeParameter'
  detail?: string
  documentation?: string          // Markdown
  insertText: string
  snippet?: boolean               // insertText usa la sintassi degli snippet ($1, ${1:nome})
  range?: Range                   // testo da sostituire; se assente, la parola sotto il cursore
  sortText?: string
  filterText?: string
}
```

**`hover`** · `{ path, position }` → `{ contents: string[] /* Markdown */; range?: Range } | null`

**`definition`** · `{ path, position }` → `Location[]` con `Location { path: string; range: Range }`

**`shutdown`** · `{}` → `null`. Dopo la risposta l'app chiude il processo.

`Range { start: { line, column }; end: { line, column } }`

### 3.2 App → adapter (notifiche)

| Metodo | Parametri |
| --- | --- |
| `document/open` | `{ path, languageId, text, workspace? }` — `workspace` è la cartella di progetto aperta nell'app, un suggerimento per trovare la radice |
| `document/change` | `{ path, text }` — testo completo |
| `document/save` | `{ path, text }` |
| `document/close` | `{ path }` |

### 3.3 Adapter → app (notifiche)

| Metodo | Parametri |
| --- | --- |
| `diagnostics` | `{ path, source: string, items: Diagnostic[] }` — sostituisce le diagnostiche precedenti di quella `source` per quel file |
| `status` | `{ id: string, name: string, root?: string, state: 'starting' \| 'ready' \| 'error' \| 'stopped', message?: string }` — un `id` per ogni server gestito dall'adapter |
| `log` | `{ level: 'info' \| 'warn' \| 'error', message }` |

```ts
Diagnostic { severity: 'error' | 'warning' | 'info' | 'hint'; message: string; code?: string; source?: string; range: Range }
```

### 3.4 Più plugin sullo stesso file (X6)

Se più plugin gestiscono lo stesso linguaggio (es. TypeScript e Angular), l'app manda il documento a tutti: unisce i completamenti e le definizioni, prende la prima descrizione non vuota, tiene separate le diagnostiche per `source`.

## 4. SDK

`cct-plugin-sdk.mjs` (nessuna dipendenza) offre:

- `runAdapter(handlers)` — implementa il protocollo: basta dare le funzioni per le richieste e le notifiche;
- `lspAdapter(options)` — adapter completo per un language server LSP: trova la radice del progetto, avvia un server per radice, sincronizza i documenti, converte risposte e diagnostiche (push e pull) nel formato dell'API.

```js
import { lspAdapter } from './cct-plugin-sdk.mjs'

lspAdapter({
  name: 'Pyright',
  rootMarkers: ['pyproject.toml', 'setup.py', 'requirements.txt', '.git'],
  server: (ctx, root) => ({ command: process.execPath, args: [`${ctx.plugin.downloadsDir}/pyright/langserver.index.js`, '--stdio'], env: { ELECTRON_RUN_AS_NODE: '1' } })
})
```

Opzioni principali di `lspAdapter`:

| Opzione | Uso |
| --- | --- |
| `server(ctx, root)` | Comando del server: `{ command, args, env?, transport?: 'stdio' \| 'pipe' }`. Con `pipe` l'SDK apre una named pipe e mette il suo nome al posto di `${pipe}` negli argomenti. |
| `rootMarkers`, `rootStrategy`, `activationFiles` | Come trovare la radice del progetto e quando il server non deve partire. |
| `languageId(path)` | Linguaggio LSP del documento, se diverso da quello del manifest. |
| `initializationOptions(ctx, root)`, `settings` | Opzioni di avvio e risposte a `workspace/configuration`. |
| `onNotification` | Notifiche proprie del server (es. `language/status` di jdtls). |

## 5. Ciclo di vita

1. All'apertura del primo file di un suo linguaggio l'app avvia l'adapter (`node <plugin>/<main>`), con cartella di lavoro = cartella del plugin.
2. `initialize`, poi i documenti.
3. Disattivazione, aggiornamento o disinstallazione del plugin, o chiusura dell'app: `shutdown`, poi il processo viene chiuso.
4. Se il processo dell'adapter si ferma, l'app lo segnala nello stato e lo riavvia alla prossima apertura di un file.

## 6. Sicurezza

L'adapter e i server girano con i permessi dell'utente: come per le estensioni di VS Code, conta la fiducia nel pacchetto. Per questo (X3, X4, X7):

- prima dell'installazione si vedono attività, download (indirizzo, dimensione, checksum), plugin richiesti e SHA-256 del pacchetto;
- i download sono verificati con il loro checksum;
- a ogni avvio l'app ricontrolla i file del plugin e blocca quelli modificati.
