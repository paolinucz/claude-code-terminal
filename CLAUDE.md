# Magnolia

App desktop per Windows (Electron + React + Dockview) che riunisce i terminali di Claude Code, le shell, i file, l'editor e la revisione delle modifiche. Autore: Paolo Coletta. Prima si chiamava Â«Claude Code TerminalÂ», da cui le sigle `cct` nel codice: `cct.java`, `.cctproj`, `--cct-*`, `cct-plugin-sdk`; restano cosÃ¬.

Documenti di riferimento (da leggere prima di cambiamenti grossi):
- [requisiti-claude-code-terminal.md](requisiti-claude-code-terminal.md): requisiti con ID (L1, S3, F4, X2â€¦) e decisioni prese (Â§9).
- [stack-tecnico.md](stack-tecnico.md): architettura, fasi di sviluppo (Â§5), rischi e decisioni aperte (Â§7).
- [docs/plugin-api.md](docs/plugin-api.md): CCT Plugin API v1 per i plugin di linguaggio.
- [docs/PLUGIN_API_DOCS.md](docs/PLUGIN_API_DOCS.md): **riferimento unico** per chi scrive un plugin (manifest, contributi, messaggi delle pagine, servizi `app.*`, permessi). Va aggiornato a ogni servizio nuovo (Â§8 del documento).
- [docs/plugin-contributi.md](docs/plugin-contributi.md): contributi dei plugin all'interfaccia (viste, pagine in iframe isolato) e piano per portare Java fuori dal core. **Regola: niente di specifico di un linguaggio nel core dell'app, va nel plugin.**
- [piano-release-2.md](piano-release-2.md): progetti, contesti, casella di input e output smart (J, B, O), decisioni e cosa Ã¨ stato provato.
- [README.md](README.md): stato per fase, comandi, installer e aggiornamenti.

## Stato

- Fasi 1â€“6a e fase 8 completate: questa Ã¨ la base della **1.0** (installata e funzionante).
- **Release 2 (fasi 9â€“14)** implementata e provata su Electron isolato: progetti `.cctproj`, contesti, documentazione, casella di input, output smart. Piano e decisioni in [piano-release-2.md](piano-release-2.md). Da fare: prova a mano dell'interfaccia, release (tutto confluisce nella 1.0.0).
- **Fase 7 (widget) rimandata** a dopo la 1.0: l'analisi di widget e plugin va rivista con l'utente prima di scrivere codice. Il pannello `widgets` esiste ancora in `panels/kinds.ts` ma Ã¨ `hidden: true`.
- Versione dellâ€™app: **1.0.0** (package.json). Da fare prima della prima release: account e repository GitHub in `build.publish` di `package.json` (per gli aggiornamenti). L'icona dell'app c'Ã¨ (`build/icon.ico` per exe e installer, `build/icon.png` per le finestre, `src/renderer/src/assets/icon-small.svg` nella barra in alto; originali in `app-icon/` (`magnolia.ico`, `png/`, SVG): la versione dettagliata da 48 px in su, la semplificata sotto).
- Dopo la 0.2.0 (non ancora rilasciato): revisione obbligatoria e modalitÃ  revisione (F9â€“F11), menu del tasto destro e testo selezionabile (F12), ricerca e scorciatoie come VS Code (F13), barra laterale con Esplora file e icone di file (F14), **Java development pack** (F15), icona nuova. **Java Ã¨ uscito dal core** (F16): interfaccia e motore sono nel plugin, l'app offre la Plugin API ([docs/PLUGIN_API_DOCS.md](docs/PLUGIN_API_DOCS.md)). Da fare: la prova a mano di tutto questo, in particolare il debug vero con i nuovi pacchetti.
- Si lavora ora per aggiornamenti successivi: correzioni e miglioramenti trovati usando l'app.

## Regole di lavoro

- **Tutto in italiano**: testi dell'interfaccia, commenti nel codice, documenti, messaggi di commit.
- **Commit solo quando l'utente lo chiede**, su `main`, con un messaggio sensato in italiano (titolo + elenco di cosa cambia e perchÃ©). Niente push se non richiesto.
- Aggiorna README, stack tecnico e requisiti quando una modifica cambia il comportamento o una decisione.
- Le scelte che toccano l'utente (formati, servizi esterni, pubblicazioni) si chiedono prima.
- Non avviare troppi processi insieme: una prova Electron alla volta, e chiudila alla fine. Se l'utente dice che proverÃ  lui un binario, non lanciarlo.

## Ambiente (Windows)

- **Cartella dati**: resta `%APPDATA%\Claude Code Terminal` anche dopo il cambio di nome (fissata con `app.setPath('userData', â€¦)` in `main/index.ts`); `appId` e `name` del pacchetto non cambiano, per non rompere installazione e aggiornamenti. Non rimetterla in automatico su `Magnolia` senza una migrazione.

- In PowerShell usa `npm.cmd` / `npx.cmd`. Se `npm` non si trova, ricarica il PATH:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- Anche Git Bash Ã¨ disponibile.
- **Non ci sono gli strumenti di compilazione di Visual Studio**: niente moduli nativi da compilare. Prima di aggiungere una dipendenza nativa verifica che abbia binari precompilati. node-pty usa i suoi prebuild; per questo `build.npmRebuild` Ã¨ `false`.
- Percorsi lunghi (scratchpad): per cancellare usa `fs.rmSync(â€¦, { recursive: true, force: true })` di Node, non `Remove-Item`.
- Claude Code Ã¨ in `%USERPROFILE%\.local\bin`.
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
| `node scripts/build-plugins.mjs` | Pacchetti `.ccplugin` in `dist/plugins`. |

## Struttura

```
src/
  main/          processo principale
    index.ts       finestre, protocollo app://, IPC (ipcMain.handle 'area:azione')
    db.ts          SQLite con node:sqlite (impostazioni, fogli, layout, modifiche, plugin)
    sessions/      SessionManager (node-pty), HookServer (hook HTTP e status line di Claude Code), shell
    changes/       ChangeTracker: modifiche di Claude, snapshot, approva/rifiuta/revisione (F4â€“F8)
    permissions/   file settings di Claude Code nei tre ambiti (P1â€“P6)
    files/         FileService: albero, lettura/scrittura, git status, indice per la palette
    plugins/       PluginManager (installazione, hash) e PluginHost (adapter JSON-RPC)
    projects/      ProjectService: file .cctproj (leggi, crea, salva, recenti)
    changes/ExplainService.ts  output smart: claude -p con Haiku, cache nel database, pagina servita da app://explain
    sessions/TranscriptService.ts  vista grafica: legge la trascrizione JSONL di Claude Code (parser in shared/transcript.ts)
    updater.ts     aggiornamenti automatici (electron-updater)
    contextMenuTemplate.ts  menu nativo di base (campi di testo, testo selezionato)
  preload/       window.api (tipizzata da AppApi)
  shared/        tipi condivisi tra main, preload e interfaccia (plugins.ts: manifest, contributi, permessi; search.ts: anche logica pura, si prova da sola)
  renderer/src/  interfaccia React
    workspace/     barra in alto, menu Progetto e Contesti, palette comandi, fogli, Dockview, layout; SideBar.tsx (sidebar a tessere in stile macOS con il blocco «icona + pannello» fuso (framer-motion `layoutId`) + pannello) e sidebarViews.tsx (registro delle viste)
    docs/          pannello Documentazione (Markdown sanificato)
    panels/        tipi di pannello (kinds.ts), PanelHost, PanelErrorBoundary
    terminal/ files/ changes/ permissions/ plugins/   contenuto dei pannelli (terminal/HivePanel.tsx: vista Â«alveareÂ», piÃ¹ terminali in un mosaico; la apre un plugin con `terminal.hive`)
    state/         store Zustand (project, docs, prompt, explain, workspaceâ€¦)
    components/    ui-kit.tsx (Animate UI con il tema): importare da qui
plugins/         sorgenti dei plugin: adapter.mjs per plugin (o sorgenti .mts compilati dallo script di build, come java-dev) + ui/ con le pagine + sdk/cct-plugin-sdk.mjs
```

Per aggiungere una funzione che passa dal processo principale servono quattro punti: handler in `src/main/index.ts`, tipo in `AppApi` (`src/shared/types.ts`), ponte in `src/preload/index.ts`, versione finta in `src/renderer/src/lib/api.ts`.

## Insidie note

- **Selettori Zustand con React 19**: un selettore deve restituire un riferimento stabile. `useStore((s) => Object.values(s.x).filter(â€¦))` crea un array nuovo a ogni lettura e manda React in ciclo (errore #185) che smonta tutta l'interfaccia: finestra nera. Seleziona l'oggetto grezzo e filtra con `useMemo`.
- Ogni pannello Ã¨ avvolto in `PanelErrorBoundary`: un errore resta nel pannello.
- In Dockview `addPanel` senza `position` mette il pannello come scheda del gruppo attivo. Per gli editor c'Ã¨ la logica in `openFile` (`state/editor.ts`): primo file in un gruppo a destra dell'Esplora file.
- Ctrl+K dentro un terminale resta al terminale (cancella la riga in bash e Claude Code).
- I file UTF-16 (es. `ntuser.ini`) vengono visti come binari dall'editor: Ã¨ voluto.
- Le sessioni aperte dall'app passano a Claude Code hook e status line con `--settings` su un file temporaneo: i settings dell'utente non si toccano mai.
- Plugin: l'adapter gira con l'eseguibile dell'app e `ELECTRON_RUN_AS_NODE=1`; righe e colonne nella Plugin API partono da 1, percorsi in formato Windows.

- **Fogli e contesti**: `sheets` contiene i fogli di tutti i contesti e restano tutti montati. Per mostrare i fogli di un contesto usa `sheetsOf(sheets, contextId)` (come `SheetTabs`), non `sheets` direttamente. Id dei fogli di un contesto: `sviluppo:1a2b3c4d`, il layout iniziale dipende dalla parte prima dei due punti.
- Nel DOM ci sono i pannelli di **tutti** i fogli (quelli nascosti hanno `display: none`): nelle prove filtra gli elementi visibili (`getClientRects().length > 0`).
- **Menu del tasto destro**: Electron di suo non ne ha. Il menu di base (campi di testo, testo selezionato) Ã¨ in `main/contextMenuTemplate.ts`, collegato in `index.ts` a ogni finestra. I pannelli con menu proprio lo bloccano: Monaco (nell'editor e nel diff), Radix `ContextMenu` (Esplora file, fogli) e `useContextPopup` (`components/ContextPopup.tsx`: terminale, Markdown). Per un menu nuovo usa `useContextPopup`. I menu di Monaco stanno in uno shadow DOM (`.shadow-root-host`) e sono in inglese.
- **Testo selezionabile**: il `body` ha `user-select: none`; solo `.cct-md`, `.cct-chat`, `pre`, `code` e `.cct-selectable` sono selezionabili (`styles.css`). Un contenuto da leggere o copiare va in uno di questi, altrimenti il tasto destro non ha niente su cui agire.
- **Barra laterale e Esplora file**: l'Esplora file non Ã¨ piÃ¹ un pannello Dockview (`explorer` Ã¨ `hidden` in `kinds.ts` e si toglie dai layout salvati) ma la vista `ExplorerView` della barra laterale (`state/sidebar.ts`). Per aggiungere una vista (o un widget) usa `registerSidebarView`. Le icone dei file stanno in `lib/fileIcons.tsx` (`FileIcon`, pacchetto caricato a parte alla prima icona).
- **Ricerca e scorciatoie** (F13): la ricerca nei file Ã¨ `FileService.search` (usa l'indice della palette, quindi rispetta `.gitignore`) con il confronto in `shared/search.ts` (si prova da solo con `node --experimental-strip-types`). Le scorciatoie globali sono in `TopBar.tsx` (Ctrl+K/P/E, modalitÃ  della palette) e `SideBar.tsx` (Ctrl+Maiusc+E/F, Ctrl+F sul Markdown); nei terminali (`.xterm`) restano alla shell. Il Markdown che supporta Ctrl+F si segna con `findable` su `MarkdownView`. La radice dei file Ã¨ `rootForSheet` (`state/sidebar.ts`), la stessa per Esplora file, Cerca e palette.
- **Effetti che restituiscono valori**: la funzione di `useEffect` deve restituire `undefined` o una funzione di pulizia. In questo Chromium `element.scrollTo()` restituisce una **Promise**: `useEffect(() => el.scrollTo(â€¦), [])` fa lanciare a React Â«destroy is not a functionÂ» allo smontaggio e tutta l'interfaccia diventa nera. Usa sempre le parentesi graffe (`useEffect(() => { el.scrollTo(â€¦) }, [])`).
- **Componenti dentro componenti**: non definire un componente dentro il corpo di un altro (`function Entry` nell'Esplora file): a ogni disegno diventa un tipo nuovo e React lo ricrea, chiudendo menu e perdendo lo stato. Usa una funzione che restituisce JSX con `key`.
- **TerminalView dentro un contenitore flex in colonna**: la sua radice Ã¨ `flex-1 min-h-0`; se il genitore non Ã¨ `flex flex-col` il terminale ha altezza zero e resta vuoto (l'alveare l'ha mostrato).
- **Output smart**: non servire HTML generato con `srcdoc` (eredita la CSP dell'app e blocca gli script). Si serve da `app://explain/<token>` con la sua CSP; l'iframe non deve mai avere `allow-same-origin`.
- Il `.cctproj` non deve contenere percorsi assoluti nÃ© dati personali (J10); il progetto attivo e il contesto attivo stanno nelle impostazioni dell'app.
- Claude Code in una cartella nuova mostra Â«Quick safety checkÂ»: l'opzione preselezionata Ã¨ Â«No, exitÂ». Nelle prove con sessioni vere scendi su Â«Yes, I trust this folderÂ» prima di confermare.

## Java development pack (F15, F16): Ã¨ un plugin, non c'Ã¨ nulla di Java nel core

Tutto ciÃ² che riguarda Java sta in `plugins/` e l'app non lo conosce: servizi Maven/Gradle, JDK, run configuration, debug (DAP), importazione IntelliJ, vista Â«Esegui e debugÂ», breakpoint nel margine dell'editor. L'app offre solo i servizi generici della Plugin API ([docs/PLUGIN_API_DOCS.md](docs/PLUGIN_API_DOCS.md)). Se manca un servizio, si aggiunge lÃ¬ in forma generica (Â§8 del documento), mai con codice Java nel core.

Due pacchetti in `dist/plugins` (si costruiscono con `node scripts/build-plugins.mjs java javadev`, **da PowerShell**: in Git Bash `tar` Ã¨ quello GNU e non apre gli zip nÃ© i percorsi `C:\`):
- `cct.java` **1.2.0**: jdtls (adapter `plugins/java/adapter.mjs`) e la vista Â«PackageÂ» dell'Esplora file (`plugins/java/ui/packages.html`). Se c'Ã¨ il pack usa il suo JDK al posto del JRE, aggiunge Lombok come `-javaagent`, carica il bundle java-debug (`initializationOptions.bundles`) e legge i JDK dell'utente da `plugin-data/cct.java-dev/jdks.json` (`java.configuration.runtimes`).
- `cct.java-dev` **2.2.0**: sorgenti TypeScript in `plugins/java-dev/src/*.mts` (lo script di build li compila con `tsc` in `.mjs`, vedi `pack` in `scripts/build-plugins.mjs`), pagina `ui/run.html`. Porta tre download verificati: **JDK Temurin 25**, java-debug e Lombok. Nel manifest: `sidebarViews` (Esegui e debug, Ctrl+Maiusc+D), `editorGutter` (java), `commands`, `permissions: ["terminal"]`, `storage.settingsPrefixes: ["java."]` (i dati giÃ  salvati restano).

Cose da sapere:
- **Impostazioni per servizio** (`java.serviceSettings`, chiave = id del servizio): JDK (`java.serviceJdk`), versione di **Maven** e di **Gradle** (`maven`, `gradle`: assente = wrapper del progetto, poi `mvn`/`gradle` nel PATH) e **variabili d'ambiente** (`env`, sotto quelle della run configuration). Le versioni scelte sono scaricate dall'app in `<dati>/build-tools/<maven|gradle>/<versione>` (`tools.mts`: elenco da services.gradle.org e Maven Central, download con checksum pubblicato, mai senza). `launchContext` in `JavaDevService.mts` le risolve; se la versione scelta non Ã¨ scaricata l'avvio dÃ  un errore con il rimedio. `compatIssue` avvisa (non blocca) quando Maven/Gradle e JDK non vanno d'accordo (Gradle: tabella Â«Java compatibilityÂ» in `tools.mts`; Gradle 9 vuole Java 17+). jdtls importa comunque i progetti Gradle con il wrapper.
- **Combo** (`java.combos`, `JavaDevService.runCombo`): piÃ¹ run configuration avviate una dopo l'altra, nell'ordine scelto, con una **pausa in secondi** dopo ciascuna (0â€“600, prima del successivo). Si compongono nella modale `ui/combo.html`, pagina del plugin aperta con `ui.openPage` (due colonne, trascinamento HTML5 e frecce, preset da salvare/caricare/eliminare). L'avvio risponde subito e prosegue in background; l'avanzamento arriva con l'evento `combo` e resta in `state.comboRun` finchÃ© non si chiude. I terminali non si aprono uno per uno: `app.terminal.hive` li raccoglie in un solo alveare (stessa chiave per preset, quindi un riavvio aggiorna lo stesso pannello). Un passo che non parte non ferma gli altri; Â«Ferma tuttoÂ» chiude anche i servizi giÃ  partiti. Sono escluse le configurazioni `attach`; il debug resta uno solo per volta.
- **jdtls ha bisogno di un JDK, non di un JRE**: il debug usa `jdk.jdi`, che il JRE non ha (Â«`com.sun.jdi.VMDisconnectedException cannot be found`Â»). Per questo il pack porta il JDK 25. Il JDK dei *progetti* (Temurin 17/21â€¦ o quelli del PC) Ã¨ un'altra cosa: li gestisce `plugins/java-dev/src/jdks.mts`.
- **Come parlano le parti**: la pagina chiama l'adapter con `plugin.call`; l'adapter parla con jdtls via `app.plugin('cct.java', 'lsp/executeCommand' | 'lsp/state', â€¦)` (comandi `vscode.java.*`, `java.project.getAll`) e manda alla pagina eventi (`debug`, `output`, `progress`, `state`, `breakpoints`) con `app.emit`.
- **Flusso del debug** (`JavaDevService.debug`): aspetta che jdtls abbia importato il progetto â†’ `vscode.java.startDebugSession` (porta del server DAP) â†’ avvia il programma in una sessione `task` con JDWP â†’ aspetta la porta di debug â†’ collega il client DAP (`dap.mts`), manda i breakpoint, `configurationDone`. java-debug **non manda `continued`**: dopo continua/passo lo stato passa a Â«runningÂ» prima della richiesta.
- **Comandi di avvio** (`runConfig.mts`): Quarkus `-Ddebug=<porta> -Dsuspend=false`; Spring Boot `-Dspring-boot.run.jvmArguments`; test `-Dmaven.surefire.debug`; Gradle `--debug-jvm` (porta fissa 5005) e Quarkus `quarkusDev -Ddebug`. `-D` e `-P` degli argomenti vanno a Maven/Gradle, il resto a `-Dquarkus.args`. Wrapper (`mvnw.cmd`, `gradlew.bat`) cercato dalla cartella verso l'alto, poi `mvn`/`gradle` dal PATH. `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT` (antivirus o proxy che ispezionano HTTPS).
- **Sessioni `task`**: un comando qualsiasi in un PTY (`SessionManager.create` con `kind: 'task'`). L'adapter, dopo `app.session.create`, chiama `app.terminal.show(id)` (permesso `terminal`): l'app apre un pannello terminale sotto il pannello attivo (`showSessionTerminal` in `plugins/pluginBridge.ts`). I pannelli `task` si tolgono dai layout salvati all'avvio (`removeHiddenPanels`).
- **Importazione IntelliJ** (`ideaImport.mts`): Application, Maven, Gradle, Remote; JUnit e altri tipi sono segnalati come non supportati. I moduli IntelliJ non si importano (si usa la cartella di lavoro).
- **Breakpoint**: salvati nelle impostazioni (`java.breakpoints`) dall'adapter, che manda i segni al margine con `app.editor.markers` (stili `.cct-bp`, `.cct-debug-line`, disegnati da `EditorView.tsx`); il clic nel margine arriva all'adapter come `gutter.click`.
- **Prove**: l'adapter compilato si prova fuori dall'app parlandogli in JSON-RPC (si fa da Â«appÂ» e si rispondono le richieste `host/*`); la pagina e i servizi dell'app su Electron isolato con un plugin di prova; il debug vero con jdtls, Maven, Gradle e Quarkus reali, su una copia isolata di Electron con i pacchetti installati. Progetto di prova: `C:\Users\ALPHA\Desktop\java-demo` (fuori dal repository), con `README.md` che elenca la prova completa.

## Come provare

- Typecheck e build sempre.
- Prove end-to-end su una **copia isolata** di Electron: `node_modules\electron\dist\electron.exe <progetto> --remote-debugging-port=<porta>` con `CCT_USER_DATA=<cartella di prova>` (dati separati da quelli dell'utente) e `ELECTRON_RENDERER_URL` vuota. Si pilota l'interfaccia via Chrome DevTools Protocol (`Runtime.evaluate`, `Input.dispatchKeyEvent`) e si chiude il processo alla fine.
- Script e cartelle di prova vanno nello scratchpad della sessione, non nel repository.
- Aggiornamenti dai sorgenti: `CCT_UPDATE_DEV_CONFIG=<file yml>` con `provider: generic` e un server locale con `latest.yml`; usa un `updaterCacheDirName` di prova e cancellalo dopo.
- Per prove con piÃ¹ cose da guardare: riavvia con `Page.reload` dopo aver scritto impostazioni (`window.api.settings.set`) e `.cctproj` (`window.api.project.save`); la palette si apre con Ctrl+K via `Input.dispatchKeyEvent`. Una modifica da spiegare si semina nel database (tabella `changes` e file in `snapshots/`) prima della seconda partenza.
- App impacchettata: `dist\win-unpacked\Magnolia.exe` (senza installare).
