/* Service worker di Storybooks: conserva pagine e file pesanti (voci Piper, libreria Telegram)
   per usare l'app anche senza internet. Alla prima installazione salva subito i file dell'app,
   così funziona offline anche se non l'hai mai ricaricata. Pagine e script: prima la rete, poi la copia salvata.
   File pesanti (cartella piper/, telegram-lib.js): prima la copia salvata. Se li aggiorni, cambia il nome qui sotto (v2, v3…). */
const C='sb-shell-v1';
const CORE=['./','./index.html','./storage.js','./telegram.js','./telegram-config.js','./piper.js','./telegram-lib.js'];
self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil((async()=>{
    const c=await caches.open(C);
    await Promise.allSettled(CORE.map(u=>c.add(new Request(u,{cache:'reload'}))));   /* un file mancante non blocca gli altri */
  })());
});
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  for(const k of await caches.keys())if(k.startsWith('sb-shell-')&&k!==C)await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==location.origin)return;
  const heavy=/\/piper\/|telegram-lib\.js$/.test(u.pathname);
  e.respondWith((async()=>{
    const c=await caches.open(C);
    if(heavy){const m=await c.match(r.url);if(m)return m}
    try{
      const n=await fetch(r);
      if(n.status===200)c.put(r.url,n.clone());
      return n;
    }catch(err){
      const m=await c.match(r.url,{ignoreSearch:true})||(r.mode==='navigate'?(await c.match(new URL('./index.html',self.registration.scope).href))||(await c.match(self.registration.scope)):null);
      if(m)return m;
      throw err;
    }
  })());
});
