# Design di Magnolia: Magnolia Prism

**Magnolia Prism** è il linguaggio grafico dell'app: vetro che rifrange la luce di uno sfondo wireframe, tutto nei toni dell'accento. Questo documento è la fonte per token e regole dell'interfaccia: i colori e le misure si usano dai token, non scritti a mano nei componenti.

## Colore

| Token | Valore | Uso |
| --- | --- | --- |
| `--cct-accent` | `#1E9AA5` (ottanio) | Accento predefinito: pulsanti principali, selezioni, cursore, linee dello sfondo animato. L'utente lo può cambiare da **Aspetto**. |
| `--cct-on-accent` | `#021A1D` | Testo sopra l'accento predefinito (con altri accenti si sceglie per contrasto). |
| `--cct-accent-soft` | `#5CC8D1` | Link e tinta chiara dell'accento predefinito. |
| `--mg-void` | `#000000` | Fondo dell'app: nero puro, sotto c'è solo lo sfondo animato. |
| `--cct-bg` / `--cct-surface` / `--cct-surface-2` | `#09090B` / `#18181B` / `#1F1F23` | Fondi opachi dei componenti interni (campi, schede). |
| `--cct-ok` `--cct-warn` `--cct-danger` `--cct-info` | `#6FD39B` `#F5C46B` `#FF8A8A` `#6EA8FE` | Stati. |

Il vecchio accento ember (`#E8875F`) resta solo come scelta facoltativa («Arancio») in Aspetto. Chi aveva ancora l'ottanio precedente (`#168294`) passa al nuovo predefinito al primo avvio.

## Vetro

Superfici semitrasparenti con sfocatura sopra lo sfondo animato. Un'unica famiglia di classi in `styles.css` (`@layer components`): `.mg-glass-1`, `.mg-glass-2`, `.mg-glass-3`, `.mg-glass-solid`.

| Livello | Token fondo | Sfocatura | Dove |
| --- | --- | --- | --- |
| 1 | `--mg-glass-1` `rgba(10,10,12,.34)` | `--mg-blur-1` `blur(40px) saturate(190%)` | barra in alto |
| 2 | `--mg-glass-2` `rgba(18,18,21,.32)` | `--mg-blur-2` `blur(36px) saturate(200%)` | pannelli laterali, barra plugin |
| 3 | `--mg-glass-3` `rgba(24,24,27,.42)` | `--mg-blur-3` `blur(28px) saturate(190%)` | menu, popover, tooltip, dialog, card della panoramica |
| content | `--mg-glass-content` `rgba(9,9,11,.58)` | `--mg-blur-content` `blur(22px) saturate(170%)` | **ogni gruppo di pannelli di Dockview** (terminale, editor, diff, conversazione, Modifiche…): `.dv-groupview` e `.mg-glass-content` |
| solid | `--mg-glass-solid` `rgba(9,9,11,.80)` | nessuna | solo dove serve un fondo quasi opaco (riquadri dell'alveare) |

Bordo `--mg-glass-border` (`rgba(255,255,255,.14)`), luce interna e ombra `--mg-glass-highlight`, e una velatura `--mg-glass-sheen`: riflesso diagonale chiaro più una punta (7 %) dell'accento, così il vetro cambia tinta insieme all'accento.

Regole:
- `backdrop-filter` solo sui contenitori (barra, pannelli, menu, dialog, overlay), mai su righe, pulsanti o elementi ripetuti.
- Terminale, editor e diff **non hanno un fondo proprio**: lo dà il gruppo di Dockview (livello *content*). xterm e Monaco sono trasparenti (`#00000000`, e `.xterm-viewport` forzato a `transparent` in `styles.css`, perché xterm gli dà `#000`). La leggibilità è garantita dal fondo scuro (58 %) e dalla sfocatura forte, che rende morbide le linee dello sfondo sotto il testo.
- Le barre dentro un pannello (strumenti, stato, input del terminale, barre dell'editor e del diff) usano `.mg-bar` (`--mg-bar`, un velo chiaro al 4,5 %), non `bg-surface`. I tab di Dockview sono veli bianchi (8 % attivo, 4 % gruppo inattivo, trasparenti gli altri).
- Menu, dropdown, dialog, tooltip e popover prendono il vetro **da `ui-kit.tsx`** (`menuContentClass`, `modalClass`…), mai da stili locali.
- I contenuti dei pannelli non devono avere un fondo opaco proprio (`bg-surface` sulla radice), altrimenti coprono il vetro.
- Fallback: senza `backdrop-filter`, o con **Aspetto → Effetto vetro** spento (`html[data-glass="off"]`), le stesse classi usano fondi opachi (`--mg-opaque-1…solid`: `#18181B`, `#27272A`, `#09090B`).

## Sfondo animato

Componente `AppBackground` (`components/AppBackground.tsx`), un solo livello decorativo sotto tutta l'interfaccia (`pointer-events: none`, `aria-hidden`), su nero `#000`:

1. **Pavimento a griglia** in prospettiva (`perspective(700px) rotateX(64deg)`), linee dell'accento (38 %) ogni 56 px, sfumato verso l'orizzonte con una maschera. Scorre in avanti con un ciclo di 7 s.
2. **Alone radiale** dell'accento che pulsa in 9 s.
3. **Sfera wireframe**: cerchi (colore e impulsi dall'accento, `--mg-bg-line` / `--mg-bg-pulse`) ed ellissi sottili che ruotano in 90 s, con brevi impulsi di luce lungo le orbite (`stroke-dasharray` + `stroke-dashoffset`).

Prestazioni e accessibilità:
- Si animano solo `transform`, `opacity` e `stroke-dashoffset`. Il pavimento scorre con un `translateY` dentro un contenitore già in prospettiva (resta sul compositor).
- Pausa (`data-motion="paused"`) quando la finestra perde il focus o è nascosta, a batteria (`powerMonitor` di Electron, canale `power:changed`) e con `prefers-reduced-motion`.
- **Aspetto → Sfondo animato**: Sempre (predefinito) / Solo quando inattivo (si muove solo dopo 30 s senza input) / Mai.
- Verificato su una copia isolata di Electron con output intenso nel terminale (400.000 righe): 60 fps con 0 frame oltre i 33 ms, con e senza sfondo e vetro.

## Spazi

Gli spazi (ex «fogli») stanno nella barra in alto, tra il menu Progetto e i pulsanti di azione: `Progetto · | · chip · + · area vuota trascinabile · azioni · controlli finestra`.

- **Chip**: alto 32 px, icona quadrata da 20 px nel colore dello spazio, nome, badge. Attivo: fondo `--mg-chip-active-bg` (`rgba(255,255,255,.10)`), bordo `--mg-chip-active-border` (`.16`), testo semibold. Inattivi: trasparenti. Diversi dalle schede dei pannelli, che restano con la sottolineatura.
- **Colore**: palette fissa di 6 colori smorzati (`SPACE_COLORS` in `shared/spaces.ts`): `#8B93E8 #D9A35E #7FB89A #C98BB9 #6FA8C9 #B5A28A`. Non include l'ottanio (è l'accento dell'app). **Icona**: una lettera o un simbolo; predefinita l'iniziale del nome.
- **Badge** (il caso più urgente vince): giallo `--mg-badge-waiting` `#F5C46B` con alone e pulsazione lenta = almeno una sessione attende input o un permesso; blu `--mg-badge-working` `#6EA8FE` = almeno una sessione di Claude sta lavorando; nessun badge = tutte inattive. Ha sempre un `aria-label` testuale: lo stato non è solo nel colore.
- **Suggerimento**: nome, numero di sessioni e stato di ciascuna.
- **Menu** (tasto destro, o clic sullo spazio già attivo): Rinomina (F2), Scegli icona e colore, Duplica layout, Apri in una nuova finestra, Chiudi spazio (rosso, con il numero di sessioni; conferma se ce ne sono di attive).
- **Compattazione**: oltre 6 spazi, o quando la larghezza non basta, i chip inattivi mostrano solo l'icona e compare `▾` con l'elenco completo.
- **Trascinamento della finestra**: l'area vuota della barra è `app-drag`; chip, pulsanti e menu sono `app-no-drag`; tra l'ultimo chip e i pulsanti restano sempre almeno 48 px liberi.
- **Tastiera**: `Ctrl+1…9` apre lo spazio n; `Ctrl+Tab` apre la **panoramica** (card in vetro con nome, badge, miniatura del layout e sessioni; clic apre, `Esc` chiude); `F1…F9` come prima.
- **Spostare una sessione**: trascinare una scheda di sessione su un chip, o una riga di sessione su una card della panoramica. Il processo non si ferma mai: cambia solo la vista. Il bersaglio si evidenzia con un bordo dell'accento.
- **Nuova finestra**: uno spazio può stare in una finestra propria; ha un solo proprietario alla volta (nella finestra principale resta un segnaposto e il chip è tratteggiato).

## Vista grafica della conversazione

Sta sopra il terminale sul vetro *content* del gruppo; il terminale sotto è nascosto (`visibility: hidden`) per non far trasparire il suo testo. Font: **JetBrains Mono** come il terminale (`--cct-chat-font`; alternativa Geist da Aspetto), il codice sempre in JetBrains Mono (`--cct-code-font`). Corpo 12,5 px con interlinea 1,7 (13,5 px / 1,6 in Geist). Gerarchia: messaggio dell'utente su `--cct-surface-2`; risposte e strumenti con il puntino di stato (verde = finito, rosso = errore, accento pulsante = in corso, grigio = ragionamento); eventi di sistema (interruzione, compattazione, errore dell'API) con bordo tratteggiato o rosso. Lo stato non è solo nel colore: sempre anche etichetta o testo.

## Bot e bolle

Ogni sessione di Claude è un **bot**: nome, colore (stessa palette degli spazi) e icona (l'iniziale). Le **bolle** stanno in un blocco a pillola sul bordo della finestra (`--mg-glass` scuro con sfocatura), 44 px l'una. Anello di stato attorno alla bolla: blu che gira = lavora, giallo che pulsa = attende input o un permesso, grigio tenue = inattiva; numero giallo in alto a destra = file da rivedere; pallino verde in basso a sinistra = ha finito. Lo stato è anche nel tooltip e nell'`aria-label` della bolla. La mini-chat è un foglio `.mg-glass-sheet` (quasi opaco) accanto al blocco. Con «riduci animazioni» gli anelli non si muovono. Le bolle esistono solo nella modalità Bolle (alternativa alle schede di Claude, mai insieme); «Amplia» porta la sessione su tutta l'area dei pannelli (`.mg-glass-content`) con il suo cassetto di revisione.

## Cassetto di revisione

Il diff delle modifiche di Claude sta **accanto al terminale della sua sessione**, non in un pannello a parte (`changes/ReviewDrawer.tsx`).

- **Struttura**: a destra del terminale, larghezza regolabile (minimo 360 px, massimo 70 % del pannello). Si apre da solo alla prima modifica da rivedere e, se si era aperto da solo, si richiude quando non resta nulla; chiuso a mano diventa una **barra di 28 px** con il numero di file da rivedere (giallo `--cct-warn`, blu `--cct-info` se attendono solo Claude).
- **Materia**: sta dentro il gruppo di Dockview (vetro *content*), con intestazione e barre `.mg-bar`. Nei pannelli stretti (< 720 px) si sovrappone al terminale come foglio `.mg-glass-sheet` (quasi opaco, sfocato): mai vetro trasparente sopra altro testo.
- **Diff**: modalità *Auto* (affiancato se larghezza ≥ 640 px, altrimenti in linea), *In linea*, *Affiancato*; le parti invariate sono ripiegate. Colori di stato come nel resto dell'app; lo stato non è solo nel colore (etichette testuali).
- **Legame con il terminale**: pulsante «Revisione (N)» nella barra di stato, riga «Apri la revisione» sopra la casella di input quando è bloccata, badge e «Rivedi» sulle card `Edit` della conversazione.

## Nome

Il linguaggio grafico si chiama **Magnolia Prism** (scelto tra Octanio, Magnolia Prism e Teal Lattice; prima si chiamava «Ember Grid»).
