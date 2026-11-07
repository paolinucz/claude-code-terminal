# Claude Code Terminal – Requisiti funzionali

Versione 0.3 · 6 novembre 2026 · Paolo Coletta

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

## 7. Widget

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

Chiuse il 6 novembre 2026. Ogni decisione è riportata anche nel requisito indicato.

| Domanda | Decisione | Requisito |
| --- | --- | --- |
| Dimensione delle celle dei widget e colonne della griglia | Celle da 150 px; le colonne si adattano alla larghezza della zona, minimo 2. | G1 |
| Un widget può creare sessioni nuove? | No: per ora scrive solo in sessioni già aperte. | A1 |
| Con due viste sulla stessa sessione, chi scrive? | Entrambe: è lo stesso processo e l'input arriva in ordine di battitura. | S3 |
| I layout salvati includono le sessioni? | No, solo la disposizione; i terminali vuoti propongono Nuova, Riprendi o Collega. | L5 |
| Quali linguaggi oltre a Java? | TypeScript/JavaScript, Python, XML, YAML e SQL, con Java come priorità. | F2, F3 |
| Serve un tema chiaro? | Non nella v1; i colori in variabili CSS lo rendono aggiungibile dopo. | §1, G3 |
