// Storybooks su Cloudflare Workers. Database = canale Telegram privato.
// Ogni libro = un documento JSON; il catalogo = catalog.json, ultimo messaggio fissato nel canale.
const MAX = 19e6; // limite di download del Bot API: 20 MB
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
let cache = null, at = 0; // cache in memoria dell'istanza (30 s)

async function tg(env, method, body) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const r = await fetch(url, body instanceof FormData
    ? { method: 'POST', body }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json();
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

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (!u.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    if (env.APP_PASSWORD && req.headers.get('x-app-password') !== env.APP_PASSWORD) return J({ error: 'auth' }, 401);
    try {
      const [res, id] = u.pathname.slice(5).split('/');
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
