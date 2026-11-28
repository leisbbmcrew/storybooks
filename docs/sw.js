/* Service worker di Storybooks: l'app si apre anche senza internet.
   - Pagine e script: prima la rete (max 4 s), poi la copia salvata.
   - File pesanti (cartelle piper/ e kokoro/, telegram-lib.js): prima la copia salvata.
   Se aggiorni telegram-lib.js o i file in piper/ o kokoro/, cambia il numero qui sotto (v9, v10…). */
const C='sb-shell-v8';
const CORE=['./','./index.html','./style.css','./app.js','./storage.js','./telegram.js','./telegram-config.js','./piper.js','./kokoro.js','./telegram-lib.js','./manifest.webmanifest','./icon.svg','./icon-192.png'];
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
const heavy=/\/(piper|kokoro)\/|telegram-lib\.js$/;
const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]);
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith((async()=>{
    const c=await caches.open(C);
    if(heavy.test(u.pathname)){const m=await c.match(r.url);if(m)return m}
    try{
      const n=await (heavy.test(u.pathname)?fetch(r):withTimeout(fetch(r),4000));
      if(n.status===200)c.put(r.url,n.clone());
      return n;
    }catch(err){
      const m=await c.match(r.url,{ignoreSearch:true})||(r.mode==='navigate'?(await c.match(new URL('./index.html',self.registration.scope).href))||(await c.match(self.registration.scope)):null);
      if(m)return m;
      throw err;
    }
  })());
});
