# Riassunto progetto «Storybooks»

## Obiettivo
App web in stile Storytel, in italiano. Carico libri (EPUB, TXT, HTML, Markdown), finiscono nel catalogo e, alla selezione di un titolo, parte una lettura vocale in italiano con intonazione e paraverbale (sintesi vocale del browser, con pause e tono calibrati su punteggiatura e dialoghi).

Database: canale Telegram privato, **non** Firebase (quindi nessuna regola Firestore). Deve essere sempre online, gratuito e senza il mio PC come server.

## Architettura attuale
- Cloudflare Worker (`src/worker.js`) con file statici in `public/index.html`.
- Ogni libro è un documento JSON nel canale; il catalogo è `catalog.json`, ultimo messaggio fissato nel canale.
- API: `GET/POST /api/books`, `GET/DELETE /api/books/:id`, protette dall'header `x-app-password`.
- Il Worker legge `env.TELEGRAM_BOT_TOKEN`, `env.TELEGRAM_CHAT_ID`, `env.APP_PASSWORD`.

## Repository
- GitHub: `leisbbmcrew/storybooks`, collegato a Cloudflare (Workers Builds).
- Struttura: `src/worker.js`, `public/index.html`, `wrangler.jsonc`, `package.json`, `README.md`, `.gitignore`, `.dev.vars.example`.
- Dallo zip risultava che i file coincidono con quelli attesi. Dentro c'erano però `.env` (con token reale) e `.env.example` (vecchio, per Express). Da fare: cancellarli da GitHub, aggiungere `.env` al `.gitignore`, mettere il repo privato. Da controllare se è stato fatto.

## Dati non segreti
- Bot: `@SBleis_bot`
- Canale: «Storybooks», ID `-1004388561564`

## Problema attuale
Nell'app compare: **«Telegram getChat: not found»**.

Ipotesi: Telegram risponde «Not Found» quando l'URL contiene un token mancante o malformato (per esempio `.../botundefined/getChat`). Il Secret probabilmente non arriva al Worker per uno di questi motivi:
- messo in «Builds → Variables and secrets» invece che in «Runtime variables and secrets»;
- nome diverso da `TELEGRAM_BOT_TOKEN`;
- nessun nuovo Deploy dopo la modifica;
- token con spazi o ritorni a capo (formato corretto: `numero:testo`, senza spazi attorno ai due punti).

Ho già reinserito il token come Secret separato su Cloudflare, ma l'errore persiste.

## Sicurezza
Il token è comparso più volte in chiaro in chat e nello zip del repo. Da verificare se ho fatto `/revoke` su @BotFather e aggiornato il Secret con il nuovo token.

## Prossimi passi
1. Controllare in Worker → Settings → Runtime variables and secrets che ci siano esattamente `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `APP_PASSWORD`, poi rifare il Deploy.
2. Guardare Observability → Logs per l'errore esatto.
3. Aggiungere al Worker un controllo che dia un messaggio chiaro se una variabile manca, senza mostrarne il valore.
4. Se il token è valido, verificare che il bot sia amministratore del canale (pubblica, elimina, fissa messaggi).
5. Dopo il successo: test con un EPUB, poi eventuale sincronizzazione del punto di ascolto su Telegram.

## Note
- Telefono e PC hanno punti di ascolto separati (salvati nel browser).
- PDF non supportati; ogni libro sotto circa 19 MB di testo.
- Non incollare mai token o password in chat.
