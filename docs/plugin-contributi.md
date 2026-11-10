# Contributi dei plugin all'interfaccia (CCT Plugin API v1.1)

Obiettivo: l'app non deve conoscere nessun linguaggio. Tutto ciò che è specifico di Java (e di qualsiasi altro linguaggio) sta nel plugin: l'app offre **punti di aggancio** e carica il codice del plugin solo se è installato e attivo. Un'app senza plugin Java non contiene nulla di Java.

## Come funziona

Un plugin dichiara nel `plugin.json` cosa aggiunge (`contributes`) e porta nel pacchetto le sue pagine (HTML/JS/CSS). L'app le mostra in un **iframe isolato** (`sandbox="allow-scripts"`, senza `allow-same-origin`), servite da `app://plugin/<id-plugin>/<percorso>` con una politica CSP che vieta rete e frame. La pagina e l'app parlano solo con messaggi (`postMessage`): l'app espone pochi servizi, scelti, e controlla ogni richiesta.

```json
"contributes": {
  "explorerViews": [{ "id": "packages", "title": "Package", "entry": "ui/packages.html" }],
  "sidebarViews": [{ "id": "run", "title": "Esegui e debug", "entry": "ui/run.html", "icon": "ui/run.svg", "shortcut": "Ctrl+Maiusc+D" }],
  "editorGutter": { "languages": ["java"], "click": "gutter.click" }
}
```

## Punti di aggancio disponibili

| Punto | Cosa fa | Stato |
| --- | --- | --- |
| `explorerViews` | Vista alternativa dell'Esplora file, con un pulsante accanto a «File». | **Fatto** (plugin Java: vista «Package» come IntelliJ). |
| `sidebarViews` | Voce della barra laterale: icona SVG del pacchetto + pagina; scorciatoia opzionale (es. `Ctrl+Maiusc+D`). | **Fatto** (infrastruttura; il pannello Java ci va nel passo 2). |
| `commands` | Comandi nella palette (Ctrl+K). | Da fare. |
| `settings` | Pagina di impostazioni del plugin. | Da fare. |
| servizi dell'adapter | La pagina chiama l'adapter del proprio plugin (`plugin.call`) e riceve eventi (`event`); l'adapter usa impostazioni, terminali e altri plugin dell'app (`host/…`). | **Fatto** (provato con un adapter vero). |
| `editorGutter` | Margine dell'editor per i file di certi linguaggi: l'adapter decide i segni (`app.editor.markers`), il clic nel margine chiama un suo metodo. | **Fatto** (infrastruttura; a Java si collega nel passo 3). |

## Protocollo della pagina

Dalla pagina verso l'app:

- `{cct:'ready'}` — la pagina è pronta; l'app risponde con `init` e `state`.
- `{cct:'rpc', id, method, params}` — metodi: `files.index` (elenco dei file della cartella dell'Esplora file, relativi, con `\`), `editor.open {path}`, `files.reveal {path}`, `clipboard.copy {text}`, `plugin.call {method, params}` (richiesta all'adapter del proprio plugin: arriva a `handlers.call(method, params)`). I percorsi devono stare nella cartella del progetto.

Dall'app verso la pagina:

- `{cct:'init', win, cwd, theme}` — sistema operativo, cartella, variabili CSS del tema (`--cct-*`, compreso l'accento scelto dall'utente). Si rimanda se cambiano.
- `{cct:'state', decor:{git, claude, errors}}` — stato dei file in percorsi normalizzati (`\` e minuscolo solo su Windows): segni git, modifiche di Claude in attesa, errori dei language server. Si rimanda a ogni cambiamento.
- `{cct:'event', event, data}` — evento mandato dall'adapter con `app.emit(event, data)`.
- `{cct:'rpc-result', id, ok, value|error}`.

## Servizi dell'app per gli adapter (`app.*` nell'SDK)

L'adapter gira in un processo Node separato (solo quando serve) e chiede all'app:

- `app.settings.get(key)` / `set(key, value)` — impostazioni dell'app. Valgono solo le chiavi `plugin.<id>.…` e i prefissi dichiarati nel manifest in `storage.settingsPrefixes` (per Java `["java."]`, così i dati già salvati restano).
- `app.session.create(request)` / `kill(id)` / `status(id)` — terminali in attività (per avviare un'applicazione, un build).
- `app.plugin(idPlugin, metodo, parametri)` — richiesta all'adapter di un plugin dichiarato in `requires` (per Java Dev verso il language server di `cct.java`).
- `app.emit(evento, dati)` — evento per le pagine del proprio plugin.
- `app.editor.markers(path, [{line, kind, hint?, reveal?}])` — segni nel margine dell'editor per quel file (`kind`: `breakpoint`, `breakpoint-disabled`, `stopped`); `reveal` apre il file sulla riga. `app.editor.clearMarkers()` li toglie tutti. Il clic nel margine arriva all'adapter come `call(<metodo di editorGutter.click>, {path, line})`.

Esempio completo: `plugins/java/ui/packages.html`.

## Cosa resta di Java nel core (da spostare)

Piano a passi, ognuno rilasciabile da solo:

1. ✔ Vista a package → plugin Java (`explorerViews`).
1b. ✔ Infrastruttura per i passi seguenti: `sidebarViews`, servizi `app.*` per gli adapter, `plugin.call` ed eventi verso le pagine, `editorGutter` (breakpoint e riga fermata). Il vecchio codice Java dell'editor resta attivo finché nessun plugin dichiara `editorGutter` per `java`.
2. Pannello «Esegui e debug» (`JavaView`, `ConfigDialog`, `state/javaDev`, `javaFollow`) → `sidebarViews` + pagina del plugin Java Dev (JS senza React, come la vista a package). Il margine dell'editor è già pronto (`editorGutter`).
3. Logica del processo principale (`src/main/java/*`: servizi Maven/Gradle, JDK, run configuration, DAP, import da IntelliJ) → adapter del Java development pack (`plugins/java-dev/`, sorgenti TypeScript compilati dallo script di build), con `app.settings`/`app.session`/`app.plugin`; via i ~20 handler `java:*` in `main/index.ts`, `preload` e `AppApi`. Da provare su Windows con un JDK vero: breakpoint, passo-passo e download dei JDK non si possono verificare su Linux.
4. Tipi di `shared/java.ts` → dentro il plugin; l'app tiene solo il protocollo generico.
5. Il pacchetto `cct.java-dev` non è più un interruttore (`packActive`): le funzioni esistono solo se il plugin è installato.

Il codice di Java compare nel bundle dell'app finché non sono fatti i passi 2–4: è la ragione per cui l'app oggi pesa più del necessario.

## Sicurezza

- Le pagine girano senza accesso all'app, ai cookie o alla rete; non possono caricare altri frame.
- L'app serve solo file statici (`.html`, `.js`, `.css`, `.svg`, `.png`, `.json`) dentro la cartella di un plugin **attivo** e non modificato.
- Ogni richiesta della pagina è validata (percorsi dentro il progetto, metodi noti).
