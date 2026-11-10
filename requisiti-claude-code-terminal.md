# Magnolia – Requisiti funzionali

Versione 0.4 · 7 novembre 2026 · Paolo Coletta

## 1. Visione

Un'app desktop per Windows che apri la mattina e ti basta per tutta la giornata di lavoro. Mette in una sola finestra i terminali di Claude Code, le shell, i file, l'editor Java, la revisione delle modifiche e i tuoi widget.

- Claude Code gira in un terminale vero, quindi resta l'esperienza originale e non un'interfaccia che la imita.
- L'interfaccia è modulare: ogni strumento è un pannello che sposti, ridimensioni e raggruppi.
- Le nuove funzioni arrivano come widget, senza toccare il codice dell'app.
- Lo stack tecnologico è descritto in [stack-tecnico.md](stack-tecnico.md). L'interfaccia è in React e usa i componenti di **Animate UI**.
- La v1 ha solo il tema scuro. Tutti i colori stanno in variabili CSS, così un tema chiaro si può aggiungere dopo senza riscrivere l'interfaccia né i widget.

## 2. Fogli, pannelli e layout

L'interfaccia è divisa in fogli, come in Excel. Le schede dei fogli stanno in basso e ogni foglio è un'area di lavoro indipendente, con i suoi pannelli.

| ID | Requisito |
| --- | --- |
| L1 | Fogli predefiniti: Sviluppo, Revisione e Debug. Si possono creare, rinominare, riordinare e chiudere. |
| L2 | Ogni foglio contiene quanti pannelli vuoi: terminali, esplora file, editor, modifiche/diff, widget. |
| L3 | I pannelli si agganciano a una griglia. Puoi trascinarli, ridimensionarli e raggrupparli in schede. |
| L4 | Un pannello può stare in tre modi: agganciato, fluttuante dentro la finestra, oppure staccato in una finestra separata (anche su un secondo monitor). |
| L5 | La disposizione di ogni foglio si salva da sola. Puoi anche salvarla come layout con un nome e riapplicarla dopo. Un layout salvato contiene solo la disposizione dei pannelli, non le sessioni: quando lo applichi, i terminali vuoti propongono Nuova, Riprendi o Collega. |
| L6 | Non c'è una sidebar fissa: anche workspace, modello e permessi sono pannelli o finestre di dialogo. |
| L7 | Una palette comandi (Ctrl+K) cerca tra file, sessioni, fogli e comandi. |

## 3. Sessioni e terminali

La sessione è separata dalla finestra in cui la vedi. Ogni sessione è un processo gestito centralmente dall'app, e i pannelli sono solo viste collegate a quel processo. Puoi spostare, staccare o chiudere una vista senza mai interrompere la sessione.

| ID | Requisito |
| --- | --- |
| S1 | Quando apri un terminale scegli il tipo: sessione Claude Code oppure shell semplice (Git Bash, PowerShell, WSL). |
| S2 | Per Claude Code scegli tra: nuova sessione, riprendi una sessione precedente, collega una sessione già attiva. |
| S3 | Collegare una sessione apre una seconda vista sullo stesso processo, anche in un altro foglio. Tutte le viste collegate possono scrivere: l'input arriva allo stesso processo nell'ordine in cui viene digitato. |
| S4 | «Invia a…» sposta una sessione in un altro foglio (per esempio da Debug a Revisione) senza perdere il contesto. |
| S5 | Puoi trascinare un terminale da un foglio all'altro. |
| S6 | Ogni scheda mostra lo stato della sessione: al lavoro, in attesa di input, inattiva. |
| S7 | Ricevi una notifica quando una sessione finisce o chiede un permesso, anche se il suo foglio non è aperto. |
| S8 | Le sessioni chiuse restano nell'elenco «Riprendi», con data e titolo. |
| S9 | Quando apri un terminale scegli dove metterlo: agganciato, fluttuante o in una finestra separata. |

## 4. Workspace, modello ed effort

| ID | Requisito |
| --- | --- |
| W1 | Scegli la cartella di lavoro del progetto quando apri la sessione. |
| W2 | Aggiungi e togli cartelle di contesto dall'interfaccia. L'app le passa a Claude Code con `--add-dir`. |
| W3 | Scegli modello (Opus, Sonnet, Haiku) ed effort prima dell'avvio, e puoi cambiarli anche a sessione aperta. |
| W4 | Ogni progetto ricorda gli ultimi valori usati e li propone per le nuove sessioni. |
| W5 | La barra di stato del terminale mostra modello, effort, percentuale di contesto usata e branch git. |

## 5. Permessi

La schermata dei permessi legge e scrive direttamente i file di impostazioni di Claude Code. Così Claude Code applica le regole da solo, senza integrazioni aggiuntive.

| ID | Requisito |
| --- | --- |
| P1 | Tre ambiti, ognuno con il suo file: Locale (`.claude/settings.local.json`), Progetto (`.claude/settings.json`), Utente (`~/.claude/settings.json`). |
| P2 | Ogni regola si imposta su Consenti, Chiedi o Nega, oppure si revoca. |
| P3 | Quando nel terminale rispondi «Sì, e ricorda», la regola compare subito nell'elenco con data e origine. |
| P4 | Dalla stessa schermata gestisci le cartelle aggiuntive (`additionalDirectories`). |
| P5 | Prima di salvare vedi un'anteprima del JSON che verrà scritto. |
| P6 | Se un file viene modificato fuori dall'app, l'app lo ricarica e ti mostra cosa è cambiato. |

## 6. File, editor Java e revisione delle modifiche

Tutto succede dentro l'app, senza aprire editor esterni. Ogni modifica di Claude finisce in un elenco: guardi il diff di ognuna e la approvi o la rifiuti.

| ID | Requisito |
| --- | --- |
| F1 | Esplora file con vista ad albero del workspace e delle cartelle aggiuntive. I file modificati sono segnati con M, A o D. |
| F2 | Editor integrato con language server: completamento, errori, vai alla definizione. Linguaggi: Java (priorità), TypeScript/JavaScript, Python, XML, YAML e SQL. L'editor deve permettere di aggiungere altri language server in seguito. |
| F3 | Un pannello Problemi elenca errori e avvisi del progetto, da tutti i language server attivi. |
| F4 | Ogni Edit o Write di Claude viene registrato insieme alla versione precedente del file. |
| F5 | Il pannello Modifiche elenca i file toccati da ogni sessione, con lo stato: in attesa, approvata, rifiutata. |
| F6 | Il diff è affiancato (prima e dopo), con i pulsanti Approva e Rifiuta per ogni file e Approva tutte. |
| F7 | Se rifiuti, l'app ripristina la versione precedente del file e lo comunica alla sessione di Claude. |
| F8 | Oltre ad Approva e Rifiuta c'è **Richiedi modifiche**: aggiungi accortezze (cosa fare o a cosa stare attento) e divieti (cosa non fare), anche riferiti a righe precise del diff. Le indicazioni arrivano a Claude come un tuo messaggio nella sessione; quando Claude riscrive il file, la modifica torna da rivedere e puoi di nuovo approvare, rifiutare o chiedere altre modifiche. Il diff si può confrontare con l'originale o con la versione al momento dell'ultima richiesta, e lo storico delle richieste resta visibile. |
| F9 | **Revisione obbligatoria**: le fasi sono stesura → thinking → revisione. Quando Claude si ferma e la sessione ha modifiche ancora aperte (da rivedere o con modifiche richieste), la casella di input, il terminale e i prompt predefiniti sono disabilitati finché ognuna non è approvata o rifiutata. Mentre Claude lavora o aspetta un permesso l'input resta libero (per rispondere e interrompere); i messaggi di «Richiedi modifiche» passano sempre. Senza modifiche aperte non c'è blocco. |
| F10 | **Modalità revisione** nell'editor, per qualsiasi file: selezionando del testo il tasto destro offre (anche nell'anteprima Markdown, senza attivare prima nulla; il comando accende la modalità, che si vede dal pulsante «Revisione» nella barra in basso) **Revisiona…** (note ancorate alle righe, inviate alla sessione Claude del foglio come messaggio) e **Spiega con Haiku**. Vale anche nel Markdown impaginato, sia nell'editor sia nel pannello Modifiche (diff impaginato): le righe si ricavano dai blocchi del sorgente (`data-l`), quindi la nota copre i blocchi toccati dalla selezione. Il messaggio è soggetto alla revisione obbligatoria (F9) e il file deve essere salvato. |
| F11 | **Approvare e rifiutare solo a Claude fermo**: finché la sessione sta eseguendo (lavora o aspetta un permesso) Approva e Rifiuta (anche «sessione» e «tutte») sono disabilitati, e il processo principale li rifiuta. **Le richieste di modifica si possono invece mettere in coda** mentre Claude lavora (dal pannello Modifiche e dalla modalità revisione): arrivano a Claude come messaggi in coda. Se Claude aspetta un permesso, la richiesta è rifiutata (finirebbe come risposta alla domanda). Claude Code non avvisa quando lo si interrompe con Esc e lo stato resta «lavora»: il banner del pannello Modifiche ha «Claude è fermo? Sblocca» per rimettere la sessione a «ferma». |
| F12 | **Menu del tasto destro coerente in tutta l'app**: nei campi di testo Annulla/Ripeti/Taglia/Copia/Incolla/Seleziona tutto; sul testo selezionato (Markdown, vista grafica, spiegazioni) Copia; nel terminale Copia/Incolla/Seleziona tutto/Pulisci; nel Markdown impaginato anche Revisiona… e Spiega con Haiku. I menu restano dentro la finestra, si chiudono con Esc, clic fuori o rotellina, e il focus torna dov'era. |
| F13 | **Scorciatoie come VS Code**: Ctrl+F cerca nel documento (editor di codice con la ricerca di Monaco, Markdown impaginato con una barra propria: evidenzia tutto, Invio / Maiusc+Invio scorrono, Esc chiude); Ctrl+Maiusc+F cerca in tutti i file del progetto (vista «Cerca» nella barra laterale: maiuscole, parola intera, espressione regolare, filtro dei file, clic su un risultato apre il file alla riga; il testo selezionato diventa la ricerca); Ctrl+P va a un file per nome (senza testo mostra i recenti); Ctrl+E elenca i file aperti di recente (si ricordano tra un avvio e l'altro); Ctrl+K resta la palette completa. Dentro un terminale Ctrl+P, Ctrl+E, Ctrl+F e Ctrl+K restano alla shell (sono tasti di bash e Claude Code); Ctrl+Maiusc+F funziona anche lì. |
| F14 | **Barra laterale fissa** (stile VS Code): a sinistra una barra di icone e il pannello della vista scelta, larghezza regolabile e ricordata; fuori dai fogli e dal dock, uguale per tutti. La prima vista è l'**Esplora file** (Ctrl+Maiusc+E per mostrarlo o nasconderlo); segue il foglio attivo. Le viste sono registrate (`registerSidebarView`): i widget installati (pacchetti `.ccwidget` isolati, §7) compariranno come altre icone. Nell'Esplora file ogni file e cartella ha l'icona del suo tipo (tema vscode-icons, licenza MIT, incluso nell'app). |
| F15 | **Java development pack** (`cct.java-dev`, richiede `cct.java`): vista «Esegui e debug» nella barra laterale (Ctrl+Maiusc+D) solo con il pack installato. Riconosce i servizi Java di una cartella (anche più d'uno: Maven, Gradle, Quarkus, Spring Boot) e ne mostra il JDK; i JDK si scaricano da Eclipse Temurin (api.adoptium.net, checksum verificato) o si usano quelli del PC (JAVA_HOME, IntelliJ, Program Files…), con un JDK predefinito generale e uno per servizio. **Run configuration** (Maven, Gradle, Quarkus dev mode, applicazione Java, attach) che si avviano in un terminale dell'app, anche in debug; **importazione** di quelle di IntelliJ IDEA (`.idea/runConfigurations`, `.run`, `workspace.xml`: Application, Maven, Gradle, Remote). **Debugger** con java-debug dentro jdtls (breakpoint nel margine dell'editor e con condizione, stack, variabili, espressioni, passo-passo, riga di sosta). Lombok come agente di jdtls. |
| F16 | **Interfaccia dei plugin dentro il pacchetto** (rimandata): come per le estensioni di VS Code, un plugin installato porta anche la sua interfaccia (pannello nella barra laterale, margine dell'editor, comandi). Decisioni prese (9 novembre 2026): iframe isolato con API a messaggi e permessi nel manifest; il Java development pack sarà il primo plugin convertito, tenendo la vista attuale (nell'app) finché la nuova non funziona. |

## 6a. Plugin di linguaggio

Il supporto ai linguaggi nell'editor (completamento, errori, vai alla definizione) arriva da plugin, come le estensioni di VS Code. L'app parte senza language server: ogni linguaggio si aggiunge importando il suo pacchetto.

| ID | Requisito |
| --- | --- |
| X1 | Un plugin è un pacchetto `.ccplugin` (zip) con un `plugin.json` che dichiara linguaggi ed estensioni dei file, e un **adapter**: il modulo che parla con l'app. |
| X1a | L'app parla con tutti i plugin con una sola interfaccia, generica e stabile: la **CCT Plugin API** ([docs/plugin-api.md](docs/plugin-api.md)). Le differenze tra i language server (avvio, trasporto, impostazioni, notifiche proprie) stanno nell'adapter di ciascun plugin, non nell'app. Un SDK aiuta a scrivere gli adapter per i server LSP. |
| X2 | I plugin si importano solo dall'interno dell'app, come i widget (I1). |
| X3 | Prima di installare vedi cosa fa il plugin: linguaggi, attività che svolgerà, adapter e versione dell'API, file che scaricherà (indirizzo, dimensione, checksum), plugin richiesti e SHA-256 del pacchetto. |
| X4 | I file scaricati all'installazione (runtime, server) vengono verificati con SHA-256 o integrity npm; se non corrispondono l'installazione si annulla. |
| X5 | Un plugin può fornire un runtime agli altri (es. il plugin Java fornisce Java a Maven e Gradle) e dichiarare i plugin che richiede. |
| X6 | Più plugin possono gestire lo stesso file (es. TypeScript e Angular): i risultati si uniscono. |
| X7 | A ogni avvio l'app ricontrolla i file del plugin; se sono cambiati il plugin resta bloccato finché non lo reinstalli. |
| X8 | Una schermata elenca i plugin installati con versione, linguaggi e stato, e permette di attivarli, disattivarli, aggiornarli e disinstallarli. |
| X9 | Se apri un file senza plugin per il suo linguaggio, l'editor lo dice e porta alla schermata dei plugin. |

Plugin preparati nella fase 6a: TypeScript/JavaScript, Python, YAML, Java, Maven (con XML), Gradle, Angular.

## 6b. Progetti, contesti, casella di input e output smart (release 2)

Il progetto tiene insieme pannelli, documentazione e contesti. Il piano, le decisioni e cosa è stato provato sono in [piano-release-2.md](piano-release-2.md).

| ID | Requisito | Fase |
| --- | --- | --- |
| J1 | Un progetto è un file `.cctproj` (JSON versionato) nella radice. Si crea da «Nuovo progetto», si apre da file o cartella e compare nei recenti. | 9 |
| J2 | Il file contiene nome, cartelle di contesto, documentazione globale, contesti e impostazioni predefinite (modello ed effort proposti per le cartelle nuove). | 9 |
| J3, J3a | `CLAUDE.md` si seleziona da solo se presente e segue le modifiche; se manca, un avviso (nel pannello Documentazione e nel menu Progetto) invita a crearlo. L'app non lo crea mai senza una scelta dell'utente. | 10 |
| J4 | Gli altri riferimenti globali si scelgono solo a mano. | 10 |
| J5 | Un progetto ha più contesti, tutti aperti insieme: si creano, modificano, duplicano, riordinano ed eliminano dal selettore in barra o dalla palette. Ogni contesto ha i suoi fogli. | 11 |
| J6 | Ogni contesto ha la sua documentazione, in più di quella globale. | 12 |
| J7 | Esplora file, nuovo terminale, Documentazione e Modifiche seguono il contesto del foglio (cartella d'ambito). Le modifiche si possono limitare alle cartelle del contesto o mostrare tutte. | 11, 12 |
| J8 | Pannello Documentazione con indice delle sezioni, ricerca, link ai file e pulsante «Modifica». Il Markdown si sanifica: niente script, immagini né attributi di evento. | 10 |
| J9 | Le cartelle usate nella 1.0 si aprono come progetti «senza file»: il file si crea solo su richiesta. I fogli della 1.0 restano e il primo contesto li prende. | 9, 11 |
| J10 | Il `.cctproj` ha solo percorsi relativi e nessun dato personale, così si può versionare. | 9 |
| B1–B3 | Sotto ogni terminale Claude c'è una casella di testo multiriga (Invio manda, Maiusc+Invio va a capo, invertibile). Il testo arriva come incolla seguita da Invio. Si disattiva quando Claude aspetta una risposta a un menu o a un permesso e rimanda al terminale, che resta interattivo. | 13 |
| B4 | Cronologia dei messaggi per progetto (frecce) e bozza per vista. | 13 |
| B5, B6 | `@` suggerisce i file della cartella, `/` i comandi di Claude Code; un pulsante inserisce il riferimento a un documento del progetto o al file dell'editor. | 13 |
| O1–O3 | Nelle Modifiche, la vista «Spiegazione» genera, solo a richiesta, una pagina HTML con `claude -p --model haiku` (login dell'utente, nessuno strumento, un solo turno). | 14 |
| O4 | La pagina gira in un iframe isolato (`sandbox="allow-scripts"`, politica CSP senza rete) servito da `app://explain`. | 14 |
| O5, O6 | La spiegazione si salva legata all'hash del diff (riaprirla non consuma token), si può rigenerare e annullare; se fallisce si mostra un riepilogo in testo. | 14 |
| F9 | «Approva tutte» e «Respingi tutte» (anche per sessione) agiscono sulle sole modifiche visibili. Respingere chiede conferma; i file cambiati dopo Claude hanno una seconda conferma. | 14 |
| B8 | Prompt predefiniti (nome e testo), salvati nelle impostazioni dell'app e validi per tutti i progetti: si mandano con un clic dalla palette comandi alla sessione Claude del foglio attivo, e si gestiscono da una finestra. | 13 |
| O8 | L'output smart si può nascondere e riattivare dalla palette. Modello fisso su Haiku. | 14 |

## 7. Widget

> **Rimandato a dopo la 1.0** (decisione del 7 novembre 2026). Questa sezione verrà rivista insieme ai plugin di linguaggio (§6a) prima dello sviluppo. Nella 1.0 il pannello Widget non c'è.

I widget sono moduli scritti in HTML e JavaScript puri, con taglie fisse come i widget della home di iOS o Android. Servono ad aggiungere funzioni nuove senza modificare l'app.

### Taglie e aspetto

| ID | Requisito |
| --- | --- |
| G1 | Taglie fisse su una griglia: 1×1, 2×1, 2×2 e colonna intera. Ogni cella misura 150 px. Il numero di colonne si adatta alla larghezza della zona, con un minimo di 2. |
| G2 | I widget si mettono in zone dedicate dentro i pannelli e si trascinano tra una zona e l'altra. |
| G3 | L'app fornisce un CSS di base già pronto, con colori, font, spaziature e componenti, così ogni widget ha lo stesso aspetto dell'app. I colori sono variabili CSS, quindi i widget seguiranno anche un futuro tema chiaro. |
| G4 | Ogni widget gira in un ambiente isolato (iframe sandbox) e comunica con l'app solo attraverso l'API. |

### API

| ID | Requisito |
| --- | --- |
| A1 | `terminal.send`: scrive prompt o comandi slash nella sessione attiva o in una sessione scelta. Un widget non può creare sessioni nuove: scrive solo in quelle già aperte. |
| A2 | Eventi sulla sessione: output, cambi di stato, richieste di permesso, modifiche ai file. |
| A3 | Accesso ai file del workspace, in lettura e in scrittura, secondo i permessi concessi. |
| A4 | Accesso alla rete solo se dichiarato e concesso. |
| A5 | Ogni widget ha un suo spazio dati per salvare impostazioni e preset. |

### Installazione sicura

| ID | Requisito |
| --- | --- |
| I1 | I widget si importano solo dall'interno dell'app, come pacchetto. Non si installano copiando file in una cartella. |
| I2 | Il pacchetto contiene un manifest che dichiara nome, versione, taglia e permessi richiesti. |
| I3 | Prima di installare, Claude legge il codice e riassume cosa fa il widget e quali permessi usa davvero. |
| I4 | Se il codice usa permessi che il manifest non dichiara, l'app lo segnala in modo evidente e di base non li concede. |
| I5 | Concedi o neghi ogni permesso singolarmente, poi confermi l'installazione. |
| I6 | I widget approvati si salvano in un database SQLite dell'app, insieme all'hash del codice approvato. |
| I7 | A ogni avvio l'app ricontrolla l'hash. Se il codice è cambiato, il widget resta bloccato finché non lo rianalizzi e lo approvi di nuovo. |
| I8 | Una schermata elenca i widget installati, con i loro permessi, e permette di revocarli o disinstallarli. |

## 8. Componenti Animate UI

| Parte dell'app | Componente |
| --- | --- |
| Fogli in basso, scelta di modello ed effort, ambiti dei permessi | Tabs, Toggle Group |
| Interruttori dei permessi | Switch |
| Menu «Invia a…» e menu della sessione | Dropdown Menu, Context Menu |
| Nuovo terminale, Installa widget | Dialog |
| Rifiuta modifica, Revoca permesso | Alert Dialog |
| Notifiche | Toast |
| Albero dei file | Collapsible, Accordion |
| Contesto usato | Progress |
| Output e diff | Code Block |
| Contatori | Counting Number |
| Pannelli agganciabili | non presenti in Animate UI: si usa Dockview |

## 9. Decisioni prese

Chiuse il 6 e il 7 novembre 2026. Ogni decisione è riportata anche nel requisito indicato.

| Domanda | Decisione | Requisito |
| --- | --- | --- |
| Dimensione delle celle dei widget e colonne della griglia | Celle da 150 px; le colonne si adattano alla larghezza della zona, minimo 2. | G1 |
| Un widget può creare sessioni nuove? | No: per ora scrive solo in sessioni già aperte. | A1 |
| Con due viste sulla stessa sessione, chi scrive? | Entrambe: è lo stesso processo e l'input arriva in ordine di battitura. | S3 |
| I layout salvati includono le sessioni? | No, solo la disposizione; i terminali vuoti propongono Nuova, Riprendi o Collega. | L5 |
| Quali linguaggi oltre a Java? | TypeScript/JavaScript, Python, XML, YAML e SQL, con Java come priorità. | F2, F3 |
| Serve un tema chiaro? | Non nella v1; i colori in variabili CSS lo rendono aggiungibile dopo. | §1, G3 |
| Cosa contiene la 1.0? | Fogli, terminali, hook, Modifiche, Permessi, file ed editor, plugin di linguaggio, palette comandi, installer e aggiornamenti. I widget arrivano dopo, con un'analisi rivista. (7 novembre 2026) | §7, L7 |
| Quale shell propone «Nuovo terminale»? | L'ultima usata; la prima volta Git Bash, altrimenti PowerShell. (7 novembre 2026) | S1 |
| La 1.0 si aggiorna da sola? | Sì: le versioni nuove si pubblicano su GitHub Releases, l'app le scarica e le installa alla chiusura o subito su richiesta. (7 novembre 2026) | — |
| I plugin di linguaggio sono inclusi nell'installer? | No: restano file `.ccplugin` distribuiti a parte. (7 novembre 2026) | X2 |
