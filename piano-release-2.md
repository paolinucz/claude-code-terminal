# Release 2 – Progetti e contesti

Versione 1.0 · 7 novembre 2026 · Paolo Coletta · **fasi 9–14 implementate e provate su Electron isolato; da provare a mano e da rilasciare**

## 1. Obiettivo

Oggi i pannelli (Esplora file, editor, terminali, modifiche…) sono scollegati: ognuno conosce solo la propria cartella. La 2 introduce il **progetto** come unità che li tiene insieme, e i **contesti** come aree di lavoro parallele dentro lo stesso progetto. Dentro il progetto l'app rileva `CLAUDE.md` e gli altri documenti di riferimento e li mostra in un pannello dedicato.

## 2. Concetti

| Concetto | Cos'è |
| --- | --- |
| **Progetto** | Un file `.cctproj` che raccoglie tutte le informazioni: cartella radice, cartelle di contesto, documentazione globale, elenco dei contesti. Si apre, si crea e si ricorda come ora si ricorda la cartella. |
| **Documentazione progettuale globale** | Elenco di file Markdown validi per tutto il progetto. `CLAUDE.md` è selezionato in automatico se presente (altrimenti compare un avviso che invita a crearlo). Gli altri file si scelgono solo a mano. |
| **Contesto** | Un'area di lavoro dentro il progetto, con un nome e un proprio ambito: sottocartelle, documentazione contestuale, sessioni e pannelli collegati. Più contesti sono aperti insieme e si gestiscono insieme. |
| **Documentazione progettuale contestuale** | Elenco di file Markdown validi solo per un contesto, che si somma a quella globale. |

## 3. Requisiti proposti

| ID | Requisito |
| --- | --- |
| J1 | Un progetto è descritto da un file `.cctproj` (JSON con numero di versione dello schema). Si crea da «Nuovo progetto», si apre da file o da elenco dei recenti. |
| J2 | Il `.cctproj` contiene: nome, radice, cartelle di contesto (W2), documentazione globale, contesti e impostazioni predefinite (modello, effort, shell). |
| J3 | Per conformità con i progetti Claude Code, se la radice contiene un `CLAUDE.md` l'app lo seleziona da sola come documento della documentazione globale. Il rilevamento segue le modifiche del file. |
| J3a | Se `CLAUDE.md` manca, l'app mostra un avviso (nel pannello Documentazione e nelle impostazioni del progetto) che invita l'utente a crearlo, con un pulsante per crearne uno di partenza. L'app non lo crea mai senza una scelta dell'utente. |
| J4 | Tutti gli altri riferimenti globali di progetto (altri file Markdown) sono scelti **solo a mano** dall'utente dalle impostazioni del progetto: l'app non li aggiunge mai da sola. Si possono aggiungere, togliere e riordinare. |
| J5 | Un progetto ha uno o più contesti, tutti attivi insieme. Si creano, rinominano, riordinano, chiudono e duplicano. |
| J6 | Ogni contesto ha la sua documentazione contestuale, aggiunta a quella globale. |
| J7 | Ogni pannello appartiene a un contesto: Esplora file, editor, modifiche, problemi e terminali mostrano e usano solo ciò che riguarda quel contesto (cartelle, file, sessioni). |
| J8 | Un pannello **Documentazione** mostra i Markdown del contesto attivo (globali + contestuali) in forma strutturata: indice delle sezioni, ricerca, collegamenti ai file citati che si aprono nell'editor. |
| J9 | I progetti già usati nella 1.0 (cartelle ricordate) diventano progetti senza perdere fogli, layout e sessioni. |
| J10 | Il `.cctproj` si può salvare nel repository e condividere: non contiene percorsi assoluti né dati personali (quelli restano nei dati utente). |

## 3b. Casella di input (bridge)

Oggi quello che scrivi arriva grezzo al terminale di Claude Code. La casella di input sta **sotto il terminale** di una sessione Claude e invia il testo allo stesso processo. Il terminale resta interattivo: menu, richieste di permesso, Esc e Ctrl+C funzionano come ora.

| ID | Requisito |
| --- | --- |
| B1 | Ogni terminale Claude ha una casella di testo multiriga agganciata sotto. Invio manda, Maiusc+Invio va a capo (invertibile nelle impostazioni). Le shell semplici non l'hanno. |
| B2 | Il testo arriva al processo come incolla (bracketed paste) seguita da Invio, così più righe restano un solo messaggio. Da verificare con la versione di Claude Code installata. |
| B3 | Quando la sessione aspetta una risposta a un menu o a un permesso (stato S6) la casella si disattiva e rimanda al terminale, per non mandare testo al posto sbagliato. |
| B4 | Cronologia dei messaggi inviati, per progetto, richiamabile con le frecce. Bozza salvata per ogni sessione. |
| B5 | `@` apre i file del progetto (stesso indice della palette comandi); `/` elenca i comandi di Claude Code. |
| B6 | Dalla casella si inserisce un riferimento a un documento del progetto (J8) o al file aperto nell'editor. |
| B7 | Più viste collegate alla stessa sessione (S3) condividono lo stato della casella solo nella vista in cui si scrive. |

## 3c. Output smart

La spiegazione delle modifiche di Claude, generata dal modello più economico e mostrata come pagina HTML con stile e animazioni, più chiara del diff grezzo.

| ID | Requisito |
| --- | --- |
| O1 | Nel pannello Modifiche, su ogni modifica o gruppo, un pulsante «Spiega». La spiegazione si genera **solo a richiesta**, mai in automatico. |
| O2 | La generazione lancia l'eseguibile ufficiale `claude -p --model haiku`, con il login già attivo dell'utente. L'app non legge, non salva e non inoltra token o credenziali. Niente `--bare`. |
| O3 | Il modello riceve il diff e il contesto minimo e restituisce un solo documento HTML con CSS e JavaScript incorporati. Gli si impedisce di usare strumenti e di leggere il progetto (nessun tool, un solo turno, cartella di lavoro temporanea). |
| O4 | La pagina si mostra in un iframe isolato: `sandbox="allow-scripts"` senza `allow-same-origin`, CSP che vieta rete, frame e risorse esterne. Il codice generato non vede l'app né i file. |
| O5 | Il risultato si salva nel database legato all'hash del diff, quindi riaprirlo non consuma token. Pulsante «Rigenera». |
| O6 | Si mostra il progresso, si può annullare, e se la generazione fallisce o l'HTML non è valido si ricade su un riepilogo in testo semplice. |
| O7 | La pagina usa i colori del tema scuro dell'app (variabili CSS passate nel prompt) e rispetta una dimensione massima. |
| O8 | Nelle impostazioni: modello usato (predefinito Haiku), interruttore per spegnere la funzione. Possibile alternativa futura con chiave API, non nella prima versione. |

## 4. Rapporto con i fogli

Oggi il foglio è l'area di lavoro (L1). Con i contesti serve chiarire il rapporto. **Ipotesi di lavoro**: il contesto prende il posto del foglio come unità di lavoro. Il foglio resta il modo di disporre i pannelli, e ogni contesto ha i suoi fogli. Le schede in basso mostrano i fogli del contesto attivo; un selettore di contesti sta nella barra in alto.

## 5. Impatto sul codice (stima)

- `src/shared/project.ts` (nuovo): tipi di `Project`, `Context`, `DocRef` e validazione dello schema.
- `src/main/projects/` (nuovo): lettura e scrittura del `.cctproj`, migrazione dalla 1.0, osservazione di `CLAUDE.md` con `fs.watch`.
- `src/main/db.ts`: tabelle per progetti recenti e per l'associazione foglio → contesto. Migrazione dello schema SQLite che parta dai dati della 1.0.
- `src/renderer/src/state/`: store `project` e `context`. Attenzione alla regola dei selettori Zustand (riferimenti stabili).
- `workspace/`: selettore di contesti, creazione progetto, impostazioni del progetto.
- `panels/kinds.ts`: nuovo pannello `docs`; Esplora file, editor e terminali ricevono il contesto come parametro.
- Le quattro parti per ogni funzione IPC: handler, `AppApi`, preload, `lib/api.ts` finto.

## 6. Fasi proposte

| Fase | Contenuto | Requisiti |
| --- | --- | --- |
| 9 | Modello del progetto: `.cctproj`, creazione/apertura, recenti, migrazione dalla 1.0 | J1, J2, J9, J10 |
| 10 | Documentazione: rilevamento di `CLAUDE.md` con avviso se manca, scelta a mano degli altri riferimenti, pannello Documentazione | J3, J3a, J4, J8 |
| 11 | Contesti: modello, selettore, più contesti insieme, rapporto con i fogli | J5, J7 |
| 12 | Documentazione contestuale e collegamento completo dei pannelli al contesto | J6, J7 |
| 13 | Casella di input affiancata al terminale | B1–B7 |
| 14 | Output smart: «Spiega» con `claude -p`, iframe isolato, cache | O1–O8 |

Le fasi 13 e 14 non dipendono dai contesti: si possono fare prima della 10–12 se preferisci. La 14 dipende solo dal pannello Modifiche, che esiste già. B6 richiede la 10.

Ogni fase esce come aggiornamento intermedio (2.0 alpha, poi 2.0 al termine della fase 12) e passa da typecheck, build e prova su copia isolata di Electron con dati di prova.

## 7. Decisioni

Tutte prese. Dove l'utente non ha scelto, si è seguita la proposta del piano (7 novembre 2026).

- [x] **Dove sta il `.cctproj`**: nella radice del progetto, condivisibile nel repository. Le parti personali (progetto attivo, contesto attivo, recenti, cronologia dei messaggi) restano nei dati dell'app.
- [x] **Cos'è un contesto**: un raggruppamento logico (cartella d'ambito, documenti, fogli, modifiche). L'ambiente isolato (git worktree o branch propri) resta un'estensione possibile.
- [x] **Documentazione e Claude Code**: i documenti aggiuntivi si mostrano solo nell'app. Claude Code legge già `CLAUDE.md` da solo. L'opzione «includi nella sessione» per documento resta futura.
- [x] **Una sola radice per progetto**, più le cartelle aggiuntive (`contextDirs`, come `--add-dir`).
- [x] **Pannello Documentazione**: lettura con indice e ricerca; «Modifica» apre il file nell'editor.
- [x] **Widget (fase 7)**: restano rimandati dopo la 2.
- [x] **Casella di input**: affianca il terminale, non lo sostituisce.
- [x] **Modello dell'output smart**: `claude -p --model haiku` con il login dell'utente; i termini di Claude Code lo ammettono per l'uso personale e senza gestire credenziali, da rileggere se l'app verrà distribuita come prodotto.
- [x] **Spiegazione smart**: a richiesta.
- [x] **Flag di `claude -p`** (verificati con Claude Code 2.1.319): `--tools ""` (nessuno strumento, quindi un solo turno; non esiste `--max-turns`), `--no-session-persistence`, `--disable-slash-commands`, `--strict-mcp-config`, `--setting-sources project` (niente impostazioni né hook dell'utente), `--output-format json`, `--system-prompt`. Testo in ingresso da stdin. Costo misurato: circa 0,0005–0,001 $ per spiegazione.
- [x] **Invio multiriga al terminale** (B2): incolla con bracketed paste e poi Invio, lo stesso formato delle richieste di modifica (F8). Provato con Claude Code 2.1.319: due righe arrivano come un solo messaggio.

## 8. Cosa c'è e cosa manca rispetto al piano

- **O8** (impostazioni dell'output smart): c'è l'interruttore (pulsante «Nascondi la funzione» e comando della palette). Il modello è fisso su Haiku: la scelta del modello e la chiave API restano futuri.
- **B4**: cronologia per progetto (cartella della sessione) con le frecce, bozza per vista. **B7**: la bozza è per vista del terminale.
- **J7**: Esplora file, nuovo terminale, Documentazione e Modifiche seguono il contesto del foglio. L'editor apre i file dove li apri; i Problemi mostrano tutti i language server.
- **Fogli e contesti**: ogni contesto ha i suoi fogli (Sviluppo, Revisione, Debug alla creazione). Il primo contesto di un progetto prende i fogli già aperti. «Elimina contesto» chiude i suoi fogli, le sessioni restano attive.
- **Provato su Electron isolato** (`CCT_USER_DATA` separato, pilotato via Chrome DevTools Protocol, con una sessione Claude vera su Haiku): progetto, documentazione (con Markdown ostile), contesti, filtro delle modifiche, «Spiega» (iframe, CSP, 404, cache, costo) e casella di input (invio, più righe, cronologia, `@`, `/`). Non provato: l'uso a mano dell'interfaccia, l'installer e l'aggiornamento dalla 1.0.
- **Aggiunte dopo l'uso**: «Approva tutte» e «Respingi tutte» (F9) e i prompt predefiniti nella palette (B8). I prompt sono globali, non nel `.cctproj`: averli per progetto, condivisibili nel repository, è un'estensione possibile.
