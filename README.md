# Magnolia

App desktop per Windows che riunisce in una finestra i terminali di Claude Code, le shell, i file, l'editor e la revisione delle modifiche.

- Requisiti funzionali: [requisiti-claude-code-terminal.md](requisiti-claude-code-terminal.md)
- Stack tecnico e fasi: [stack-tecnico.md](stack-tecnico.md)

## Stato

**Fase 1 completata**: scheletro Electron + React + Dockview, fogli (L1), pannelli agganciabili, fluttuanti e in finestre separate (L2–L4), salvataggio automatico e layout con nome (L5).

**Fase 2 completata**: terminali veri (S1–S9, W1–W5).
- Claude Code (nuova, riprendi, collega) e shell semplici: Git Bash, PowerShell, Prompt dei comandi, WSL.
- La sessione vive nel processo principale; i pannelli sono viste. Più viste sulla stessa sessione possono scrivere tutte; comanda la dimensione la vista con il focus.
- «Invia a…» e trascinamento di una scheda terminale su un foglio in basso per spostarla senza interrompere la sessione.
- Stato sulla scheda (al lavoro / inattiva / terminata), barra di stato con modello, effort e branch git; modello ed effort si cambiano a sessione aperta.
- Ogni progetto ricorda modello, effort e cartelle aggiuntive.

**Fase 3 completata**: integrazione con Claude Code tramite hook e status line.
- Le sessioni aperte dall'app ricevono hook HTTP e una status line con `--settings` (file temporaneo): i `settings.json` dell'utente e del progetto non vengono toccati.
- Stato preciso sulle schede (S6): al lavoro, in attesa (permesso o domanda), inattiva.
- Notifiche (S7): toast nell'app e notifica di Windows quando l'app non è in primo piano; pallino sulla scheda e sul foglio finché non guardi la sessione; «Mostra» porta alla sessione.
- Barra di stato (W5): modello ed effort reali (anche dopo un `/model` scritto a mano), percentuale di contesto, costo stimato nel suggerimento.

Nota: con la status line attiva, Claude Code non mostra più i suoi suggerimenti da tastiera nel piè di pagina (per esempio «esc to interrupt»).

**Fase 4 completata**: revisione delle modifiche di Claude (F4–F7).
- Ogni Edit, Write, MultiEdit o NotebookEdit di una sessione aperta dall'app viene registrato con la versione precedente del file (hook PreToolUse, prima che Claude scriva) e quella nuova (PostToolUse). Più modifiche allo stesso file si sommano finché non decidi.
- Pannello **Modifiche**: file raggruppati per sessione con +righe/−righe e stato; contatore sulla scheda; filtro «In attesa / Tutte».
- Diff affiancato con Monaco (in una colonna se il pannello è stretto), con le parti invariate compresse.
- **Approva**, **Approva sessione**, **Approva tutte**. **Rifiuta** ripristina il file (o lo cancella se l'aveva creato Claude) e Claude lo viene a sapere al messaggio successivo. Se il file è cambiato dopo la modifica di Claude, l'app chiede conferma prima di sovrascriverlo.
- **Richiedi modifiche** (F8): accortezze e divieti, anche su righe selezionate nel diff, inviati a Claude come tuo messaggio nella sessione. Quando Claude riscrive il file, la modifica torna «da rivedere»; il diff può mostrare solo cosa è cambiato dall'ultima richiesta e lo storico delle richieste resta consultabile. Non si può inviare se la sessione è terminata o se Claude sta aspettando una tua risposta nel terminale.
- **Revisione obbligatoria** (F9): a Claude fermo, finché la sessione ha modifiche da rivedere l'input (casella grafica, terminale, prompt predefiniti) è disabilitato; si sblocca approvando o rifiutando ogni file. Il blocco è nel processo principale (`SessionManager.isLocked`), non solo nell'interfaccia.
- **Modalità revisione** (F10): pulsante «Revisione» nella barra dell'editor; tasto destro sulla selezione › Revisiona… / Spiega con Haiku, anche dal Markdown impaginato (editor e pannello Modifiche). Le note vanno alla sessione Claude del foglio (`changes:reviewFile`).
- **Approva/rifiuta solo a Claude fermo, richieste in coda** (F11): mentre la sessione esegue, Approva e Rifiuta sono disabilitati; «Richiedi modifiche» e la modalità revisione restano attivi e i messaggi vanno in coda a Claude.
- **Menu del tasto destro** (F12): coerente in tutta l'app (campi di testo, testo selezionato, terminale, Markdown, Esplora file, fogli, editor).
- **Scorciatoie come VS Code** (F13): Ctrl+F (nel documento), Ctrl+Maiusc+F (ricerca nei file, vista «Cerca»), Ctrl+P (vai al file), Ctrl+E (file recenti); Ctrl+K resta la palette completa. Nei terminali le prime tre non si intercettano.
- **Barra laterale fissa** (F13): icone a sinistra e pannello della vista (prima l'Esplora file, Ctrl+Maiusc+E), con le icone di tipo file di vscode-icons (MIT). I widget (`.ccwidget`) si aggiungeranno come altre viste.
- **Plugin Java** (F15): `cct.java-2.0.0.ccplugin`, un solo pacchetto con language server, esecuzione, debug, combo e Maven/Gradle per servizio (sostituisce `cct.java` 1.x e `cct.java-dev`, che si disinstalla da solo). L'interfaccia è nel plugin, non nell'app. Vista «Esegui e debug» (Ctrl+Maiusc+D, logo Java nella barra laterale): servizi Java rilevati con il loro JDK, JDK Eclipse Temurin scaricabili, run configuration (anche importate da IntelliJ), esecuzione in un terminale e debug con breakpoint, stack, variabili ed espressioni; Quarkus, Maven, Gradle e Lombok. I pacchetti si costruiscono con `node scripts/build-plugins.mjs java javadev` **da PowerShell** (con il tar di Git Bash non funziona). Progetto di prova: `java-demo` (tre servizi con Lombok e le configurazioni IntelliJ).
- **Icona** nuova (`claude-code-terminal-icon/`, copie in `build/`): exe, installer, finestre e barra in alto.
- Le versioni dei file stanno in `%APPDATA%\Claude Code Terminal\snapshots`; le modifiche decise vengono dimenticate dopo 30 giorni.

**Fase 5 completata**: schermata Permessi (P1–P6), come pannello (pulsante «Permessi» nella barra in alto: si apre sul progetto del terminale attivo).
- Tre ambiti, ognuno con il suo file: Locale (`.claude\settings.local.json`), Progetto (`.claude\settings.json`), Utente (`~\.claude\settings.json`).
- Ogni regola: Consenti, Chiedi, Nega o Revoca; «Nuova regola» con strumento, specificatore e anteprima; ricerca.
- Origine e data di ogni regola: salvata dal terminale, aggiunta a mano, aggiunta fuori dall'app, già presente / condivisa col team / tutti i progetti.
- Cartelle aggiuntive (`additionalDirectories`) per ambito.
- Le modifiche si salvano con «Salva» dopo averle viste nell'anteprima del file, con le righe cambiate evidenziate. Le altre chiavi del file restano com'erano.
- Se un file cambia fuori dall'app (per esempio «Sì, e ricorda» nel terminale), il pannello si aggiorna e mostra cosa è cambiato; se avevi modifiche non salvate in quell'ambito ti chiede se ricaricare o tenere le tue.
- Un file con JSON non valido viene mostrato in sola lettura, con l'errore.

**Fase 6 completata**: file, editor e language server (F1–F3).
- **Esplora file**: albero del progetto e delle cartelle aggiuntive (`add-dir`) delle sessioni; file segnati M, A, D, R, U secondo git, etichetta «Claude» sui file con modifiche in revisione, numero di errori; si aggiorna da solo quando i file cambiano. Menu: Apri, Mostra in Esplora risorse, Copia percorso.
- **Editor** (Monaco): un file per pannello, ● nel titolo se non salvato, Ctrl+S per salvare. Se il file cambia su disco (per esempio dopo una modifica di Claude) si ricarica da solo; se hai modifiche non salvate chiede cosa fare.
- **Language server**: completamento, descrizioni al passaggio del mouse, «vai alla definizione» (anche in altri file) ed errori sottolineati. Dalla fase 6a arrivano tutti da plugin (vedi sotto).
  - TypeScript/JavaScript: server nativo di TypeScript 7 (`tsc --lsp`).
  - Python: Pyright. YAML: yaml-language-server.
  - Java: jdtls. Al primo file `.java` l'editor propone di scaricare il supporto Java nella cartella dell'app: un JRE 25 (Eclipse Temurin) e jdtls, circa 105 MB, con verifica SHA-256. I progetti Maven e Gradle vengono importati da jdtls.
  - XML e SQL per ora hanno solo la colorazione della sintassi.
- **Problemi**: errori e avvisi di tutti i server, per file; un clic porta alla riga.

**Fase 6a completata**: plugin di linguaggio (X1–X9). Il supporto ai linguaggi non è più incluso nell'app: si aggiunge importando plugin, come le estensioni di VS Code.
- Pulsante **Plugin** nella barra in alto: elenco dei plugin con stato dei loro server, attiva/disattiva, disinstalla, «Importa plugin…». Prima di installare si vedono linguaggi, attività, download (con checksum), plugin richiesti e SHA-256 del pacchetto.
- Ogni plugin contiene un **adapter** che parla con l'app tramite la [CCT Plugin API](docs/plugin-api.md), generica e uguale per tutti; le differenze tra i language server stanno negli adapter. Un SDK (`plugins/sdk`) fa quasi tutto il lavoro per i server LSP.
- Plugin pronti: TypeScript/JavaScript, Python, YAML, Java, Maven (e XML), Gradle, Angular. Maven e Gradle richiedono il plugin Java; Angular lavora insieme al plugin TypeScript.
- Se apri un file senza plugin per il suo linguaggio, l'editor lo dice e porta alla schermata dei plugin.

Per costruire i pacchetti in `dist/plugins` (Maven e Gradle hanno bisogno di Java: plugin Java installato o `JAVA_HOME`):

```bash
node scripts/build-plugins.mjs
```

**Fase 7 (widget) rimandata a dopo la 1.0**: l'analisi di widget e plugin verrà rivista. Il pannello Widget è nascosto: non compare nei menu e, se un layout salvato lo conteneva, viene tolto all'apertura.

**Fase 8 (versione 1.0)**: palette comandi, installer e aggiornamenti automatici.
- **Palette comandi** (L7): **Ctrl+K** o clic sul campo «Cerca file, sessioni o comandi…» nella barra in alto. Cerca tra comandi (nuovo terminale, nuovo foglio, aggiungi pannello, permessi, plugin, layout, dimensione del carattere, aggiornamenti), sessioni, fogli e file del progetto del foglio attivo. Frecce per scegliere, Invio per eseguire, Esc per chiudere. Accetta anche lettere sparse: «nterm» trova «Nuovo terminale».
- **Shell**: «Nuovo terminale» propone l'ultima shell usata.
- **Installer** per Windows (NSIS, per l'utente corrente) e **aggiornamenti automatici** da GitHub Releases (vedi «Installer e aggiornamenti» più sotto).

**Release 2 (fasi 9–14)**: progetti, contesti, documentazione, casella di input e output smart. Piano e decisioni in [piano-release-2.md](piano-release-2.md).

- **Progetti (fase 9).** Il menu **Progetto** nella barra in alto crea, apre e cambia progetto. Un progetto è un file `.cctproj` (JSON) nella cartella radice, con soli percorsi relativi: si può versionare nel repository. Le cartelle usate nella 1.0 compaiono nei recenti come «senza file» e si aprono come prima: il file si crea solo con «Crea il file di progetto». Un file salvato da una versione più nuova dell'app non si apre. L'ultimo progetto si riapre all'avvio.
- **Documentazione (fase 10).** Il pannello **Documentazione** (menu Pannello o palette) mostra `CLAUDE.md` della radice, rilevato da solo e aggiornato quando cambia, i riferimenti globali che scegli a mano con il pulsante + e i documenti del contesto. Ha indice delle sezioni, ricerca, link ai file e «Modifica» (apre l'editor). Se `CLAUDE.md` manca compare un avviso con il pulsante «Crea CLAUDE.md» (anche nel menu Progetto). Il Markdown viene sanificato: niente script né immagini.
- **Contesti (fasi 11–12).** Il selettore **Contesti** accanto al progetto crea, modifica, duplica, riordina ed elimina contesti; si passa dall'uno all'altro anche con la palette («Vai al contesto…»). Ogni contesto ha i suoi fogli, una cartella di lavoro facoltativa (relativa al progetto) e i suoi documenti. Esplora file e «Nuovo terminale» partono dalla cartella del contesto; le Modifiche si limitano alle sue cartelle (con la spunta per vederle tutte). Il primo contesto di un progetto prende i fogli già aperti. I terminali dei contesti non attivi restano in esecuzione.
- **Casella di input (fase 13).** Sotto ogni terminale Claude c'è una casella multiriga: **Invio** manda, **Maiusc+Invio** va a capo (si inverte con il pulsante a destra). **@** suggerisce i file della cartella, **/** i comandi di Claude Code, il pulsante @ inserisce un documento del progetto o il file dell'editor. Le frecce richiamano i messaggi precedenti del progetto. Si disattiva quando Claude aspetta una risposta nel terminale (permesso o domanda): rispondi lì. Il terminale resta interattivo.
- **Output smart (fase 14).** Nel pannello Modifiche la vista **Spiegazione** scrive, solo quando premi «Spiega», una pagina HTML chiara con `claude -p --model haiku` (il tuo login di Claude Code; circa un millesimo di dollaro a spiegazione). Gira in un iframe isolato, senza rete né accesso all'app. La spiegazione si salva: riaprirla non consuma token; «Rigenera» ne crea una nuova. Si nasconde e si riattiva dalla palette.

- **Approva tutte / Respingi tutte.** In fondo all'elenco delle Modifiche, e per ogni sessione («Approva sessione», «Respingi sessione»). Agiscono solo sulle modifiche che vedi (il filtro del contesto conta). «Respingi» chiede conferma, ripristina i file e cancella quelli creati da Claude; i file cambiati dopo Claude non si toccano senza una seconda conferma. Claude lo saprà al prossimo messaggio.
- **Prompt predefiniti.** Messaggi pronti da mandare a Claude con un clic: Ctrl+K e scrivi il nome («Prompt: …», si cerca anche nel testo). Vanno alla sessione Claude del foglio attivo (il terminale attivo, altrimenti uno visibile). «Gestisci prompt predefiniti…» nella palette, o «Prompt predefiniti…» sotto la casella di input (con il messaggio già scritto come testo di partenza), per aggiungere, modificare ed eliminare. Valgono per tutti i progetti. La prima volta ci sono quattro esempi, che puoi cambiare.

**Aggiornamenti successivi alla Release 2.**
- **Linux**: percorsi `/home/…` accettati ovunque (nuovo progetto, cartelle, file, Git, palette). Le shell proposte sono quelle di `/etc/shells` (la tua `$SHELL` per prima); Claude Code si trova nel PATH o in `~/.local/bin/claude`. Su Linux maiuscole e minuscole nei percorsi sono distinte. Da compilare una volta: `npx electron-builder install-app-deps` (node-pty, servono gcc e make). Gli installer e gli aggiornamenti automatici restano per Windows.
- **Utilizzo dell'abbonamento**: accanto al contesto, nella barra di stato dei terminali Claude, due barre: **Sessione** (finestra di 5 ore) e **Settimana**. Colore giallo oltre il 70%, rosso oltre l'85%; al passaggio del mouse, quanto manca all'azzeramento. Sono limiti dell'account, quindi mostrano gli ultimi dati arrivati da qualsiasi sessione. Compaiono solo con un abbonamento Pro, Max o Ultra, dopo la prima risposta di Claude (è Claude Code a non mandarli prima).
- **Claude Code puro**: le sessioni aperte dall'app tolgono a Claude gli strumenti **Artifact** di claude.ai (`--disallowedTools`), così i file si scrivono nella cartella in cui hai aperto la sessione e non si pubblicano pagine online. Per riattivarli: Ctrl+K › «Artifact di claude.ai nelle nuove sessioni». Vale dalle sessioni nuove, non da quelle già aperte.
- **Vista a package (dal plugin Java)**: non è nell'app ma nel plugin, che la porta nell'Esplora file con il pulsante **Package / File** (pagina in iframe isolato, vedi [docs/plugin-contributi.md](docs/plugin-contributi.md)). Per moduli Maven e Gradle mostra Sorgenti, Risorse, Test e «Altri file», con package compatti come in IntelliJ. Richiede il plugin Java **1.2.0**: ricostruiscilo con `node scripts/build-plugins.mjs java` e reinstallalo. La scelta della vista si ricorda.
- **Modifiche fuori dal progetto**: le scritture di Claude fuori dalla cartella della sessione, dalle sue cartelle aggiuntive e dal repository git (script di appoggio in cartelle temporanee, nello scratchpad, nella home) non entrano nel pannello Modifiche e non bloccano la revisione obbligatoria: non c'è nulla da approvare.
- **Domande interattive nella vista grafica**: quando Claude fa una domanda a scelta (AskUserQuestion) compare un **carosello**: una domanda alla volta con le opzioni (anche a scelta multipla), puntini per spostarsi, avanzamento automatico dopo una scelta singola e «Invia risposta» all'ultima; l'app digita le frecce, lo spazio e Invio nel terminale. La risposta libera («Altro») si dà nel terminale con «Rispondi nel terminale».
- **Colore d'accento**: Ctrl+K › «Colore d'accento…», otto colori o uno a scelta; si applica subito e resta salvato.
- **F1–F9**: passano al foglio 1–9 del contesto attivo, anche con il focus nel terminale (sulla scheda di un foglio F2 resta «rinomina»; doppio clic funziona sempre).
- **Markdown impaginato**: nell'editor i file `.md` si aprono in **Anteprima** (interruttore Anteprima/Sorgente in alto). Nel pannello Modifiche, il diff di un `.md` ha la vista **Impaginato**: blocchi aggiunti in verde, tolti in rosso, senza sintassi.
- **Revisione dal diff con il tasto destro**: seleziona del testo nel lato «dopo», tasto destro › **Revisiona…**: si apre «Richiedi modifiche» con una nota già ancorata a quelle righe. I **tipi di nota** sono configurabili (pulsante «Tipi di nota» nel riquadro): nome, istruzione per Claude (per esempio «da rispettare», scritta accanto alla nota nel messaggio) e colore. Predefiniti: Accortezza, Divieto, Domanda. Valgono per tutti i progetti.
- **Spiega con Haiku**: tasto destro su righe selezionate, nel diff e nell'editor. Haiku spiega cosa fanno e che ruolo hanno nel file (riceve il file intero, o la zona attorno se è molto grande). Come l'output smart: parte solo a richiesta, iframe isolato, risposta salvata (riaprirla non consuma token), si disattiva dalla palette insieme alla spiegazione delle modifiche.
- **Vista grafica (bridge)**: il pulsante **Vista grafica** nella barra di stato di un terminale Claude mostra la conversazione impaginata (risposte in Markdown, strumenti richiudibili con esito). Legge la trascrizione che Claude Code già salva in `~/.claude/projects`, in sola lettura: nessuna rete, nessun login, nessun uso dell'API. Il terminale vero resta in esecuzione sotto e si ritorna con «Terminale»; la casella di input funziona in entrambe le viste. La scelta della vista si ricorda.
  - Modifiche ai file (Edit, MultiEdit, Write) come riquadro con diff colorato, righe +/−, nome del file cliccabile.
  - Stile di Claude Code, senza fumetti: prompt con «›», risposte e strumenti con «●», esiti con «⎿», sfondo meno scuro del terminale. Strumenti consecutivi raggruppati in un riepilogo («Read ×5, Bash ×4») che si apre; esito e dettagli di ciascuno.
  - Blocchi di codice con etichetta del linguaggio e «Copia»; copia dell'intera risposta al passaggio del mouse; orario sul fumetto.
  - **Interrompi** mentre Claude lavora (Esc) e, quando aspetta un permesso o una domanda, i pulsanti **Sì (1)**, **No (Esc)** o «Rispondi nel terminale». Per i permessi «Sì (1)» manda la cifra 1: se la domanda ha scelte diverse usa il terminale.
  - I messaggi più vecchi si caricano a pagine.

Le modifiche fatte da Claude con comandi di shell (per esempio `sed` o `git checkout`) non passano dagli strumenti di modifica e quindi non compaiono nel pannello.

Claude Code viene cercato nel PATH, poi in `%USERPROFILE%\.local\bin` (installer ufficiale), poi nella copia dell'app desktop di Claude.

## Comandi

Serve Node.js 24 o più recente.

```bash
npm install
```

```bash
npm run dev
```

| Comando | Cosa fa |
| --- | --- |
| `npm run dev` | Avvia l'app Electron in sviluppo, con ricaricamento automatico |
| `npm run build` | Compila main, preload e interfaccia in `out/` |
| `npm start` | Avvia l'app compilata |
| `npm run web` | Solo interfaccia nel browser (porta 5199), con salvataggio in localStorage al posto di SQLite |
| `npm run typecheck` | Controllo dei tipi TypeScript |
| `npm run dist` | Crea l'installer Windows in `dist/` (senza pubblicarlo) |
| `npm run release` | Crea l'installer e lo pubblica come release su GitHub (serve `GH_TOKEN`) |

## Struttura

```
src/
  main/       processo principale: finestre, protocollo app://, database SQLite
  preload/    ponte sicuro tra interfaccia e processo principale (window.api)
  shared/     tipi condivisi
  renderer/   interfaccia React
    src/components/  componenti di base (Animate UI con il tema dell'app)
    src/workspace/   barra superiore, palette comandi, fogli, Dockview, layout
    src/panels/      tipi di pannello
    src/state/       store Zustand
```

I dati dell'app stanno in `%APPDATA%\Claude Code Terminal\claude-code-terminal.db`.

Scorciatoie:
- **Ctrl+Maiusc+T**: nuovo terminale.
- **Ctrl+K**: palette comandi. Dentro un terminale Ctrl+K resta al terminale (in bash e in Claude Code cancella la riga): clicca il campo in alto.
- **Doppio clic** o **F2** su un foglio per rinominarlo; **clic centrale** su una scheda per chiuderla.
- **F12**: strumenti di sviluppo.

## Installer e aggiornamenti

```bash
npm run dist
```

Produce in `dist/`:
- `Claude-Code-Terminal-Setup-<versione>.exe`: l'installer da distribuire;
- `latest.yml` e il file `.blockmap`: servono agli aggiornamenti automatici;
- `win-unpacked/`: l'app già pronta, utile per provarla senza installarla.

Note:
- L'installer installa per l'utente corrente, senza diritti di amministratore. Si può scegliere la cartella; crea i collegamenti sul desktop e nel menu Start. Disinstallando, i dati in `%APPDATA%\Claude Code Terminal` restano.
- L'installer non è firmato: al primo avvio Windows SmartScreen mostra un avviso («Ulteriori informazioni › Esegui comunque»).
- node-pty non viene ricompilato (`npmRebuild: false`): si usano i suoi binari precompilati, quindi non servono gli strumenti di compilazione di Visual Studio.
- I plugin di linguaggio non sono nell'installer: si costruiscono con `node scripts/build-plugins.mjs` e si distribuiscono a parte.

**Aggiornamenti automatici.** L'app installata controlla le versioni nuove 15 secondi dopo l'avvio, poi ogni 6 ore, oppure quando scegli «Cerca aggiornamenti» nella palette. La versione nuova si scarica in background e si installa alla chiusura dell'app; il pulsante «Aggiorna alla x.y.z» nella barra in alto la installa subito (l'app si riapre da sola, i terminali aperti si chiudono). Dai sorgenti (`npm run dev`, `npm start`) gli aggiornamenti sono spenti.

Da completare prima della prima release: indicare in `package.json` il repository GitHub che ospita le release, nella sezione `build`:

```json
"publish": { "provider": "github", "owner": "<account>", "repo": "<repository>" }
```

Senza questa configurazione l'installer funziona, ma l'app non trova aggiornamenti. Il repository delle release deve essere pubblico, altrimenti l'app installata non può scaricarle.

Per pubblicare una versione nuova:
1. aumenta `version` in `package.json` (per esempio da `1.0.0` a `1.0.1`);
2. imposta un token GitHub con il permesso di scrivere le release, nella variabile `GH_TOKEN`;
3. esegui `npm run release`: crea una release in bozza su GitHub con installer, `latest.yml` e blockmap;
4. su GitHub pubblica la bozza: da quel momento le app installate la trovano.

Per provare gli aggiornamenti senza pubblicare nulla, l'app avviata dai sorgenti accetta un file di configurazione di prova nella variabile `CCT_UPDATE_DEV_CONFIG` (per esempio con `provider: generic` e l'indirizzo di un server locale che espone `latest.yml`).

Su Windows PowerShell, se `npm` non parte per i criteri di esecuzione degli script, usa `npm.cmd` (per esempio `npm.cmd start`).
