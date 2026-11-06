# Claude Code Terminal

App desktop per Windows che riunisce in una finestra i terminali di Claude Code, le shell, i file, la revisione delle modifiche e i widget.

- Requisiti funzionali: [requisiti-claude-code-terminal.md](requisiti-claude-code-terminal.md)
- Stack tecnico e fasi: [stack-tecnico.md](stack-tecnico.md)

## Stato

**Fase 1 completata**: scheletro Electron + React + Dockview, fogli (L1), pannelli agganciabili, fluttuanti e in finestre separate (L2–L4), salvataggio automatico e layout con nome (L5). I pannelli sono ancora segnaposto: i contenuti arrivano nelle fasi successive.

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
| `npm run dist` | Crea l'installer Windows in `dist/` |

## Struttura

```
src/
  main/       processo principale: finestre, protocollo app://, database SQLite
  preload/    ponte sicuro tra interfaccia e processo principale (window.api)
  shared/     tipi condivisi
  renderer/   interfaccia React
    src/components/  componenti di base (Animate UI con il tema dell'app)
    src/workspace/   barra superiore, fogli, Dockview, layout
    src/panels/      tipi di pannello
    src/state/       store Zustand
```

I dati dell'app stanno in `%APPDATA%\Claude Code Terminal\claude-code-terminal.db`.

Scorciatoie: **F12** apre gli strumenti di sviluppo, **Ctrl+K** porta alla palette comandi (la ricerca arriva nella fase 8), **doppio clic** o **F2** su un foglio per rinominarlo.
