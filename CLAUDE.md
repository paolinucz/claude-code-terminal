# Claude Code Terminal

App desktop per Windows (Electron + React + Dockview) che riunisce i terminali di Claude Code, le shell, i file, l'editor e la revisione delle modifiche. Autore: Paolo Coletta.

Documenti di riferimento (da leggere prima di cambiamenti grossi):
- [requisiti-claude-code-terminal.md](requisiti-claude-code-terminal.md): requisiti con ID (L1, S3, F4, X2…) e decisioni prese (§9).
- [stack-tecnico.md](stack-tecnico.md): architettura, fasi di sviluppo (§5), rischi e decisioni aperte (§7).
- [docs/plugin-api.md](docs/plugin-api.md): CCT Plugin API v1 per i plugin di linguaggio.
- [README.md](README.md): stato per fase, comandi, installer e aggiornamenti.

## Stato

- Fasi 1–6a e fase 8 completate: questa è la base della **1.0**.
- **Fase 7 (widget) rimandata** a dopo la 1.0: l'analisi di widget e plugin va rivista con l'utente prima di scrivere codice. Il pannello `widgets` esiste ancora in `panels/kinds.ts` ma è `hidden: true`.
- Da fare prima della prima release: account e repository GitHub in `build.publish` di `package.json` (per gli aggiornamenti), versione a `1.0.0`, icona dell'app.
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
    updater.ts     aggiornamenti automatici (electron-updater)
  preload/       window.api (tipizzata da AppApi)
  shared/        tipi condivisi tra main, preload e interfaccia
  renderer/src/  interfaccia React
    workspace/     barra in alto, palette comandi, fogli, Dockview, layout
    panels/        tipi di pannello (kinds.ts), PanelHost, PanelErrorBoundary
    terminal/ files/ changes/ permissions/ plugins/   contenuto dei pannelli
    state/         store Zustand
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

## Come provare

- Typecheck e build sempre.
- Prove end-to-end su una **copia isolata** di Electron: `node_modules\electron\dist\electron.exe <progetto> --remote-debugging-port=<porta>` con `CCT_USER_DATA=<cartella di prova>` (dati separati da quelli dell'utente) e `ELECTRON_RENDERER_URL` vuota. Si pilota l'interfaccia via Chrome DevTools Protocol (`Runtime.evaluate`, `Input.dispatchKeyEvent`) e si chiude il processo alla fine.
- Script e cartelle di prova vanno nello scratchpad della sessione, non nel repository.
- Aggiornamenti dai sorgenti: `CCT_UPDATE_DEV_CONFIG=<file yml>` con `provider: generic` e un server locale con `latest.yml`; usa un `updaterCacheDirName` di prova e cancellalo dopo.
- App impacchettata: `dist\win-unpacked\Claude Code Terminal.exe` (senza installare).
