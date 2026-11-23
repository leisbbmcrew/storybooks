# Storybooks (Cloudflare Workers + Telegram)

Sempre online, senza server da gestire e senza carta di credito. Il database è un canale Telegram privato.
Niente Firebase/Firestore: non ci sono regole Firestore; l’accesso è protetto da `APP_PASSWORD` e il token resta nei segreti di Cloudflare.

## Deploy
1. Carica questa cartella su un repository GitHub (privato va bene).
2. Cloudflare → Workers & Pages → Create → **Import a repository** → scegli il repo. Lascia i comandi predefiniti (`npx wrangler deploy`).
3. Dopo il primo deploy: Worker → Settings → **Variables and Secrets** → aggiungi come **Secret**:
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `APP_PASSWORD`.
4. Apri l’indirizzo `https://storybooks.<tuo-sottodominio>.workers.dev` e inserisci la password.

Il bot deve essere amministratore del canale (pubblica, elimina, fissa messaggi).

## Limiti
- Formati: EPUB, TXT, HTML, Markdown. Ogni libro sotto ~19 MB di testo.
- Piano gratuito Cloudflare: 100.000 richieste al giorno.
