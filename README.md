# Storybooks

App web in stile Storytel: carichi libri (EPUB, TXT, HTML, Markdown), finiscono nella libreria e li ascolti con la voce del browser.

**Database: un canale Telegram privato.** Il browser parla direttamente con Telegram (metodo di carmamedical): niente Worker, niente bot, niente token. Ogni libro è un messaggio con un file `bXXXX.json` e la didascalia «titolo / autore». Il catalogo è l'elenco dei messaggi del canale.

## Configurazione
1. my.telegram.org → «API development tools» → crea una nuova app → copia `api_id` e `api_hash` in `public/telegram-config.js`.
2. Nello stesso file `TG_CHANNEL` è il nome esatto del canale («Storybooks»).
3. L'account Telegram con cui accedi deve essere proprietario o amministratore del canale.
4. Al primo avvio su ogni dispositivo l'app chiede numero e codice Telegram. La sessione resta nel browser; «Esci» la chiude.

## Pubblicazione
Cloudflare (Workers Builds) pubblica la cartella `public/` a ogni commit. Nessuna variabile o Secret da impostare.

## Voci offline (Piper)
1. Su GitHub: Actions → «Prepara Piper» → Run workflow (una volta sola). Crea la cartella `piper/` dentro `public/` (o `docs/`).
2. Nel player: 🎙 Voce → «Voci offline (Piper)» → Paola o Riccardo. Il modello si scarica una volta (28-64 MB) e resta nel browser.
3. Il service worker (`sw.js`) tiene in cache i file pesanti: dopo la prima apertura la voce funziona anche senza internet.
   Se aggiorni `telegram-lib.js` o i file in `piper/`, cambia il nome della cache in `sw.js` (v2, v3…).

## Note
- `public/telegram-lib.js` è la libreria Telegram già compilata. Per rifarla: GitHub → Actions → «Crea libreria Telegram» → Run workflow.
- Telefono e PC hanno punti di ascolto separati (salvati nel browser).
- PDF non supportati.
- Non mettere api_hash o sessioni in chat; usa un account Telegram dedicato se possibile.
