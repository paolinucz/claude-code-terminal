# Claude Code Terminal – Proposta di stack tecnico

Versione 0.3 · 6 novembre 2026 · approvata (interfaccia in React) · aggiornata dopo la fase 1

Versioni usate nella fase 1: Electron 45, electron-vite 6, Vite 8, React 19, TypeScript 7, Tailwind 4, Dockview 8, Animate UI 2.4 (`@animate-ui/react`), Node.js 26 LTS.

Riferimento: [requisiti-claude-code-terminal.md](requisiti-claude-code-terminal.md) v0.2. Gli ID tra parentesi (S3, F4…) sono quelli dei requisiti.

## 1. In sintesi

| Livello | Scelta |
| --- | --- |
| Contenitore desktop | **Electron** |
| Linguaggio | TypeScript ovunque |
| Interfaccia | React + Vite + Zustand, **Animate UI** (basato su shadcn/ui, Radix e Motion) + Tailwind |
| Pannelli agganciabili | **Dockview** 8 (`dockview-react`) |
| Terminali | **xterm.js** nella vista + **node-pty** (ConPTY) nel processo principale + `@xterm/headless` per lo stato delle sessioni |
| Editor e diff | **Monaco** + `monaco-languageclient` |
| Language server | jdtls (Java), typescript-language-server, basedpyright (Python), LemMinX (XML), yaml-language-server, sqls (SQL) |
| Integrazione con Claude Code | hook e status line passati con `--settings`, lettura dei file di sessione in `~/.claude/projects` |
| Dati dell'app | **SQLite** con il modulo `node:sqlite` integrato in Electron + cartella di snapshot dei file |
| Osservazione dei file | chokidar |
| Widget | iframe sandbox su protocollo `ccwidget://`, API via `MessageChannel` |
| Build e distribuzione | electron-vite + electron-builder (installer NSIS), electron-rebuild per i moduli nativi |
| Test | Vitest, Playwright per Electron |

## 2. Perché Electron e non Tauri

Tauri dà un installer più piccolo e consuma meno memoria, ma qui pesano di più tre cose:

- **Terminali veri.** xterm.js + node-pty è la combinazione usata da VS Code, collaudata su Windows con ConPTY. In Tauri il PTY va gestito in Rust (portable-pty) con un ponte verso la WebView.
- **Editor e LSP.** Monaco, monaco-languageclient e i language server su stdio sono tutti nell'ecosistema Node.
- **Una sola lingua.** Tutto in TypeScript, compresa l'API dei widget e il gestore delle sessioni.

Il costo da accettare è circa 150–250 MB di RAM in più e un installer da ~100 MB. Per un'app che resta aperta tutto il giorno al posto di terminale + IDE, è un compromesso ragionevole.

## 3. Architettura

```
┌──────────────────── Processo principale (Node) ────────────────────┐
│ SessionManager   PTY (node-pty) + terminale headless per sessione  │
│ HookServer       named pipe locale, riceve gli eventi degli hook   │
│ ChangeTracker    snapshot prima/dopo, stato approvata/rifiutata    │
│ SettingsService  legge/scrive/osserva i settings*.json             │
│ LspHost          avvia i language server, ponte stdio ↔ finestre   │
│ WidgetHost       pacchetti, manifest, hash, permessi, SQLite       │
└───────────────▲─────────────────────────────▲──────────────────────┘
                │ IPC (MessagePort)           │
   ┌────────────┴──────────┐      ┌───────────┴───────────┐
   │ Finestra principale   │      │ Finestre staccate     │
   │ React + Dockview      │      │ (popout Dockview)     │
   │ viste xterm, Monaco,  │      │ stesse viste,         │
   │ iframe dei widget     │      │ stessi store          │
   └───────────────────────┘      └───────────────────────┘
```

Le sessioni vivono nel processo principale, le finestre contengono solo viste. Così chiudere, spostare o staccare un pannello non tocca mai il processo (§3 dei requisiti).

## 4. Come si coprono i requisiti più delicati

### Sessioni e terminali

- **Viste multiple sulla stessa sessione (S3).** Ogni sessione ha un PTY e un terminale headless che tiene lo stato dello schermo. Quando si apre una vista nuova, lo stato viene serializzato (addon `serialize`) e poi l'output viene inviato a tutte le viste. L'input di tutte le viste va allo stesso PTY, come deciso.
- **Dimensione del terminale con più viste.** Un PTY ha una sola dimensione. Proposta: comanda la vista che ha il focus, come fa tmux; le altre adattano la scala o mostrano barre di scorrimento. *Da confermare.*
- **«Invia a…» e trascinamento (S4, S5).** Si sposta solo la vista nel layout Dockview; la sessione non cambia.
- **Stato e notifiche (S6, S7).** Hook `Notification` (richiesta di permesso, attesa di input) e `Stop` (risposta finita), più l'attività del PTY. Notifiche native di Windows tramite `Notification` di Electron e toast nell'app.
- **Riprendi (S2, S8).** Elenco dai file di sessione in `~/.claude/projects/<progetto>/`, poi `claude --resume <id>`.

### Workspace e barra di stato

- **Avvio (W1–W3).** `claude --model … --add-dir …`. Per cambiare modello o effort a sessione aperta l'app scrive il comando slash corrispondente nel PTY.
- **Barra di stato (W5).** La status line di Claude Code viene configurata con `--settings`. Il comando riceve in JSON i dati della sessione (modello, contesto) e li manda all'app; il branch git lo legge l'app.
- **Preferenze per progetto (W4).** In SQLite.

### Integrazione senza toccare i file dell'utente

Hook e status line arrivano a Claude Code con il flag `--settings` all'avvio di ogni sessione, non scritti nei `settings.json` dell'utente o del progetto. Lo script di hook è un piccolo eseguibile Node incluso nell'app, che inoltra l'evento al processo principale tramite named pipe.

### Permessi (P1–P6)

- Lettura e scrittura diretta dei tre file, con validazione dello schema prima di salvare e anteprima del JSON (P5).
- chokidar osserva i file. Una modifica esterna o un «Sì, e ricorda» nel terminale (P3) ricarica l'elenco e mostra il diff (P6).
- Si riscrive solo la sezione `permissions`, conservando il resto del file com'è.

### Modifiche di Claude (F4–F7)

- **Prima della modifica.** Hook `PreToolUse` su Edit, Write, MultiEdit e NotebookEdit: il ChangeTracker salva una copia del file (snapshot indirizzato per hash).
- **Dopo la modifica.** Hook `PostToolUse`: la modifica entra nel pannello come «in attesa».
- **Diff (F6).** DiffEditor di Monaco affiancato, lo stesso usato per l'editor.
- **Rifiuto (F7).** Ripristino dello snapshot. La notifica alla sessione passa dall'hook `UserPromptSubmit`: al prompt successivo viene aggiunto un contesto del tipo «l'utente ha rifiutato la modifica a X, il file è stato ripristinato». Così non si scrive nel terminale mentre Claude lavora.
- Nota: la modifica è già su disco quando arriva nel pannello. «Approva» la conferma, «Rifiuta» la annulla.

### Editor e language server (F1–F3)

- Monaco + monaco-languageclient. Il processo principale avvia i server e collega stdio alle finestre tramite IPC.
- **jdtls richiede un JDK 21+.** L'app lo cerca nel sistema e, se manca, propone di scaricarne uno (scelta da fare: incluso nell'installer o scaricato al primo uso).
- I server partono solo quando apri un file di quel linguaggio, per contenere memoria e tempi d'avvio.
- Il pannello Problemi (F3) unisce i `publishDiagnostics` di tutti i server.

### Widget (G1–G4, A1–A5, I1–I8)

- **Isolamento.** iframe con `sandbox="allow-scripts"` senza `allow-same-origin`, servito da un protocollo personalizzato `ccwidget://<id>/` con una CSP rigida: niente rete diretta, `connect-src 'none'`.
- **API.** SDK JavaScript leggero sopra `MessageChannel`. Ogni chiamata viene controllata nel processo principale contro i permessi concessi.
- **Rete (A4).** Solo tramite `api.fetch`, che fa da proxy verso i domini dichiarati e concessi.
- **Pacchetto (I1, I2).** File `.ccwidget` (zip) con `manifest.json`.
- **Analisi (I3, I4).** Due livelli:
  1. **analisi statica deterministica**, che cerca nel codice le chiamate all'API e i tentativi di rete (`fetch`, `XMLHttpRequest`, `WebSocket`, `import()` remoti);
  2. **riepilogo di Claude**, con `claude -p` in modalità headless e output JSON.

  La differenza tra permessi dichiarati e usati la calcola l'analisi statica, non il modello: è quella che decide cosa viene bloccato.
- **Hash (I6, I7).** SHA-256 dell'intero pacchetto, salvato in SQLite e ricontrollato a ogni avvio.
- **CSS di base (G3).** Le stesse variabili CSS del tema dell'app, iniettate in ogni widget.

## 5. Ordine di sviluppo proposto

| Fase | Contenuto | Requisiti |
| --- | --- | --- |
| 1 | Scheletro Electron + React + Dockview, fogli, salvataggio del layout | L1–L5 |
| 2 | SessionManager, terminale Claude e shell, viste multiple, «Invia a…» | S1–S9, W1–W5 |
| 3 | Hook e named pipe, stato delle sessioni, notifiche | S6, S7 |
| 4 | Pannello Modifiche e diff | F4–F7 |
| 5 | Schermata Permessi | P1–P6 |
| 6 | Esplora file, editor Monaco, jdtls, poi gli altri language server | F1–F3 |
| 7 | Widget: runtime, API, installazione sicura | G, A, I |
| 8 | Palette comandi, rifiniture, installer | L7 |

Le fasi 1–3 danno già un'app usabile tutti i giorni come terminale per Claude Code.

## 6. Rischi da verificare subito

| Rischio | Come verificarlo |
| --- | --- |
| ~~Popout di Dockview dentro Electron~~ | **Risolto nella fase 1.** Dockview 8 rifiuta le finestre staccate da `file://`: l'interfaccia è servita da un protocollo `app://` e le finestre si aprono con `setWindowOpenHandler`. Verificato anche il ripristino al riavvio. |
| ~~Moduli nativi da compilare (node-pty)~~ | **Risolto nella fase 2.** node-pty 1.1 include binari precompilati per Windows che funzionano in Electron 45 senza compilare. SQLite usa `node:sqlite` integrato. Nell'installer node-pty resta fuori dall'archivio asar (`asarUnpack`). |
| Dimensione del PTY con più viste | Prototipo nella fase 2 |
| Dati esposti dalla status line e dagli hook di Claude Code, che possono cambiare tra versioni | Fissare una versione minima di Claude Code e testarla a ogni aggiornamento |
| Peso di jdtls (RAM, avvio, JDK) | Misurare su un progetto Maven reale |

## 7. Decisioni ancora da prendere

- [x] Dimensione del terminale con più viste: comanda la vista con il focus o che ha scritto per ultima; le altre si adeguano (fase 2).
- [ ] JDK per jdtls: incluso nell'installer o scaricato al primo uso?
- [ ] Shell predefinita per i nuovi terminali.
- [ ] Aggiornamenti automatici dell'app sin dalla v1?
