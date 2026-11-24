// Storybooks su Cloudflare Workers. Database = canale Telegram privato.
// Ogni libro = un documento JSON; il catalogo = catalog.json, ultimo messaggio fissato nel canale.
const MAX = 19e6; // limite di download del Bot API: 20 MB
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
let cache = null, at = 0; // cache in memoria dell'istanza (30 s)

async function tg(env, method, body, tentativo = 0) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const r = await fetch(url, body instanceof FormData
    ? { method: 'POST', body }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json();
  // Troppe richieste: se l'attesa è breve, aspetta e riprova una volta
  const ra = j.parameters?.retry_after;
  if (!j.ok && r.status === 429 && ra && ra <= 25 && tentativo < 1) {
    await new Promise(res => setTimeout(res, (ra + 1) * 1000));
    return tg(env, method, body, tentativo + 1);
  }
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
  return j.result;
}
async function download(env, file_id) {
  const { file_path } = await tg(env, 'getFile', { file_id });
  const r = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file_path}`);
  if (!r.ok) throw new Error('Download da Telegram fallito');
  return r;
}
function sendDoc(env, name, data, caption = '') {
  const blob = new Blob([data], { type: 'application/json' });
  if (blob.size > MAX) throw new Error('Libro troppo grande (max ~19 MB di testo)');
  const f = new FormData();
  f.append('chat_id', env.TELEGRAM_CHAT_ID); f.append('caption', caption.slice(0, 1000)); f.append('document', blob, name);
  return tg(env, 'sendDocument', f);
}
async function load(env, force) {
  if (!force && cache && Date.now() - at < 30000) return cache;
  const pm = (await tg(env, 'getChat', { chat_id: env.TELEGRAM_CHAT_ID })).pinned_message;
  let st = { catalog: { books: [] }, msg: null };
  if (pm?.document?.file_name === 'catalog.json')
    st = { msg: pm.message_id, catalog: await (await download(env, pm.document.file_id)).json() };
  cache = st; at = Date.now(); return st;
}
async function save(env, st) {
  const m = await sendDoc(env, 'catalog.json', JSON.stringify(st.catalog), '📚 catalogo');
  await tg(env, 'pinChatMessage', { chat_id: env.TELEGRAM_CHAT_ID, message_id: m.message_id, disable_notification: true });
  if (st.msg) await tg(env, 'deleteMessage', { chat_id: env.TELEGRAM_CHAT_ID, message_id: st.msg }).catch(() => {});
  st.msg = m.message_id; cache = st; at = Date.now();
}

// ---------- Diagnostica (usata da /diag.html) ----------
// GET  /api/diag  -> controlla token, canale, permessi del bot e catalogo
// POST /api/diag  -> prova di caricamento: invia il corpo al canale e lo elimina subito (non tocca il catalogo)
async function diag(env, req) {
  const log = [];
  const run = async (step, fn) => {
    const t = Date.now();
    try { const d = await fn(); log.push({ step, ok: true, ms: Date.now() - t, detail: d ?? '' }); return true; }
    catch (e) { log.push({ step, ok: false, ms: Date.now() - t, detail: e.message }); return false; }
  };
  if (req.method === 'POST') {
    let buf, id;
    await run('S1. Il Worker riceve il libro', async () => { buf = await req.arrayBuffer(); return `${(buf.byteLength / 1e6).toFixed(2)} MB ricevuti`; });
    if (!buf) return { log };
    await run('S2. Invio a Telegram (copia di prova)', async () => { id = (await sendDoc(env, 'diag-test.json', buf, '🔧 prova diagnostica')).message_id; return `ok, messaggio ${id}`; });
    if (id) await run('S3. Eliminazione della copia di prova', async () => { await tg(env, 'deleteMessage', { chat_id: env.TELEGRAM_CHAT_ID, message_id: id }); return 'ok'; });
    return { log };
  }
  let me, chat;
  await run('G1. Token valido (getMe)', async () => { me = await tg(env, 'getMe'); return `bot @${me.username}`; });
  if (!me) return { log };
  await run('G2. Canale raggiungibile (getChat)', async () => { chat = await tg(env, 'getChat', { chat_id: env.TELEGRAM_CHAT_ID }); return `${chat.type} «${chat.title || ''}»`; });
  if (!chat) return { log };
  await run('G3. Permessi del bot nel canale', async () => {
    const m = await tg(env, 'getChatMember', { chat_id: env.TELEGRAM_CHAT_ID, user_id: me.id });
    if (!['administrator', 'creator'].includes(m.status)) throw new Error(`il bot non è amministratore del canale (stato: ${m.status})`);
    const manca = [];
    if (m.can_post_messages === false) manca.push('pubblicare messaggi');
    if (m.can_delete_messages === false) manca.push('eliminare messaggi');
    if ((m.can_pin_messages ?? m.can_edit_messages) === false) manca.push('fissare/modificare messaggi');
    if (manca.length) throw new Error('al bot manca il permesso di: ' + manca.join(', '));
    return 'amministratore con i permessi necessari';
  });
  await run('G4. Messaggio fissato (catalogo)', async () => {
    const pm = chat.pinned_message;
    if (!pm) return 'nessun messaggio fissato: normale finché non carichi il primo libro';
    if (pm.document?.file_name !== 'catalog.json') return 'il messaggio fissato non è catalog.json: verrà sostituito al prossimo caricamento';
    const j = await (await download(env, pm.document.file_id)).json();
    return `catalog.json letto: ${(j.books || []).length} libri`;
  });
  return { log };
}

export default {
  async fetch(req, env0) {
    const u = new URL(req.url);
    if (!u.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    // Pulisce spazi/a capo invisibili e controlla le variabili senza mai mostrarne il valore
    const env = {};
    for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'APP_PASSWORD']) env[k] = String(env0[k] ?? '').trim();
    const mancanti = Object.keys(env).filter(k => !env[k]);
    if (mancanti.length) return J({ error: 'Variabili mancanti nel Worker (Runtime variables and secrets): ' + mancanti.join(', ') + '. Dopo averle aggiunte rifai il Deploy.' }, 500);
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(env.TELEGRAM_BOT_TOKEN)) return J({ error: 'TELEGRAM_BOT_TOKEN ha un formato non valido (deve essere numero:testo, senza spazi).' }, 500);
    if (req.headers.get('x-app-password') !== env.APP_PASSWORD) return J({ error: 'auth' }, 401);
    try {
      const [res, id] = u.pathname.slice(5).split('/');
      if (res === 'diag') return J(await diag(env, req));
      if (res !== 'books') return J({ error: 'non trovato' }, 404);

      if (req.method === 'GET' && !id) {
        const { catalog } = await load(env);
        return J(catalog.books.map(({ file_id, msg_id, ...meta }) => meta));
      }
      if (req.method === 'GET') {
        let st = await load(env), b = st.catalog.books.find(x => x.id === id);
        if (!b) { st = await load(env, true); b = st.catalog.books.find(x => x.id === id); }
        if (!b) return J({ error: 'non trovato' }, 404);
        const r = await download(env, b.file_id);
        return new Response(r.body, { headers: { 'content-type': 'application/json' } });
      }
      if (req.method === 'POST' && !id) {
        const m = JSON.parse(decodeURIComponent(req.headers.get('x-meta') || '{}'));
        if (!m.id || !m.title) return J({ error: 'dati non validi' }, 400);
        const buf = await req.arrayBuffer(), st = await load(env, true);
        const d = await sendDoc(env, `${m.id}.json`, buf, `${m.title} — ${m.author || ''}`);
        st.catalog.books = st.catalog.books.filter(b => b.id !== m.id);
        st.catalog.books.push({ id: m.id, title: m.title, author: m.author, added: m.added, file_id: d.document.file_id, msg_id: d.message_id });
        await save(env, st);
        return J({ id: m.id });
      }
      if (req.method === 'DELETE' && id) {
        const st = await load(env, true), b = st.catalog.books.find(x => x.id === id);
        if (b) {
          await tg(env, 'deleteMessage', { chat_id: env.TELEGRAM_CHAT_ID, message_id: b.msg_id }).catch(() => {});
          st.catalog.books = st.catalog.books.filter(x => x !== b);
          await save(env, st);
        }
        return J({ ok: true });
      }
      return J({ error: 'metodo non supportato' }, 405);
    } catch (e) { return J({ error: e.message }, 500); }
  }
};
