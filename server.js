import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, APP_PASSWORD: PW = '', PORT = 3000 } = process.env;
if (!TOKEN || !CHAT) { console.error('Imposta TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID in .env'); process.exit(1); }
const API = `https://api.telegram.org/bot${TOKEN}`;
const FILE = `https://api.telegram.org/file/bot${TOKEN}`;
const MAX = 19e6; // getFile del Bot API scarica al massimo 20 MB

async function tg(method, body) {
  const opt = body instanceof FormData
    ? { method: 'POST', body }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) };
  const j = await (await fetch(`${API}/${method}`, opt)).json();
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
  return j.result;
}
function sendDoc(name, obj, caption = '') {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  if (blob.size > MAX) throw new Error('Libro troppo grande (max ~19 MB di testo)');
  const f = new FormData();
  f.append('chat_id', CHAT); f.append('caption', caption.slice(0, 1000)); f.append('document', blob, name);
  return tg('sendDocument', f);
}
async function download(file_id) {
  const { file_path } = await tg('getFile', { file_id });
  const r = await fetch(`${FILE}/${file_path}`);
  if (!r.ok) throw new Error('Download da Telegram fallito');
  return r;
}

/* Catalogo = catalog.json, ultimo messaggio fissato nel canale. Ogni libro = un messaggio con documento JSON. */
let catalog = { books: [] }, catMsg = null, lock = Promise.resolve();
const locked = fn => { const p = lock.then(fn); lock = p.catch(() => {}); return p; };

async function loadCatalog() {
  const pm = (await tg('getChat', { chat_id: CHAT })).pinned_message;
  if (pm?.document?.file_name === 'catalog.json') {
    catMsg = pm.message_id;
    catalog = await (await download(pm.document.file_id)).json();
  }
}
async function saveCatalog() {
  const m = await sendDoc('catalog.json', catalog, '📚 catalogo');
  await tg('pinChatMessage', { chat_id: CHAT, message_id: m.message_id, disable_notification: true });
  if (catMsg) await tg('deleteMessage', { chat_id: CHAT, message_id: catMsg }).catch(() => {});
  catMsg = m.message_id;
}

const app = express();
app.use('/api', (q, s, n) => (PW && q.get('x-app-password') !== PW ? s.status(401).json({ error: 'auth' }) : n()));

app.get('/api/books', (q, s) => s.json(catalog.books.map(({ file_id, msg_id, ...meta }) => meta)));

app.post('/api/books', express.json({ limit: '30mb' }), (q, s, n) => locked(async () => {
  const { id, title, author, added, chapters } = q.body;
  if (!id || !title || !Array.isArray(chapters)) return s.status(400).json({ error: 'dati non validi' });
  const m = await sendDoc(`${id}.json`, { title, author, chapters }, `${title} — ${author || ''}`);
  catalog.books = catalog.books.filter(b => b.id !== id);
  catalog.books.push({ id, title, author, added, file_id: m.document.file_id, msg_id: m.message_id });
  await saveCatalog();
  s.json({ id });
}).catch(n));

app.get('/api/books/:id', async (q, s, n) => {
  try {
    const b = catalog.books.find(x => x.id === q.params.id);
    if (!b) return s.status(404).json({ error: 'non trovato' });
    s.type('application/json').send(Buffer.from(await (await download(b.file_id)).arrayBuffer()));
  } catch (e) { n(e); }
});

app.delete('/api/books/:id', (q, s, n) => locked(async () => {
  const b = catalog.books.find(x => x.id === q.params.id);
  if (b) {
    await tg('deleteMessage', { chat_id: CHAT, message_id: b.msg_id }).catch(() => {});
    catalog.books = catalog.books.filter(x => x !== b);
    await saveCatalog();
  }
  s.json({ ok: true });
}).catch(n));

app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));
app.use((e, q, s, n) => { console.error(e.message); s.status(500).json({ error: e.message }); });

await loadCatalog();
app.listen(PORT, () => console.log(`Storybooks su http://localhost:${PORT} (${catalog.books.length} libri)`));
