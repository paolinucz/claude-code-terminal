# Magnolia

App desktop per Windows (Electron + React + Dockview) che riunisce i terminali di Claude Code, le shell, i file, l'editor e la revisione delle modifiche. Autore: Paolo Coletta. Prima si chiamava «Claude Code Terminal», da cui le sigle `cct` nel codice: `cct.java`, `.cctproj`, `--cct-*`, `cct-plugin-sdk`; restano così.

Documenti di riferimento (da leggere prima di cambiamenti grossi):
- [requisiti-claude-code-terminal.md](requisiti-claude-code-terminal.md): requisiti con ID (L1, S3, F4, X2…) e decisioni prese (§9).
- [stack-tecnico.md](stack-tecnico.md): architettura, fasi di sviluppo (§5), rischi e decisioni aperte (§7).
- [docs/plugin-api.md](docs/plugin-api.md): CCT Plugin API v1 per i plugin di linguaggio.
- [docs/PLUGIN_API_DOCS.md](docs/PLUGIN_API_DOCS.md): **riferimento unico** per chi scrive un plugin (manifest, contributi, messaggi delle pagine, servizi `app.*`, permessi). Va aggiornato a ogni servizio nuovo (§8 del documento).
- [docs/plugin-estensioni.md](docs/plugin-estensioni.md): **punti di estensione dell'interfaccia (Plugin API v2)**: menu, barra di stato, eventi. Principio: i plugin non sono finestre ma arricchiscono l'app; l'app disegna, il plugin dichiara e fornisce dati. Un'area nuova si aggiunge lì (sezione «Aggiungere un punto di estensione»).
- [docs/plugin-contributi.md](docs/plugin-contributi.md): contributi dei plugin all'interfaccia (viste, pagine in iframe isolato) e piano per portare Java fuori dal core. **Regola: niente di specifico di un linguaggio nel core dell'app, va nel plugin.**
- [piano-release-2.md](piano-release-2.md): progetti, contesti, casella di input e output smart (J, B, O), decisioni e cosa è stato provato.
- [README.md](README.md): stato per fase, comandi, installer e aggiornamenti.

## Stato

- Fasi 1–6a e fase 8 completate: questa è la base della **1.0** (installata e funzionante).
- **Release 2 (fasi 9–14)** implementata e provata su Electron isolato: progetti `.cctproj`, contesti, documentazione, casella di input, output smart. Piano e decisioni in [piano-release-2.md](piano-release-2.md). Da fare: prova a mano dell'interfaccia, release (tutto confluisce nella 1.0.0).
- **Fase 7 (widget) rimandata** a dopo la 1.0: l'analisi di widget e plugin va rivista con l'utente prima di scrivere codice. Il pannello `widgets` esiste ancora in `panels/kinds.ts` ma è `hidden: true`.
- Versione dell’app: **1.0.1** (package.json; la 1.0.1 aggiunge il browser integrato e il plugin Debug frontend). Da fare prima della prima release: account e repository GitHub in `build.publish` di `package.json` (per gli aggiornamenti). L'icona dell'app c'è (`build/icon.ico` per exe e installer, `build/icon.png` per le finestre, `src/renderer/src/assets/icon-small.svg` nella barra in alto; originali in `app-icon/` (`magnolia.ico`, `png/`, SVG): la versione dettagliata da 48 px in su, la semplificata sotto).
- Dopo la 0.2.0 (non ancora rilasciato): revisione obbligatoria e modalità revisione (F9–F11), menu del tasto destro e testo selezionabile (F12), ricerca e scorciatoie come VS Code (F13), barra laterale con Esplora file e icone di file (F14), **Java development pack** (F15), icona nuova. **Java è uscito dal core** (F16): interfaccia e motore sono nel plugin, l'app offre la Plugin API ([docs/PLUGIN_API_DOCS.md](docs/PLUGIN_API_DOCS.md)). Da fare: la prova a mano di tutto questo, in particolare il debug vero con i nuovi pacchetti.
- Si lavora ora per aggiornamenti successivi: correzioni e miglioramenti trovati usando l'app.

## Regole di lavoro

- **Tutto in italiano**: testi dell'interfaccia, commenti nel codice, documenti, messaggi di commit.
- **Commit solo quando l'utente lo chiede**, su `main`, con un messaggio sensato in italiano (titolo + elenco di cosa cambia e perché). Niente push se non richiesto.
- Aggiorna README, stack tecnico e requisiti quando una modifica cambia il comportamento o una decisione.
- Le scelte che toccano l'utente (formati, servizi esterni, pubblicazioni) si chiedono prima.
- Non avviare troppi processi insieme: una prova Electron alla volta, e chiudila alla fine. Se l'utente dice che proverà lui un binario, non lanciarlo.

## Ambiente (Windows)

- **Cartella dati**: resta `%APPDATA%\Claude Code Terminal` anche dopo il cambio di nome (fissata con `app.setPath('userData', …)` in `main/index.ts`); `appId` e `name` del pacchetto non cambiano, per non rompere installazione e aggiornamenti. Non rimetterla in automatico su `Magnolia` senza una migrazione.

- In PowerShell usa `npm.cmd` / `npx.cmd`. Se `npm` non si trova, ricarica il PATH:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- Anche Git Bash è disponibile.
- **Non ci sono gli strumenti di compilazione di Visual Studio**: niente moduli nativi da compilare. Prima di aggiungere una dipendenza nativa verifica che abbia binari precompilati. node-pty usa i suoi prebuild; per questo `build.npmRebuild` è `false`.
- Percorsi lunghi (scratchpad): per cancellare usa `fs.rmSync(…, { recursive: true, force: true })` di Node, non `Remove-Item`.
- Claude Code è in `%USERPROFILE%\.local\bin`.
- L'utente tiene spesso aperta la propria copia dell'app: le prove non devono toccarla.

## Comandi

| Comando | Cosa fa |
| --- | --- |
| `npm.cmd run typecheck` | Controllo dei tipi (node + web). Va fatto dopo ogni modifica. |
| `npm.cmd run build` | Compila in `out/`. |
| `npm.cmd run dev` / `npm.cmd start` | App in sviluppo / app compilata. |
| `npm.cmd run web` | Solo interfaccia nel browser (porta 5199), API finta su localStorage in `src/renderer/src/lib/api.ts`. |
| `npm.cmd run dist` | Installer NSIS in `dist/` (senza pubblicare). |
| `npm.cmd run release` | Installer pubblicato come bozza su GitHub Releases (serve `GH_TOKEN`). |
| `npm.cmd run build` in `..\magnolia-plugin-<nome>` | Pacchetto `.ccplugin` del plugin, in `dist/` del suo repository (vedi «Repository dei plugin»). |

## Struttura

```
src/
  main/          processo principale
    index.ts       finestre, protocollo app://, IPC (ipcMain.handle 'area:azione')
    db.ts          SQLite con node:sqlite (impostazioni, spazi (tabella `sheets`), layout, modifiche, plugin)
    sessions/      SessionManager (node-pty), HookServer (hook HTTP e status line di Claude Code), shell
    changes/       ChangeTracker: modifiche di Claude, snapshot, approva/rifiuta/revisione (F4–F8)
    permissions/   file settings di Claude Code nei tre ambiti (P1–P6)
    files/         FileService: albero, lettura/scrittura, git status, indice per la palette
    plugins/       PluginManager (installazione, hash) e PluginHost (adapter JSON-RPC)
    browser/       BrowserService: viste web (WebContentsView) per i plugin con permesso `browser`, pilotate via CDP (`webContents.debugger`)
    projects/      ProjectService: file .cctproj (leggi, crea, salva, recenti)
    changes/ExplainService.ts  output smart: claude -p con Haiku, cache nel database, pagina servita da app://explain
    sessions/TranscriptService.ts  vista grafica: legge la trascrizione JSONL di Claude Code (parser in shared/transcript.ts)
    updater.ts     aggiornamenti automatici (electron-updater)
    contextMenuTemplate.ts  menu nativo di base (campi di testo, testo selezionato)
  preload/       window.api (tipizzata da AppApi)
  shared/        tipi condivisi tra main, preload e interfaccia (plugins.ts: manifest, contributi, permessi; search.ts: anche logica pura, si prova da sola)
  renderer/src/  interfaccia React
    workspace/     barra in alto (menu Progetto, Contesti, chip degli spazi `SpaceChips.tsx`), palette comandi, spazi (`SpaceView`, panoramica `SpaceOverview.tsx`), Dockview, layout; SideBar.tsx (sidebar a tessere in stile macOS con il blocco «icona + pannello» fuso (framer-motion `layoutId`) + pannello) e sidebarViews.tsx (registro delle viste)
    docs/          pannello Documentazione (Markdown sanificato)
    panels/        tipi di pannello (kinds.ts), PanelHost, PanelErrorBoundary
    browser/       BrowserPanel: barra e posizione della vista web (segnaposto che la vista nativa ricopre)
    terminal/ files/ changes/ permissions/ plugins/   contenuto dei pannelli (terminal/HivePanel.tsx: vista «alveare», più terminali in un mosaico; la apre un plugin con `terminal.hive`)
    state/         store Zustand (project, docs, prompt, explain, workspace…)
    components/    ui-kit.tsx (Animate UI con il tema): importare da qui
(i plugin non stanno più qui: ognuno ha il suo repository accanto a questo, vedi «Repository dei plugin»)
```

Per aggiungere una funzione che passa dal processo principale servono quattro punti: handler in `src/main/index.ts`, tipo in `AppApi` (`src/shared/types.ts`), ponte in `src/preload/index.ts`, versione finta in `src/renderer/src/lib/api.ts`.

## Insidie note

- **Selettori Zustand con React 19**: un selettore deve restituire un riferimento stabile. `useStore((s) => Object.values(s.x).filter(…))` crea un array nuovo a ogni lettura e manda React in ciclo (errore #185) che smonta tutta l'interfaccia: finestra nera. Seleziona l'oggetto grezzo e filtra con `useMemo`.
- Ogni pannello è avvolto in `PanelErrorBoundary`: un errore resta nel pannello.
- In Dockview `addPanel` senza `position` mette il pannello come scheda del gruppo attivo. Per gli editor c'è la logica in `openFile` (`state/editor.ts`): primo file in un gruppo a destra dell'Esplora file.
- Ctrl+K dentro un terminale resta al terminale (cancella la riga in bash e Claude Code).
- I file UTF-16 (es. `ntuser.ini`) vengono visti come binari dall'editor: è voluto.
- Le sessioni aperte dall'app passano a Claude Code hook e status line con `--settings` su un file temporaneo: i settings dell'utente non si toccano mai.
- Plugin: l'adapter gira con l'eseguibile dell'app e `ELECTRON_RUN_AS_NODE=1`; righe e colonne nella Plugin API partono da 1, percorsi in formato Windows.

- **Spazi e contesti** (gli «spazi» sono gli ex «fogli»): `spaces` contiene gli spazi di tutti i contesti e restano tutti montati. Per mostrare gli spazi di un contesto usa `spacesOf(spaces, contextId)` (come `SpaceChips`), non `spaces` direttamente. Id degli spazi di un contesto: `sviluppo:1a2b3c4d`, il layout iniziale dipende dalla parte prima dei due punti. **Nel database la tabella resta `sheets`** (e la chiave `activeSheetId`); `main/db.ts` fa da traduttore. Ogni spazio ha `icon` e `color` (palette fissa di 6 colori in `shared/spaces.ts`, ottanio escluso).
- Nel DOM ci sono i pannelli di **tutti** gli spazi (quelli nascosti hanno `display: none`): nelle prove filtra gli elementi visibili (`getClientRects().length > 0`).
- **Menu del tasto destro**: Electron di suo non ne ha. Il menu di base (campi di testo, testo selezionato) è in `main/contextMenuTemplate.ts`, collegato in `index.ts` a ogni finestra. I pannelli con menu proprio lo bloccano: Monaco (nell'editor e nel diff), Radix `ContextMenu` (Esplora file, spazi) e `useContextPopup` (`components/ContextPopup.tsx`: terminale, Markdown). Per un menu nuovo usa `useContextPopup`. I menu di Monaco stanno in uno shadow DOM (`.shadow-root-host`) e sono in inglese.
- **Testo selezionabile**: il `body` ha `user-select: none`; solo `.cct-md`, `.cct-chat`, `pre`, `code` e `.cct-selectable` sono selezionabili (`styles.css`). Un contenuto da leggere o copiare va in uno di questi, altrimenti il tasto destro non ha niente su cui agire.
- **Barra laterale e Esplora file**: l'Esplora file non è più un pannello Dockview (`explorer` è `hidden` in `kinds.ts` e si toglie dai layout salvati) ma la vista `ExplorerView` della barra laterale (`state/sidebar.ts`). Per aggiungere una vista (o un widget) usa `registerSidebarView`. Le icone dei file stanno in `lib/fileIcons.tsx` (`FileIcon`, pacchetto caricato a parte alla prima icona).
- **Ricerca e scorciatoie** (F13): la ricerca nei file è `FileService.search` (usa l'indice della palette, quindi rispetta `.gitignore`) con il confronto in `shared/search.ts` (si prova da solo con `node --experimental-strip-types`). Le scorciatoie globali sono in `TopBar.tsx` (Ctrl+K/P/E, modalità della palette) e `SideBar.tsx` (Ctrl+Maiusc+E/F, Ctrl+F sul Markdown); nei terminali (`.xterm`) restano alla shell. Il Markdown che supporta Ctrl+F si segna con `findable` su `MarkdownView`. La radice dei file è `rootForSheet` (`state/sidebar.ts`), la stessa per Esplora file, Cerca e palette.
- **Avvio e schermata iniziale**: `index.html` ha una schermata statica (`#boot`: icona, nome, barra) che compare subito, prima del bundle (a freddo l'interfaccia React arriva dopo alcuni secondi); `components/Splash.tsx` la sostituisce senza scatti e mostra l'avanzamento vero. Ogni caricamento che serve per partire si registra con `trackBoot(id, etichetta, promessa)` (`state/boot.ts`) in `App.tsx`; quello che altrimenti si caricherebbe alla prima apertura (Monaco, confronto, icone dei file, caratteri, rilevamento di shell e Claude Code, adapter dei plugin con interfaccia) si precarica in `lib/preload.ts` così dopo la schermata niente scatta. La schermata resta finché tutto è finito (minimo 700 ms, massimo 25 s) e la dissolvenza usa timer e CSS, non i fotogrammi. L'elenco dei plugin (`plugins:list`) aspetta la verifica delle impronte; `plugins:warm` avvia gli adapter con interfaccia. Un caricamento nuovo da mostrare all'avvio va registrato in `App.tsx` o `preload.ts`.
- **Spazi** (vedi [DESIGN.md](DESIGN.md) §Spazi): chip nella barra in alto (`workspace/SpaceChips.tsx`; non c'è più la barra dei fogli in basso). Il badge di stato (`state/spaceStatus.ts`: giallo = una sessione attende, blu = Claude lavora) si calcola dai pannelli dello spazio (`panelSigs` nello store: cambia solo quando cambia l'elenco delle sessioni, non a ogni ridimensionamento) incrociati con `useSessions`. I messaggi brevi (`setStatus`) sono toast (`state/messages.ts`). Ctrl+1…9, Ctrl+Tab (panoramica), F2 sul chip. «Apri in una nuova finestra»: `window:openSpace` in `main/index.ts` apre `index.html?space=<id>` (`SOLO_SPACE_ID` in `state/workspace.ts`): quella finestra monta solo quello spazio e **non scrive** l'elenco degli spazi, la finestra principale ne mostra un segnaposto (`ExternalSpace`) e al ritorno rilegge il layout dal database. `sendToMain` manda gli eventi a tutte le finestre dell'app (non ai pannelli staccati). Le scorciatoie si elencano in `workspace/ShortcutsDialog.tsx`: va aggiornata se se ne aggiunge una (quelle dei plugin si aggiungono da sole). Ctrl+K apre ancora la palette ma la barra di ricerca in alto non c'è più.
- **Schermo intero** (F11, pulsante nella barra in alto, comando di palette): `window:toggleFullScreen` in `main/index.ts`; F11 si intercetta in `before-input-event`, quindi vale anche con il focus nel terminale. L'interfaccia sa se è in schermo intero da `state/fullscreen.ts` (`window:fullscreen`): in quel caso i controlli nativi di Windows non ci sono e la barra (`TopBar`, `SoloHeader`) non riserva loro i 140 px a destra (`windowControlsWidth`). Vale per la finestra che riceve il comando (ogni finestra di uno spazio ha il suo).
- **Informazioni su Magnolia** (`workspace/AboutDialog.tsx`, aperta da `state/about.ts`: palette e menu Progetto): versione (da `useUpdates.info`, quindi dal pacchetto), autore, licenza e **la dedica**. Autore, licenza e dedica stanno in `shared/about.ts`. **La dedica è voluta così** («Magnolia è chi ogni giorno crede in me e mi spinge a fare di più» + 💙🍄): non riscriverla, non tradurla, non toglierla.
- **Bot e bolle**: ogni sessione di Claude ha un **bot** (nome, colore, icona: `shared/bots.ts`, `state/bots.ts`). `startBots()` (da `App.tsx`) glieli assegna quando la sessione compare (nomi da un elenco breve: Atlas, Luna, Pixel…) e li toglie quando finisce; il bot di una conversazione si ricorda per id di Claude (`ui.bots.resumed`), quindi riprendendo la sessione il nome resta. Il nome sostituisce il titolo nella scheda (`TerminalPanel`), nei toast, nel tooltip degli spazi, nell'intestazione della vista grafica e del cassetto di revisione; **la notifica nativa di Windows usa ancora il titolo** (nasce nel processo principale). Le **bolle** (`workspace/BotBubbles.tsx`) esistono solo nella **modalità Bolle** (Aspetto → Claude: Schede | Bolle, `ui.claudeMode`, comando di palette «Claude: passa a Bolle / Schede»; `isBubbleMode()` in `state/appearance.ts`, cambio con `switchClaudeMode` in `workspace/claudeMode.ts`): sono un blocco fisso sul bordo della finestra, uguale in tutti gli spazi (non nelle finestre di uno spazio solo); si trascina dalla maniglia e si ancora al lato più vicino (`ui.botDock`). Anello: blu che gira = lavora, giallo che pulsa = attende te; numero giallo = file da rivedere. Il clic apre la **mini-chat** (`terminal/BotPopup.tsx`: `ConversationView` + `PromptBox` + striscia «Apri la revisione»): la revisione si fa nella vista ampliata, quindi aprirla dal pop-up amplia la bolla (`reviewUser` in `BotPopup`). **Schede e bolle sono due modalità separate**: in Bolle le sessioni di Claude non creano schede (`openSessionView`, `TerminalPanel.onDone`, `revealSession`), il workspace parte vuoto (`buildDefaultLayout`) e `removeHiddenPanels` toglie le schede di Claude rimaste; il cambio di modalità sposta le sessioni vive da una forma all'altra. Dal pop-up la bolla si **amplia** a tutta l'area dei pannelli (`terminal/BotExpanded.tsx`, overlay sopra `main[aria-label="Pannelli dello spazio"]`, ospita `SessionView` con il cassetto di revisione; «Riduci» torna al pop-up). Gli spazi si montano solo dopo la lettura delle impostazioni (`useAppearance.ready`).
- **Programmi lanciati (sessioni `task`)**: il terminale ha il pulsante «Ferma» nella barra di stato (`TerminalPanel.tsx`), valido anche per il debug.
- **Effetti che restituiscono valori**: la funzione di `useEffect` deve restituire `undefined` o una funzione di pulizia. In questo Chromium `element.scrollTo()` restituisce una **Promise**: `useEffect(() => el.scrollTo(…), [])` fa lanciare a React «destroy is not a function» allo smontaggio e tutta l'interfaccia diventa nera. Usa sempre le parentesi graffe (`useEffect(() => { el.scrollTo(…) }, [])`).
- **Componenti dentro componenti**: non definire un componente dentro il corpo di un altro (`function Entry` nell'Esplora file): a ogni disegno diventa un tipo nuovo e React lo ricrea, chiudendo menu e perdendo lo stato. Usa una funzione che restituisce JSX con `key`.
- **TerminalView dentro un contenitore flex in colonna**: la sua radice è `flex-1 min-h-0`; se il genitore non è `flex flex-col` il terminale ha altezza zero e resta vuoto (l'alveare l'ha mostrato).
- **Output smart**: non servire HTML generato con `srcdoc` (eredita la CSP dell'app e blocca gli script). Si serve da `app://explain/<token>` con la sua CSP; l'iframe non deve mai avere `allow-same-origin`.
- Il `.cctproj` non deve contenere percorsi assoluti né dati personali (J10); il progetto attivo e il contesto attivo stanno nelle impostazioni dell'app.
- Claude Code in una cartella nuova mostra «Quick safety check»: l'opzione preselezionata è «No, exit». Nelle prove con sessioni vere scendi su «Yes, I trust this folder» prima di confermare.

## Repository dei plugin

Ogni plugin ha un **repository proprio**, accanto a questo (`..\magnolia-plugin-<nome>`: `angular`, `docker`, `frontend-debug`, `gradle`, `java`, `maven`, `python`, `typescript`, `yaml`). L'SDK (`cct-plugin-sdk.mjs` e tipi) e gli strumenti di build condivisi stanno in `..\magnolia-plugin-sdk`, da cui ogni plugin dipende (`"magnolia-plugin-sdk": "file:../magnolia-plugin-sdk"`). Un plugin ha `build.mjs` (manifest, download con checksum, `runBuild`), `adapter.mjs` o `src/*.mts` + `tsconfig.json`, `ui/`. Il core non importa nulla dai plugin: li conosce solo come pacchetti `.ccplugin` installati. Se cambia l'SDK o la Plugin API si aggiorna anche [docs/PLUGIN_API_DOCS.md](docs/PLUGIN_API_DOCS.md) (§8). Prima di pubblicare i repository su GitHub, la dipendenza `file:` dell'SDK va sostituita con l'indirizzo git.

## Plugin Java (F15, F16): un solo plugin, non c'è nulla di Java nel core

Tutto ciò che riguarda Java sta nel repository `magnolia-plugin-java` e l'app non lo conosce: servizi Maven/Gradle, JDK, run configuration, debug (DAP), importazione IntelliJ, vista «Esegui e debug», breakpoint nel margine dell'editor. L'app offre solo i servizi generici della Plugin API ([docs/PLUGIN_API_DOCS.md](docs/PLUGIN_API_DOCS.md)). Se manca un servizio, si aggiunge lì in forma generica (§8 del documento), mai con codice Java nel core.

Un solo pacchetto, `cct.java` **2.0.0** (si costruisce con `npm.cmd run build` in `magnolia-plugin-java`, **da PowerShell**: in Git Bash `tar` è quello GNU e non apre gli zip né i percorsi `C:\`; scrive `dist/cct.java-2.0.0.ccplugin` nel repository del plugin). Unifica il vecchio `cct.java` (jdtls) e il vecchio `cct.java-dev` (motore di esecuzione): il manifest ha `replaces: ["cct.java-dev"]`, quindi installandolo il vecchio plugin si disinstalla da solo (le impostazioni `java.*` restano). Contiene:
- **un adapter solo** (`magnolia-plugin-java/src/adapter.mts`, TypeScript compilato con `tsc` dal build, vedi `pack` in `magnolia-plugin-sdk/build/lib.mjs`): `lspAdapter` dell'SDK per jdtls con l'opzione `extend`, che aggancia lo stesso processo al motore di esecuzione (`JavaDevService`); il motore parla con jdtls tramite il ponte `lsp.call`, non più da un plugin all'altro;
- le pagine in `magnolia-plugin-java/ui/`: `packages.html` (vista «Package» dell'Esplora file), `run.html` («Esegui e debug»), `combo.html` (modale delle combo), `run.svg`;
- i download verificati: **JDK Temurin 25** completo, jdtls, java-debug e Lombok (niente più JRE: il JDK fornisce anche il runtime «java» a Maven e Gradle);
- nel manifest: `explorerViews`, `sidebarViews` (Esegui e debug, Ctrl+Maiusc+D), `editorGutter` (java), `commands`, `permissions: ["terminal"]`, `storage.settingsPrefixes: ["java."]` (i dati già salvati restano).

I JDK dell'utente li scrive il motore in `plugin-data/cct.java/jdks.json` e jdtls li legge all'avvio (`java.configuration.runtimes`).

Cose da sapere:
- **Impostazioni per servizio** (`java.serviceSettings`, chiave = id del servizio): JDK (`java.serviceJdk`), versione di **Maven** e di **Gradle** (`maven`, `gradle`: assente = wrapper del progetto, poi `mvn`/`gradle` nel PATH) e **variabili d'ambiente** (`env`, sotto quelle della run configuration). Le versioni scelte sono scaricate dall'app in `<dati>/build-tools/<maven|gradle>/<versione>` (`tools.mts`: elenco da services.gradle.org e Maven Central, download con checksum pubblicato, mai senza). `launchContext` in `JavaDevService.mts` le risolve; se la versione scelta non è scaricata l'avvio dà un errore con il rimedio. `compatIssue` avvisa (non blocca) quando Maven/Gradle e JDK non vanno d'accordo (Gradle: tabella «Java compatibility» in `tools.mts`; Gradle 9 vuole Java 17+). jdtls importa comunque i progetti Gradle con il wrapper.
- **Combo** (`java.combos`, `JavaDevService.runCombo`): più run configuration avviate una dopo l'altra, nell'ordine scelto, con una **pausa in secondi** dopo ciascuna (0–600, prima del successivo). Si compongono nella modale `ui/combo.html`, pagina del plugin aperta con `ui.openPage` (due colonne, trascinamento HTML5 e frecce, preset da salvare/caricare/eliminare). L'avvio risponde subito e prosegue in background; l'avanzamento arriva con l'evento `combo` e resta in `state.comboRun` finché non si chiude. I terminali non si aprono uno per uno: `app.terminal.hive` li raccoglie in un solo alveare (stessa chiave per preset, quindi un riavvio aggiorna lo stesso pannello). Un passo che non parte non ferma gli altri; «Ferma tutto» chiude anche i servizi già partiti. Sono escluse le configurazioni `attach`; il debug resta uno solo per volta.
- **jdtls ha bisogno di un JDK, non di un JRE**: il debug usa `jdk.jdi`, che il JRE non ha («`com.sun.jdi.VMDisconnectedException cannot be found`»). Per questo il plugin porta il JDK 25. Il JDK dei *progetti* (Temurin 17/21… o quelli del PC) è un'altra cosa: li gestisce `magnolia-plugin-java/src/jdks.mts`.
- **Come parlano le parti**: la pagina chiama l'adapter con `plugin.call`; l'adapter (stesso processo) parla con jdtls con `lsp.call('lsp/executeCommand' | 'lsp/state', …)` (comandi `vscode.java.*`, `java.project.getAll`) e manda alla pagina eventi (`debug`, `output`, `progress`, `state`, `breakpoints`) con `app.emit`.
- **Flusso del debug** (`JavaDevService.debug`): aspetta che jdtls abbia importato il progetto → `vscode.java.startDebugSession` (porta del server DAP) → avvia il programma in una sessione `task` con JDWP → aspetta la porta di debug → collega il client DAP (`dap.mts`), manda i breakpoint, `configurationDone`. java-debug **non manda `continued`**: dopo continua/passo lo stato passa a «running» prima della richiesta.
- **Comandi di avvio** (`runConfig.mts`): Quarkus `-Ddebug=<porta> -Dsuspend=false`; Spring Boot `-Dspring-boot.run.jvmArguments`; test `-Dmaven.surefire.debug`; Gradle `--debug-jvm` (porta fissa 5005) e Quarkus `quarkusDev -Ddebug`. `-D` e `-P` degli argomenti vanno a Maven/Gradle, il resto a `-Dquarkus.args`. Wrapper (`mvnw.cmd`, `gradlew.bat`) cercato dalla cartella verso l'alto, poi `mvn`/`gradle` dal PATH. `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT` (antivirus o proxy che ispezionano HTTPS).
- **Sessioni `task`**: un comando qualsiasi in un PTY (`SessionManager.create` con `kind: 'task'`). L'adapter, dopo `app.session.create`, chiama `app.terminal.show(id)` (permesso `terminal`): l'app apre un pannello terminale sotto il pannello attivo (`showSessionTerminal` in `plugins/pluginBridge.ts`). I pannelli `task` si tolgono dai layout salvati all'avvio (`removeHiddenPanels`).
- **Importazione IntelliJ** (`ideaImport.mts`): Application, Maven, Gradle, Remote; JUnit e altri tipi sono segnalati come non supportati. I moduli IntelliJ non si importano (si usa la cartella di lavoro).
- **Breakpoint**: salvati nelle impostazioni (`java.breakpoints`) dall'adapter, che manda i segni al margine con `app.editor.markers` (stili `.cct-bp`, `.cct-debug-line`, disegnati da `EditorView.tsx`); il clic nel margine arriva all'adapter come `gutter.click`.
- **Prove**: l'adapter compilato si prova fuori dall'app parlandogli in JSON-RPC (si fa da «app» e si rispondono le richieste `host/*`); la pagina e i servizi dell'app su Electron isolato con un plugin di prova; il debug vero con jdtls, Maven, Gradle e Quarkus reali, su una copia isolata di Electron con i pacchetti installati. Progetto di prova: `C:\Users\ALPHA\Desktop\java-demo` (fuori dal repository), con `README.md` che elenca la prova completa.

## Plugin Debug frontend (`cct.frontend-debug`): debugger per applicazioni web, generico

Debug di qualunque app web (React, Angular, Vue, Svelte… tutto ciò che serve JavaScript con le source map) nel **browser integrato** dell'app. Nel core non c'è nulla di specifico di un framework: c'è solo il servizio generico `app.browser` (permesso `browser`, [docs/PLUGIN_API_DOCS.md](docs/PLUGIN_API_DOCS.md) §3.4) e il pannello `browser` (`hidden`: la vista non sopravvive al riavvio). Si costruisce con `npm.cmd run build` in `magnolia-plugin-frontend-debug` (da PowerShell), sorgenti in `magnolia-plugin-frontend-debug/`.

- **Flusso** (`DebugService.start`): se un comando è indicato e l'indirizzo non risponde già, lo avvia in una sessione `task` (shell: `cmd /c` o `sh -c`) e aspetta il server → apre la vista su `about:blank` → accende il debugger CDP (`Runtime`, `Debugger`, blackbox di `node_modules`, **breakpoint di strumentazione `beforeScriptExecution`**) → naviga all'indirizzo. La pausa di strumentazione dà il tempo di leggere la source map e mettere i breakpoint prima che lo script parta, e poi riprende da sola.
- **Source map** (`sourcemap.mts`, senza dipendenze, si prova con `node --experimental-strip-types`): le sorgenti relative si risolvono rispetto alla mappa o allo script (Vite pubblica `main.tsx`, non un percorso); poi `resolveSource` le collega a file del progetto (schemi `webpack://`, `file://`, `/@fs/`, suffissi del percorso). Un breakpoint su una riga senza codice va alla prima riga seguente che ne ha (entro 20). Script senza mappa: l'indirizzo si collega al file con `urlToFile`.
- **Insidie**: React in StrictMode renderizza due volte, quindi un breakpoint nel componente scatta due volte (è giusto). Una riga può contenere sia la creazione di una funzione sia il suo corpo: il breakpoint va sul primo punto generato.
- **Interfaccia**: vista nella barra laterale (`ui/debug.html`), margine dell'editor (`editorGutter`: linguaggi `typescript`, `typescriptreact`, `javascript`, `javascriptreact`, `html`, `vue`, `svelte`); comando e indirizzo si ricordano per progetto in `plugin.cct.frontend-debug.configs`, i breakpoint in `…breakpoints`.
- **Prova**: Electron isolato + progetto Vite/React nello scratchpad; script che installa il pacchetto via `window.api.plugins` e guida il plugin con `plugins.call` (`start`, `status`, `control`, `scopes`, `properties`, `evaluate`, `stop`). **Non fermare i processi `electron` in blocco**: c'è anche la copia dell'utente; chiudi solo quello della prova (porta di debug della prova).
- **Da fare** (fuori dall'MVP): console del browser completa, rete, ispezione del DOM, watch e breakpoint condizionali, eccezioni, più bersagli (iframe, worker), Angular CLI e webpack provati con progetti veri.

## Revisione delle modifiche: il cassetto accanto al terminale

Il diff non sta più in un pannello a parte: ogni sessione di Claude ha il suo **cassetto di revisione** a destra del terminale (`changes/ReviewDrawer.tsx`, `ReviewDock` montato da `TerminalPanel`). Il pannello `Modifiche` (`ChangesPanel`) resta come **panoramica** di tutte le sessioni (elenco, «Approva/Respingi tutte», «Apri nella sessione» o doppio clic per portare un file nel cassetto della sua sessione; se la sessione non ha più un pannello il diff si decide anche lì).

- **Una sola logica**: `changes/useReview.ts` (selezione, contenuti, Approva/Rifiuta/Richiedi modifiche, «tutte», conferma «force» per i file cambiati dopo Claude, blocco finché la sessione lavora). La usano panoramica e cassetto. `ReviewDiff.tsx` è la colonna del diff (intestazione con azioni, confronto/storico, Monaco / Markdown impaginato / Spiegazione, `RevisionComposer`); `RejectDialogs.tsx` le conferme.
- **Stato UI per sessione** in `state/review.ts` (`useReviewUi`): aperto/chiuso, file in primo piano (`openReview(sessionId, changeId)`), larghezza (`ui.reviewWidth`), modalità del diff (`ui.diffMode`: auto / in linea / affiancato), apertura automatica (`ui.reviewAutoOpen`). `startReviewAutoOpen()` (da `App.tsx`) apre il cassetto alla prima modifica `pending` nuova di una sessione, se l'utente non l'ha chiuso a mano; un cassetto aperto da solo si richiude quando non resta nulla da rivedere. Le modifiche già presenti all'avvio non aprono nulla.
- **Legato alla sessione, non al pannello**: i dati vengono da `useChanges` filtrato per `sessionId`, quindi il cassetto segue la sessione tra spazi e finestre.
- **Pannello stretto** (< 720 px): il cassetto si sovrappone al terminale come un foglio quasi opaco (`.mg-glass-sheet`) invece di dividerlo. Il diff in modalità *auto* passa da solo da affiancato a in linea sotto i 640 px (`renderSideBySideInlineBreakpoint` di Monaco).
- **Punti di aggancio nel terminale**: pulsante «Revisione (N)» nella barra di stato (`StatusBar`), riga «Apri la revisione» nel blocco di `PromptBox` (revisione obbligatoria), badge e «Rivedi» nelle card `Edit` della vista grafica (`EditCard`, per `sessionId + filePath`), comando di palette «Revisione: apri o chiudi…» (`activeClaudeSessionId` in `changes/reveal.ts`).
- **Prova end-to-end senza Claude che scrive**: avvia una sessione Claude vera dalla UI e simula l'`Edit` dal percorso reale degli hook: URL e token stanno nel file `--settings` della sessione (`%TEMP%\claude-code-terminal\settings-<pid>\<id>.json`); POST di `PreToolUse` (scrivi prima il file «prima»), poi scrivi il file «dopo», `PostToolUse` e `Stop` (la sessione torna `idle` e la revisione si sblocca). Il file deve stare nella cartella della sessione.

## Vista grafica della conversazione

`terminal/ConversationView.tsx` (con i pezzi in `terminal/chat/`) impagina la trascrizione JSONL che Claude Code scrive in locale (`shared/transcript.ts` la interpreta, `TranscriptService` la segue). Sta **sopra** il terminale, che resta in esecuzione ma **nascosto** (`[data-graphic='on'] .xterm { visibility: hidden }`: se resta visibile, col vetro il suo testo traspare).

- **Parser** (`parseTranscriptLine`): oltre a testo e strumenti ora tiene il ragionamento (`thinking`), le immagini incollate (`images`, base64 sotto 1,5 MB), le interruzioni, la compattazione (`isCompactSummary`), gli errori dell'API (`isApiErrorMessage`) e i comandi con la barra (`<command-name>`) come elementi `system`; `tool` porta `args` (parametri testuali), `todos` (TodoWrite) e `plan` (ExitPlanMode); `msgId`/`usage` servono ai token per turno. Le righe dei subagent (`isSidechain`) restano escluse: dell'agente si vede la scheda `Task` con il suo risultato.
- **Schede per tipo** (`chat/ToolViews.tsx`, `ToolDetail`): Bash (comando evidenziato + output con i colori ANSI, `chat/ansi.ts`), Read (numeri di riga e sintassi, file apribile), Grep/Glob (`file:riga` cliccabili), WebFetch/WebSearch e agenti (risultato in Markdown). `TodoCard` mostra la checklist dell'ultimo TodoWrite (i precedenti sono una riga), `PlanCard` il piano con i tasti 1 / Esc.
- **Sintassi** (`chat/highlight.ts`): `monaco.editor.colorize` sui blocchi `pre > code.language-x` (`useCodeHighlight`). **Il tema di Monaco è globale**: senza un editor aperto è quello chiaro, per questo `colorize` fa `setTheme('cct-dark')`. Il codice dei blocchi va reso con `dangerouslySetInnerHTML` (non come figli React: la colorazione sostituisce i nodi).
- **Permessi** (`PermissionBar`): mostra cosa chiede lo strumento senza esito (il comando di Bash, il file e +/− di un Edit) e le scelte con i tasti del terminale: «Sì (1)», «Sì, e non chiedere più (2)» (se il prompt ha solo due scelte il 2 vale «No»: cade dal lato sicuro), «No (Esc)». Con la vista grafica attiva `PromptBox` non ripete l'avviso «Claude aspetta…».
- **Navigazione**: intestazione (modello, effort, contesto, costo se > 0, avanzamento delle cose da fare), indice dei messaggi dell'utente, Ctrl+F con `FindBar` (`docs/FindBar.tsx`) quando ci si è cliccato dentro, riepilogo a fine turno (durata, token in uscita, strumenti) dopo l'ultimo elemento non `system` del turno.
- **Font**: `html[data-chat-font]` (`ui.chatFont`, in Aspetto): JetBrains Mono come il terminale (predefinito) o Geist; il codice è sempre JetBrains Mono (`--cct-code-font`).
- **Prova senza Claude che scrive**: avvia una sessione Claude dalla UI, manda `SessionStart` con un `session_id` finto all'URL degli hook (vedi «Revisione delle modifiche») e scrivi il JSONL in `~/.claude/projects/<cartella-con-trattini>/<session_id>.jsonl`; poi **cancellalo** (è la cartella dei dati veri di Claude Code).

## Come provare

- Typecheck e build sempre.
- Prove end-to-end su una **copia isolata** di Electron: `node_modules\electron\dist\electron.exe <progetto> --remote-debugging-port=<porta>` con `CCT_USER_DATA=<cartella di prova>` (dati separati da quelli dell'utente) e `ELECTRON_RENDERER_URL` vuota. Si pilota l'interfaccia via Chrome DevTools Protocol (`Runtime.evaluate`, `Input.dispatchKeyEvent`) e si chiude il processo alla fine.
- Script e cartelle di prova vanno nello scratchpad della sessione, non nel repository.
- Aggiornamenti dai sorgenti: `CCT_UPDATE_DEV_CONFIG=<file yml>` con `provider: generic` e un server locale con `latest.yml`; usa un `updaterCacheDirName` di prova e cancellalo dopo.
- Per prove con più cose da guardare: riavvia con `Page.reload` dopo aver scritto impostazioni (`window.api.settings.set`) e `.cctproj` (`window.api.project.save`); la palette si apre con Ctrl+K via `Input.dispatchKeyEvent`. Una modifica da spiegare si semina nel database (tabella `changes` e file in `snapshots/`) prima della seconda partenza.
- App impacchettata: `dist\win-unpacked\Magnolia.exe` (senza installare).
