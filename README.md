# Storybooks

App web in stile Storytel, in italiano: carichi libri (EPUB, TXT, HTML, Markdown), finiscono nella libreria e li ascolti con una bella voce.

**Database: un gruppo Telegram.** Il browser parla direttamente con Telegram (stesso metodo di carmamedical): niente Worker, niente bot, niente Cloudflare. Ogni libro è un messaggio con un file `bXXXX.json` e una didascalia con titolo, autore, generi, durata, lingua e trama. Il catalogo è l'elenco dei messaggi del gruppo.

## Cartelle
- `docs/` – il sito (GitHub Pages: Settings → Pages → Branch `main`, cartella `/docs`)
  - `index.html`, `style.css`, `app.js` – interfaccia, lettore, importazione
  - `storage.js`, `telegram.js`, `telegram-config.js`, `telegram-lib.js` – Telegram
  - `piper.js`, `piper/` – voci offline Piper · `kokoro.js`, `kokoro/` – audiolibri Kokoro
  - `sw.js`, `manifest.webmanifest`, icone – funzionamento offline e installazione come app
- `.github/workflows/` – azioni manuali per ricompilare le librerie (di solito non servono)

## Configurazione
1. my.telegram.org → «API development tools» → crea un'app → scrivi `api_id` e `api_hash` in `docs/telegram-config.js`.
2. `TG_CHANNEL` è il nome esatto del gruppo («Storybooks»). L'account con cui accedi deve esserne proprietario o amministratore.
3. Al primo avvio su ogni dispositivo l'app chiede numero e codice Telegram; la sessione resta nel browser («Impostazioni → Collegamento» per uscire).
4. Nota: `api_hash` è leggibile da chiunque apra il sito. Da solo non dà accesso a nulla, ma non condividerlo e non incollare mai sessioni in chat.

## Funzioni
- **Home**: ricerca, filtri per genere e durata, «Continua ad ascoltare», scaffali Recenti / Scaricati / per genere.
- **Libreria**: filtri (In corso, Scaricati, Finiti, Con audio) e ordinamento; barra di avanzamento e segno di «finito» sulle copertine.
- **Scheda libro**: trama, genere, durata, capitoli; Riproduci / Scarica per l'uso offline; modifica di titolo e autore, «segna come finito», azzera avanzamento, elimina (con conferma).
- **Lettore**: tempo rimanente, velocità da 0,75× a 2×, timer di spegnimento anche «a fine capitolo», elenco capitoli, scorciatoie da tastiera (Spazio, ←/→, Maiusc+←/→, Esc), controlli nella schermata di blocco.
- **Aggiungere libri**: pulsante «Aggiungi» o trascinando i file sulla pagina; avviso se il libro c'è già.
- **Impostazioni**: tema chiaro/scuro/automatico, voce e velocità, stato Telegram, spazio usato, rimozione dei download e delle voci offline.
- **Installabile** come app (Aggiungi a schermata Home) e utilizzabile offline per i libri scaricati.

## Voci
- **Voce del dispositivo** (consigliate Edge «Natural» o le voci Premium di iOS/Android).
- **Piper** (Paola, Riccardo): offline, il modello si scarica una volta (28–64 MB).
- **Kokoro** (Sara, Nicola): non legge dal vivo; genera l'intero libro una volta, lo salva sul dispositivo e lo ascolti da lì (Libro → ⋯ → Audiolibro con voce Kokoro).
- **MP3 del narratore** (progetto narratore-libri): «Aggiungi audio» abbina `001.mp3`, `002.mp3`… ai capitoli.

## Manutenzione
- Se aggiorni `telegram-lib.js` o i file in `piper/` e `kokoro/`, cambia il numero della cache in `docs/sw.js` (`sb-shell-v8` → `v9`…).
- Componenti pesanti rigenerabili da GitHub → Actions: «Crea libreria Telegram», «Prepara Piper», «Prepara Kokoro».
- Telefono e PC hanno punti di ascolto separati (salvati nel browser). PDF non supportati.
