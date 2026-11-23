# Storybooks

Audiolibri in italiano (sintesi vocale del browser con intonazione e pause), layout in stile Storytel.
Il database è un **canale Telegram privato**: ogni libro è un messaggio con un documento JSON e il catalogo è `catalog.json`, fissato nel canale.
Non serve Firebase/Firestore, quindi non ci sono regole Firestore: l’accesso è protetto dal server (token in `.env` + `APP_PASSWORD`).

## Setup
1. Su Telegram crea un bot con **@BotFather** e copia il token.
2. Crea un **canale privato**, aggiungi il bot come amministratore (permessi: pubblica, elimina, fissa messaggi).
3. Ricava l’ID del canale (inizia con `-100`), ad esempio inoltrando un messaggio del canale a @RawDataBot.
4. `cp .env.example .env` e compila i valori.
5. `npm install && npm start` → http://localhost:3000

## Deploy
Serve un host Node (Render, Railway, Fly.io, VPS). GitHub Pages non va bene: il token del bot deve restare sul server.
Variabili d’ambiente da impostare: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `APP_PASSWORD`. Comando di avvio: `npm start`.

## Limiti
- Formati: EPUB, TXT, HTML, Markdown (PDF non supportato).
- Ogni libro, convertito in JSON, deve stare sotto ~19 MB (limite di download del Bot API).
- Server a istanza singola: il catalogo è in memoria e riscritto su Telegram a ogni modifica.
