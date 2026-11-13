# Punti di estensione dell'interfaccia (Plugin API v2)

Un plugin non è una finestra: arricchisce l'app. Dichiara nel manifest **dove** vuole comparire (menu, barra di stato, eventi) e l'app disegna tutto con i propri componenti; l'adapter fornisce dati e fa le azioni. Le pagine in iframe (`sidebarViews`, `explorerViews`, pagine in finestra) restano per le superfici davvero libere.

Riferimento generale: [PLUGIN_API_DOCS.md](PLUGIN_API_DOCS.md). Codice: `src/shared/pluginExt.ts` (tipi e condizioni), `src/renderer/src/plugins/extensions.ts` (registro dei menu), `src/renderer/src/workspace/PluginStatusBar.tsx`, `src/main/plugins/PluginHost.ts` (`broadcast`, `ui/statusItem`).

## Regole

- Serve `apiVersion: 2` nel manifest per usare `menus`, `statusBar` ed `events` (i plugin v1 funzionano come prima: la v2 è additiva).
- **I comandi sono la base.** Un menu non contiene azioni proprie: rimanda a un comando di `contributes.commands` (lo stesso che compare nella palette). Il comando ha `method` (chiama l'adapter) oppure `openView` (apre una vista della barra laterale).
- Quando l'utente sceglie una voce, l'adapter riceve `call(method, { command, context })`; `context` ha gli stessi valori usati dalla condizione `when`.
- Niente di specifico di un linguaggio o di uno strumento nel core: se serve un punto di estensione nuovo, si aggiunge qui in forma generica.
- L'adapter parte quando serve: un elemento della barra di stato compare dopo che l'adapter ha mandato il primo testo, e un evento arriva solo a un adapter già in esecuzione.

## Menu (`contributes.menus`)

```json
{
  "apiVersion": 2,
  "contributes": {
    "commands": [{ "id": "open", "title": "Apri i container", "openView": "containers" }],
    "menus": {
      "explorer/context": [{ "command": "open", "when": "resourceName in [Dockerfile, compose.yml]", "group": "docker" }]
    }
  }
}
```

| Menu | Dove | Chiavi del contesto |
| --- | --- | --- |
| `explorer/context` | tasto destro su file o cartella dell'Esplora file | `resourcePath`, `resourceName`, `resourceExt`, `isDir`, `multiple`, `selection` (percorsi separati da a capo) |
| `editor/context` | tasto destro nell'editor | `resourcePath`, `resourceName`, `resourceExt`, `languageId`, `hasSelection`, e con una selezione `startLine`, `endLine`, `selectedText` (max 20.000 caratteri) |
| `terminal/toolbar` | barra di stato di un terminale | `sessionId`, `sessionKind`, `sessionStatus`, `cwd` |

Una voce: `{ command, when?, group? }`. Le voci si ordinano per `group`, poi per plugin e titolo.

### Condizioni `when`

Valutate senza `eval` (`evalWhen` in `shared/pluginExt.ts`). Una condizione illeggibile vale falso e il manifest che la contiene non si installa.

| Forma | Significato |
| --- | --- |
| `isDir` | la chiave è vera / non vuota |
| `!isDir`, `a && b`, `a \|\| b`, `( … )` | combinazioni |
| `resourceExt == .java`, `resourceName != pom.xml` | uguaglianza (senza distinguere maiuscole) |
| `languageId in [java, kotlin]` | appartenenza a un elenco |

## Barra di stato (`contributes.statusBar`)

Barra sottile in basso: compare solo se c'è almeno un elemento con del testo.

```json
"statusBar": [{ "id": "containers", "align": "right", "command": "open", "tooltip": "Container in esecuzione" }]
```

L'adapter ne aggiorna il contenuto:

```js
app.ui.statusItem('containers', { text: 'Docker: 3 attivi', tooltip: '3 su 7', tone: 'ok', visible: true })
```

`tone`: `neutral` `ok` `warn` `error` `busy`. Testo max 60 caratteri, suggerimento max 300; l'app mostra sempre il nome del plugin. Solo gli id dichiarati nel manifest sono ammessi.

## Eventi dell'app (`contributes.events`)

```json
"events": ["session.created", "session.exited"]
```

L'adapter in esecuzione li riceve in `handlers.appEvent({ event, data })`.

| Evento | Quando | `data` |
| --- | --- | --- |
| `session.created` | si apre una sessione (terminale, shell, attività) | `{ id, kind, title, cwd, status, exitCode? }` |
| `session.status` | una sessione cambia stato | idem |
| `session.exited` | una sessione termina | idem |

Sono solo metadati: l'output dei terminali non viaggia mai verso i plugin.

## Mappa delle macroaree

| Macroarea | Stato |
| --- | --- |
| Palette comandi | `commands` (v1) |
| Barra laterale | `sidebarViews` (pagina, v1) |
| Esplora file | `explorerViews` (v1), **`menus['explorer/context']`** |
| Editor | `editorGutter` (v1), **`menus['editor/context']`** |
| Terminali e sessioni | **`menus['terminal/toolbar']`**, **`events` di sessione** |
| Barra di stato | **`statusBar`** |
| Da fare | decorazioni dei file (badge/colori), viste ad albero native nella barra laterale, azioni e controlli sulla revisione delle modifiche, hook di Claude Code, comandi `/` nella casella di input, profili di avvio dei terminali, schema delle impostazioni disegnato dall'app, `workspace.changed` |

## Aggiungere un punto di estensione

1. Tipo e (se serve) chiavi di contesto in `shared/pluginExt.ts`; per un menu nuovo, una riga in `PLUGIN_MENUS`.
2. Disegnarlo nell'area dell'app con `menuItems(plugins, 'nome/menu', contesto)` e `runMenuItem` (`plugins/extensions.ts`), con i componenti dell'app.
3. Validazione nel manifest (`validate` in `PluginManager.ts`) e, se l'adapter deve inviare dati, notifica in `registerHostRequests` più metodo in `magnolia-plugin-sdk`.
4. Aggiornare questo documento.
