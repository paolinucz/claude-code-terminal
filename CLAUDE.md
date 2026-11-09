# Claude Code Terminal

App desktop per Windows (Electron + React + Dockview) che riunisce i terminali di Claude Code, le shell, i file, l'editor e la revisione delle modifiche. Autore: Paolo Coletta.

Documenti di riferimento (da leggere prima di cambiamenti grossi):
- [requisiti-claude-code-terminal.md](requisiti-claude-code-terminal.md): requisiti con ID (L1, S3, F4, X2…) e decisioni prese (§9).
- [stack-tecnico.md](stack-tecnico.md): architettura, fasi di sviluppo (§5), rischi e decisioni aperte (§7).
- [docs/plugin-api.md](docs/plugin-api.md): CCT Plugin API v1 per i plugin di linguaggio.
- [piano-release-2.md](piano-release-2.md): progetti, contesti, casella di input e output smart (J, B, O), decisioni e cosa è stato provato.
- [README.md](README.md): stato per fase, comandi, installer e aggiornamenti.

## Stato

- Fasi 1–6a e fase 8 completate: questa è la base della **1.0** (installata e funzionante).
- **Release 2 (fasi 9–14)** implementata e provata su Electron isolato: progetti `.cctproj`, contesti, documentazione, casella di input, output smart. Piano e decisioni in [piano-release-2.md](piano-release-2.md). Da fare: prova a mano dell'interfaccia, versione `2.0.0`, release.
- **Fase 7 (widget) rimandata** a dopo la 1.0: l'analisi di widget e plugin va rivista con l'utente prima di scrivere codice. Il pannello `widgets` esiste ancora in `panels/kinds.ts` ma è `hidden: true`.
- Da fare prima della prima release: account e repository GitHub in `build.publish` di `package.json` (per gli aggiornamenti), versione a `1.0.0`. L'icona dell'app c'è (`build/icon.ico` per exe e installer, `build/icon.png` per le finestre, `src/renderer/src/assets/icon-small.svg` nella barra in alto; originali in `claude-code-terminal-icon/`: la versione dettagliata da 48 px in su, la semplificata sotto).
- Dopo la 0.2.0 (non ancora rilasciato): revisione obbligatoria e modalità revisione (F9–F11), menu del tasto destro e testo selezionabile (F12), ricerca e scorciatoie come VS Code (F13), barra laterale con Esplora file e icone di file (F14), **Java development pack** (F15), icona nuova. Da fare: **interfaccia dei plugin dentro il pacchetto** (F16, sezione sotto) e la prova a mano di tutto questo.
- Si lavora ora per aggiornamenti successivi: correzioni e miglioramenti trovati usando l'app.

## Regole di lavoro

- **Tutto in italiano**: testi dell'interfaccia, commenti nel codice, documenti, messaggi di commit.
- **Commit solo quando l'utente lo chiede**, su `main`, con un messaggio sensato in italiano (titolo + elenco di cosa cambia e perché). Niente push se non richiesto.
- Aggiorna README, stack tecnico e requisiti quando una modifica cambia il comportamento o una decisione.
- Le scelte che toccano l'utente (formati, servizi esterni, pubblicazioni) si chiedono prima.
- Non avviare troppi processi insieme: una prova Electron alla volta, e chiudila alla fine. Se l'utente dice che proverà lui un binario, non lanciarlo.

## Ambiente (Windows)

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
| `node scripts/build-plugins.mjs` | Pacchetti `.ccplugin` in `dist/plugins`. |

## Struttura

```
src/
  main/          processo principale
    index.ts       finestre, protocollo app://, IPC (ipcMain.handle 'area:azione')
    db.ts          SQLite con node:sqlite (impostazioni, fogli, layout, modifiche, plugin)
    sessions/      SessionManager (node-pty), HookServer (hook HTTP e status line di Claude Code), shell
    changes/       ChangeTracker: modifiche di Claude, snapshot, approva/rifiuta/revisione (F4–F8)
    permissions/   file settings di Claude Code nei tre ambiti (P1–P6)
    files/         FileService: albero, lettura/scrittura, git status, indice per la palette
    plugins/       PluginManager (installazione, hash) e PluginHost (adapter JSON-RPC)
    projects/      ProjectService: file .cctproj (leggi, crea, salva, recenti)
    changes/ExplainService.ts  output smart: claude -p con Haiku, cache nel database, pagina servita da app://explain
    sessions/TranscriptService.ts  vista grafica: legge la trascrizione JSONL di Claude Code (parser in shared/transcript.ts)
    updater.ts     aggiornamenti automatici (electron-updater)
    java/          Java development pack: JavaDevService (servizi, JDK, run configuration, debug), services.ts, runConfig.ts, ideaImport.ts, jdks.ts, dap.ts (client DAP)
    contextMenuTemplate.ts  menu nativo di base (campi di testo, testo selezionato)
  preload/       window.api (tipizzata da AppApi)
  shared/        tipi condivisi tra main, preload e interfaccia (java.ts, search.ts, xml.ts: anche logica pura, si prova da sola)
  renderer/src/  interfaccia React
    workspace/     barra in alto, menu Progetto e Contesti, palette comandi, fogli, Dockview, layout; SideBar.tsx (barra delle icone + pannello laterale fisso) e sidebarViews.tsx (registro delle viste)
    docs/          pannello Documentazione (Markdown sanificato)
    panels/        tipi di pannello (kinds.ts), PanelHost, PanelErrorBoundary
    terminal/ files/ changes/ permissions/ plugins/   contenuto dei pannelli
    java/          JavaView (vista «Esegui e debug») e ConfigDialog; stato in state/javaDev.ts e state/javaFollow.ts
    state/         store Zustand (project, docs, prompt, explain, workspace…)
    components/    ui-kit.tsx (Animate UI con il tema): importare da qui
plugins/         sorgenti dei plugin di linguaggio: adapter.mjs per plugin + sdk/cct-plugin-sdk.mjs
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

- **Fogli e contesti**: `sheets` contiene i fogli di tutti i contesti e restano tutti montati. Per mostrare i fogli di un contesto usa `sheetsOf(sheets, contextId)` (come `SheetTabs`), non `sheets` direttamente. Id dei fogli di un contesto: `sviluppo:1a2b3c4d`, il layout iniziale dipende dalla parte prima dei due punti.
- Nel DOM ci sono i pannelli di **tutti** i fogli (quelli nascosti hanno `display: none`): nelle prove filtra gli elementi visibili (`getClientRects().length > 0`).
- **Menu del tasto destro**: Electron di suo non ne ha. Il menu di base (campi di testo, testo selezionato) è in `main/contextMenuTemplate.ts`, collegato in `index.ts` a ogni finestra. I pannelli con menu proprio lo bloccano: Monaco (nell'editor e nel diff), Radix `ContextMenu` (Esplora file, fogli) e `useContextPopup` (`components/ContextPopup.tsx`: terminale, Markdown). Per un menu nuovo usa `useContextPopup`. I menu di Monaco stanno in uno shadow DOM (`.shadow-root-host`) e sono in inglese.
- **Testo selezionabile**: il `body` ha `user-select: none`; solo `.cct-md`, `.cct-chat`, `pre`, `code` e `.cct-selectable` sono selezionabili (`styles.css`). Un contenuto da leggere o copiare va in uno di questi, altrimenti il tasto destro non ha niente su cui agire.
- **Barra laterale e Esplora file**: l'Esplora file non è più un pannello Dockview (`explorer` è `hidden` in `kinds.ts` e si toglie dai layout salvati) ma la vista `ExplorerView` della barra laterale (`state/sidebar.ts`). Per aggiungere una vista (o un widget) usa `registerSidebarView`. Le icone dei file stanno in `lib/fileIcons.tsx` (`FileIcon`, pacchetto caricato a parte alla prima icona).
- **Ricerca e scorciatoie** (F13): la ricerca nei file è `FileService.search` (usa l'indice della palette, quindi rispetta `.gitignore`) con il confronto in `shared/search.ts` (si prova da solo con `node --experimental-strip-types`). Le scorciatoie globali sono in `TopBar.tsx` (Ctrl+K/P/E, modalità della palette) e `SideBar.tsx` (Ctrl+Maiusc+E/F, Ctrl+F sul Markdown); nei terminali (`.xterm`) restano alla shell. Il Markdown che supporta Ctrl+F si segna con `findable` su `MarkdownView`. La radice dei file è `rootForSheet` (`state/sidebar.ts`), la stessa per Esplora file, Cerca e palette.
- **Effetti che restituiscono valori**: la funzione di `useEffect` deve restituire `undefined` o una funzione di pulizia. In questo Chromium `element.scrollTo()` restituisce una **Promise**: `useEffect(() => el.scrollTo(…), [])` fa lanciare a React «destroy is not a function» allo smontaggio e tutta l'interfaccia diventa nera. Usa sempre le parentesi graffe (`useEffect(() => { el.scrollTo(…) }, [])`).
- **Componenti dentro componenti**: non definire un componente dentro il corpo di un altro (`function Entry` nell'Esplora file): a ogni disegno diventa un tipo nuovo e React lo ricrea, chiudendo menu e perdendo lo stato. Usa una funzione che restituisce JSX con `key`.
- **Output smart**: non servire HTML generato con `srcdoc` (eredita la CSP dell'app e blocca gli script). Si serve da `app://explain/<token>` con la sua CSP; l'iframe non deve mai avere `allow-same-origin`.
- Il `.cctproj` non deve contenere percorsi assoluti né dati personali (J10); il progetto attivo e il contesto attivo stanno nelle impostazioni dell'app.
- Claude Code in una cartella nuova mostra «Quick safety check»: l'opzione preselezionata è «No, exit». Nelle prove con sessioni vere scendi su «Yes, I trust this folder» prima di confermare.

## Java development pack (F15)

Due pacchetti in `dist/plugins` (si costruiscono con `node scripts/build-plugins.mjs java javadev`, **da PowerShell**: in Git Bash `tar` è quello GNU e non apre gli zip né i percorsi `C:\`):
- `cct.java` **1.1.0**: jdtls. L'adapter (`plugins/java/adapter.mjs`) se c'è il pack usa il suo JDK al posto del JRE, aggiunge Lombok come `-javaagent`, carica il bundle java-debug (`initializationOptions.bundles`) e legge i JDK dell'utente da `plugin-data/cct.java-dev/jdks.json` (`java.configuration.runtimes`).
- `cct.java-dev` **1.0.0**: senza adapter, porta tre download verificati: **JDK Temurin 25** (`jdk/`), java-debug (`debug/java-debug.jar`) e Lombok (`lombok/lombok.jar`).

Cose da sapere:
- **jdtls ha bisogno di un JDK, non di un JRE**: il debug usa `jdk.jdi`, che il JRE non ha («`com.sun.jdi.VMDisconnectedException cannot be found`»). Per questo il pack porta il JDK 25. Il JDK dei *progetti* (Temurin 17/21… o quelli del PC) è un'altra cosa: li gestisce `main/java/jdks.ts`.
- **Plugin API**: oltre alla API di base c'è la richiesta generica `call` (`PluginHost.call`, `handlers.call` nell'SDK). L'adapter LSP risponde a `lsp/executeCommand` e `lsp/state`: così il processo principale parla con jdtls (comandi `vscode.java.*`, `java.project.getAll`).
- **Flusso del debug** (`JavaDevService.debug`): aspetta che jdtls abbia importato il progetto → `vscode.java.startDebugSession` (porta del server DAP) → avvia il programma in una sessione `task` con JDWP → aspetta la porta di debug → collega il client DAP (`dap.ts`), manda i breakpoint, `configurationDone`. java-debug **non manda `continued`**: dopo continua/passo lo stato passa a «running» prima della richiesta.
- **Comandi di avvio** (`runConfig.ts`): Quarkus `-Ddebug=<porta> -Dsuspend=false`; Spring Boot `-Dspring-boot.run.jvmArguments`; test `-Dmaven.surefire.debug`; Gradle `--debug-jvm` (porta fissa 5005) e Quarkus `quarkusDev -Ddebug`. `-D` e `-P` degli argomenti vanno a Maven/Gradle, il resto a `-Dquarkus.args`. Wrapper (`mvnw.cmd`, `gradlew.bat`) cercato dalla cartella verso l'alto, poi `mvn`/`gradle` dal PATH. `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT` (antivirus o proxy che ispezionano HTTPS).
- **Sessioni `task`**: un comando qualsiasi in un PTY (`SessionManager.create` con `kind: 'task'`). Senza una vista la sessione sparisce alla fine: `state/javaFollow.ts` apre subito un pannello terminale sotto il pannello attivo. I pannelli `task` si tolgono dai layout salvati all'avvio (`removeHiddenPanels`).
- **Importazione IntelliJ** (`ideaImport.ts`): Application, Maven, Gradle, Remote; JUnit e altri tipi sono segnalati come non supportati. I moduli IntelliJ non si importano (si usa la cartella di lavoro).
- **Breakpoint**: salvati nelle impostazioni (`java.breakpoints`), mostrati nel margine di Monaco per i file `.java` (`EditorView.tsx`, stili `.cct-bp`, `.cct-debug-line`).
- **Prove**: la logica pura (`services`, `runConfig`, `ideaImport`, `xml`, `search`) si prova impacchettando con rolldown (alias `@shared`); il debug vero con jdtls, Maven, Gradle e Quarkus reali, su una copia isolata di Electron con i pacchetti installati. Progetto di prova: `C:\Users\ALPHA\Desktop\java-demo` (fuori dal repository), con `README.md` che elenca la prova completa.

## Interfaccia dei plugin dentro il pacchetto (F16, da fare)

Oggi la vista «Esegui e debug» è **nell'app** (`JavaView`, `ConfigDialog`, margine dell'editor): il pacchetto fa solo da interruttore e porta file e motore. L'obiettivo, come le estensioni di VS Code, è che il plugin porti **anche la sua interfaccia**. Decisioni già prese con l'utente (9 novembre 2026), da non rimettere in discussione senza chiedere:
- **Iframe isolato con API a messaggi** (come in stack-tecnico §4 «Widget»): HTML/JS dentro il `.ccplugin`, servito con la sua CSP, senza `allow-same-origin`; l'app dà variabili CSS e CSS di base; permessi dichiarati nel manifest e mostrati prima dell'installazione. Il motore resta l'adapter Node (richieste `call`).
- **Si parte dal runtime minimo e dal Java come primo plugin convertito**: pannello nella barra laterale (`registerSidebarView` esiste già), API essenziale (aprire file alla riga, avviare terminali, decorazioni e clic nel margine dell'editor, impostazioni del plugin), poi la vista Java in un pacchetto. La vista attuale resta finché la nuova non funziona.
- Da progettare: formato di `contributes` nel manifest, protocollo dei messaggi, versione dell'API, build dell'interfaccia di un plugin (piccolo bundler), aggiornamenti e controllo dell'impronta come per gli adapter.

## Come provare

- Typecheck e build sempre.
- Prove end-to-end su una **copia isolata** di Electron: `node_modules\electron\dist\electron.exe <progetto> --remote-debugging-port=<porta>` con `CCT_USER_DATA=<cartella di prova>` (dati separati da quelli dell'utente) e `ELECTRON_RENDERER_URL` vuota. Si pilota l'interfaccia via Chrome DevTools Protocol (`Runtime.evaluate`, `Input.dispatchKeyEvent`) e si chiude il processo alla fine.
- Script e cartelle di prova vanno nello scratchpad della sessione, non nel repository.
- Aggiornamenti dai sorgenti: `CCT_UPDATE_DEV_CONFIG=<file yml>` con `provider: generic` e un server locale con `latest.yml`; usa un `updaterCacheDirName` di prova e cancellalo dopo.
- Per prove con più cose da guardare: riavvia con `Page.reload` dopo aver scritto impostazioni (`window.api.settings.set`) e `.cctproj` (`window.api.project.save`); la palette si apre con Ctrl+K via `Input.dispatchKeyEvent`. Una modifica da spiegare si semina nel database (tabella `changes` e file in `snapshots/`) prima della seconda partenza.
- App impacchettata: `dist\win-unpacked\Claude Code Terminal.exe` (senza installare).
