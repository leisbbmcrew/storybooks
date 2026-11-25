/* Database di Storybooks: un gruppo (o canale) Telegram, letto e scritto dal browser con l'account dell'utente.
   Ogni libro = un messaggio con il documento <id>.json (nella didascalia: titolo e autore su due righe).
   Il catalogo è l'elenco dei messaggi del gruppo: niente catalog.json, niente messaggio fissato.
   Il pallino in alto (#tgout) mostra lo stato: verde = sincronizzato, giallo = in corso, rosso = problema, grigio = Telegram non collegato. */
import {tgConfigured,hasSession,clearSession,loadTg,newClient,tgLogin,tgClient,tgReset,tgEntity,tgErrText,tgSendFile,withTimeout,libSource,shimError,consoleLog,tgMe} from "./telegram.js";
import {TG_CHANNEL} from "./telegram-config.js";

/* ---------- finestre di dialogo ---------- */
const ov=document.createElement('div');
ov.style.cssText='position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px';
const card=document.createElement('div');
card.style.cssText='background:var(--bg,#fff);color:var(--fg,#1a1a1a);border-radius:18px;padding:22px;max-width:390px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.4);font:15px/1.4 system-ui,sans-serif;max-height:90vh;overflow:auto';
ov.appendChild(card);
const BTN='font:inherit;font-weight:600;border:0;border-radius:20px;padding:10px 18px;background:var(--acc,#ff5a1f);color:#fff;cursor:pointer;width:100%;margin-top:6px';
const LINK='font:inherit;font-size:13px;border:0;background:none;color:var(--mut,#6b6b6b);text-decoration:underline;cursor:pointer;margin-top:10px;display:block;width:100%';
const el=(tag,text,css)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(css)e.style.cssText=css;return e};
const show=()=>{if(!ov.isConnected)document.body.appendChild(ov);card.textContent=''};
let notaEl=null;
const setInfo=t=>{if(notaEl)notaEl.textContent=t};

/* fields: [{type,ph,ac}]; opts.sms: "Non arriva? Invia via SMS". Restituisce i valori, '__SMS__', oppure null se l'utente sceglie "Più tardi" */
function ask(title,text,fields,opts={}){
  show();
  card.append(el('h2',title,'margin:0 0 8px;font-size:20px'),el('p',text,'margin:0 0 12px;font-size:14px;line-height:1.45;color:var(--mut,#6b6b6b)'));
  notaEl=el('p','','margin:0 0 10px;font-size:13px;color:var(--acc,#ff5a1f)');card.appendChild(notaEl);
  const inputs=fields.map(f=>{const i=el('input');i.type=f.type||'text';i.placeholder=f.ph||'';if(f.ac)i.autocomplete=f.ac;
    i.style.cssText='font:inherit;width:100%;padding:11px 12px;border-radius:12px;border:1px solid var(--line,#ccc);background:var(--card,#f3f1ee);color:inherit;margin-bottom:10px';card.appendChild(i);return i});
  const b=el('button','Continua',BTN);card.appendChild(b);
  return new Promise(res=>{
    const go=()=>{const v=inputs.map(i=>i.value);if(v.some(x=>!x.trim()))return;res(v)};
    b.onclick=go;inputs.forEach(i=>i.onkeydown=e=>{if(e.key==='Enter')go()});
    if(opts.sms){const s=el('button','Non arriva? Invia via SMS',LINK);s.onclick=()=>res('__SMS__');card.appendChild(s)}
    const k=el('button','Più tardi',LINK);k.onclick=()=>res(null);card.appendChild(k);
    inputs[0].focus();
  });
}
const righe=[];
function stato(t){
  righe.push(t);if(righe.length>6)righe.shift();
  show();notaEl=null;
  card.append(el('h2','Collegamento a Telegram','margin:0 0 8px;font-size:20px'),el('p','Attendi, non chiudere la pagina.','margin:0 0 12px;font-size:14px;color:var(--mut,#6b6b6b)'),
    el('pre',righe.join('\n'),'font-size:12px;white-space:pre-wrap;color:var(--mut,#6b6b6b);margin:0'));
}
/* messaggio con pulsante principale e, se serve, "Chiudi"; restituisce 'retry' o 'close' */
function avviso(title,msg,dett,btn,close){
  show();notaEl=null;
  card.append(el('h2',title,'margin:0 0 8px;font-size:20px'),el('p',msg,'margin:0 0 12px;font-size:14px;line-height:1.45'));
  if(dett)card.appendChild(el('pre',dett,'font-size:11px;white-space:pre-wrap;color:var(--mut,#6b6b6b);margin:0 0 12px;max-height:160px;overflow:auto'));
  const b=el('button',btn||'Riprova',BTN);card.appendChild(b);
  return new Promise(res=>{b.onclick=()=>res('retry');if(close){const k=el('button','Chiudi',LINK);k.onclick=()=>{ov.remove();res('close')};card.appendChild(k)}});
}
const dettagli=e=>[shimError&&('Buffer: '+shimError),libSource&&('Libreria: '+libSource),...(e&&e.details||[]),...consoleLog.slice(-5)].filter(Boolean).join('\n');

/* ---------- pallino di stato ---------- */
const LED={ok:['#2E9E5B','Sincronizzato con Telegram'],busy:['#E0A800','Sincronizzazione in corso…'],err:['#D93025','Problema di sincronizzazione'],off:['#8A94A6','Telegram non collegato: tocca per collegare']};
let busyN=0,lastErr='',verified=false;
const ledState=()=>!tgConfigured()||!hasSession()?'off':lastErr?'err':(busyN>0||!verified)?'busy':'ok';
function ledUpdate(){
  const b=document.getElementById('tgout');if(!b)return;
  const s=ledState(),c=LED[s];
  b.dataset.s=s;b.style.setProperty('--c',c[0]);
  const t=s==='err'?c[1]+': '+lastErr:c[1];b.title=t;b.setAttribute('aria-label','Stato Telegram: '+t);
}
const accountLabel=()=>tgMe?[tgMe.firstName,tgMe.phone?'+'+tgMe.phone:''].filter(Boolean).join(' · '):'';

/* ---------- accesso (una volta per dispositivo; la sessione resta nel browser) ---------- */
/* restituisce true se ora c'è una sessione, false se l'utente ha scelto "Più tardi" */
async function accessoTelegram(){
  const chiedi=async(...a)=>{const r=await ask(...a);if(r===null)throw new Error('ANNULLATO');return r};
  const ui={
    phone:async()=>(await chiedi('Collega Telegram','Inserisci il numero, con prefisso (es. +39…), dell’account Telegram che è proprietario o amministratore del gruppo «'+TG_CHANNEL+'».',[{type:'tel',ph:'+39…',ac:'tel'}]))[0],
    code:async()=>{const r=await chiedi('Codice Telegram','Il codice arriva nell’app Telegram (chat «Telegram») se l’account è già aperto su un altro dispositivo, altrimenti via SMS.',[{ph:'Codice',ac:'one-time-code'}],{sms:true});return r==='__SMS__'?r:r[0].trim()},
    password:async()=>(await chiedi('Password Telegram','Inserisci la password a due fattori di Telegram.',[{type:'password',ph:'Password'}]))[0],
    info:setInfo
  };
  for(;;){
    let client=null;
    try{
      righe.length=0;stato('Carico la libreria Telegram…');
      const tg=await loadTg(stato);
      stato('Connessione a Telegram…');
      client=newClient(tg,'');
      await withTimeout(client.connect(),30000,'TIMEOUT_CONNECT');
      stato('Connesso.');
      await tgLogin(tg,client,ui,stato);
      try{await client.disconnect()}catch(e){}
      ov.remove();ledUpdate();return true;
    }catch(e){
      try{if(client)await client.disconnect()}catch(_){}
      clearSession();
      if(e&&e.message==='ANNULLATO'){ov.remove();ledUpdate();return false}
      await avviso('Telegram non collegato',tgErrText(e),dettagli(e),'Riprova');
    }
  }
}
let loginP=null;
const login=()=>loginP||(loginP=accessoTelegram().finally(()=>{loginP=null}));

/* ---------- connessione ---------- */
async function conn(){
  if(!tgConfigured()){
    await avviso('Configurazione mancante','Scrivi api_id e api_hash (da my.telegram.org) in telegram-config.js e ricarica la pagina.','','Ho capito');
    ov.remove();throw new Error('NO_CONFIG');
  }
  const apri=async()=>{const c=await tgClient();const ent=await tgEntity();verified=true;return {...c,ent}};
  if(!hasSession()&&!(await login()))throw new Error('NO_LOGIN');
  try{return await apri()}
  catch(e){if(e&&e.message==='NO_SESSION'){if(!(await login()))throw new Error('NO_LOGIN');return await apri()}throw e}
}
/* esegue fn; se la connessione è caduta la riapre e riprova una volta */
async function run(fn){
  try{return await fn(await conn())}
  catch(e){
    const m=(e&&e.message)||'';
    if(/^TIMEOUT|CONNECTION|not connected|disconnected|Cannot send requests/i.test(m)){tgReset();return await fn(await conn())}
    throw e}
}
/* ogni operazione accende il pallino giallo; un errore lo rende rosso, un successo verde */
const wrap=fn=>async(...a)=>{
  busyN++;ledUpdate();
  try{const r=await fn(...a);lastErr='';return r}
  catch(e){
    console.error(e);
    const msg=e&&e.message==='NO_LOGIN'?'Telegram non collegato':tgErrText(e);
    if(!(e&&(e.message==='NO_LOGIN'||e.message==='NO_CONFIG')))lastErr=msg;
    const x=new Error(msg);x.cause=e;throw x}
  finally{busyN=Math.max(0,busyN-1);ledUpdate()}
};

/* ---------- libri ---------- */
const idx=new Map();      /* id libro → id del messaggio nel gruppo */
const covIdx=new Map();   /* id libro → id del messaggio con la copertina (c<id>.jpg) */
const audIdx=new Map();   /* id libro → {indice capitolo → id del messaggio audio a<id>_<NNN>.mp3} */
const fname=m=>(m.file&&m.file.name)||((m.document&&m.document.attributes)||[]).find(a=>a.className==='DocumentAttributeFilename')?.fileName||'';
const saveCache=l=>{try{localStorage.setItem('sb_cat',JSON.stringify(l))}catch(e){}};
function cached(){
  try{const l=JSON.parse(localStorage.getItem('sb_cat')||'[]');l.forEach(b=>{idx.set(b.id,b.msg);if(b.cover)covIdx.set(b.id,b.cover);if(b.audio&&Object.keys(b.audio).length)audIdx.set(b.id,b.audio)});queueMicrotask(()=>sweep(l));return l}
  catch(e){return[]}
}
const annuncia=l=>window.dispatchEvent(new CustomEvent('sbtg-catalog',{detail:l}));
async function _list({client,ent}){
  const ms=await withTimeout(client.getMessages(ent,{limit:3000}),90000,'TIMEOUT_LIST');
  const out=[],covs=new Map(),auds=new Map();idx.clear();covIdx.clear();audIdx.clear();
  for(const m of ms){
    const n=fname(m),mc=/^c(b[0-9a-z]+)\.jpg$/i.exec(n);
    if(mc&&!covs.has(mc[1]))covs.set(mc[1],m.id);                                /* il più recente vince */
    const ma=/^a(b[0-9a-z]+)_(\d{3})\.mp3$/i.exec(n);
    if(ma){const o=auds.get(ma[1])||{};if(!o[+ma[2]-1])o[+ma[2]-1]=m.id;auds.set(ma[1],o)}   /* audio narrato: capitolo = numero nel nome */
  }
  for(const m of ms){
    const name=fname(m);if(!/^b[0-9a-z]+\.json$/i.test(name))continue;
    const id=name.slice(0,-5),[t,a]=String(m.message||'').split('\n');
    out.push({id,title:t||id,author:a||'',added:(m.date||0)*1000,msg:m.id,cover:covs.get(id)||0,audio:auds.get(id)||null});
    idx.set(id,m.id);if(covs.get(id))covIdx.set(id,covs.get(id));if(auds.get(id))audIdx.set(id,auds.get(id));
  }
  saveCache(out);annuncia(out);queueMicrotask(()=>sweep(out));return out;
}
async function list(){
  for(;;){
    try{return await run(_list)}
    catch(e){
      const m=(e&&e.message)||'';
      if(m==='NO_CONFIG')throw e;
      if(m==='NO_LOGIN')return cached();      /* "Più tardi": si vede il catalogo salvato, pallino grigio */
      console.error(e);lastErr=tgErrText(e);ledUpdate();
      const r=await avviso('Telegram non raggiungibile',tgErrText(e),dettagli(e),'Riprova',true);
      if(r==='close')throw new Error(tgErrText(e));
    }
  }
}
async function get(id,onProgress){
  return run(async c=>{
    if(!idx.has(id))await _list(c);
    const mid=idx.get(id);if(!mid)throw new Error('Libro non trovato nel gruppo');
    const [m]=await c.client.getMessages(c.ent,{ids:[mid]});
    if(!m)throw new Error('Libro non trovato nel gruppo');
    const buf=await withTimeout(c.client.downloadMedia(m,{progressCallback:onProgress}),300000,'TIMEOUT_DOWNLOAD');
    return JSON.parse(new TextDecoder().decode(buf));
  });
}
const one=s=>String(s||'').replace(/\s+/g,' ').trim();
async function put(b,onProgress){
  return run(async({client,tg,ent})=>{
    const body=JSON.stringify({title:b.title,author:b.author,chapters:b.chapters});
    const file=new File([body],b.id+'.json',{type:'application/json'});
    if(file.size>1.9e9)throw new Error('Libro troppo grande');
    const caption=one(b.title).slice(0,200)+'\n'+one(b.author).slice(0,120);
    const msg=await tgSendFile(tg,client,ent,file,p=>{if(onProgress)onProgress(typeof p==='number'?p:0)},caption);
    idx.set(b.id,msg.id);
    const l=cached().filter(x=>x.id!==b.id);l.push({id:b.id,title:b.title,author:b.author||'',added:b.added,msg:msg.id,cover:0});saveCache(l);
  });
}
async function del(id){
  return run(async c=>{
    if(!idx.has(id))await _list(c);
    const ids=[idx.get(id),covIdx.get(id),...Object.values(audIdx.get(id)||{})].filter(Boolean);
    if(ids.length)await c.client.deleteMessages(c.ent,ids,{revoke:true});
    idx.delete(id);covIdx.delete(id);saveCache(cached().filter(x=>x.id!==id));
    idbDel(id);if(urls[id]){URL.revokeObjectURL(urls[id]);delete urls[id]}
    for(const n of Object.keys(audIdx.get(id)||{}))idbDel('aud:'+id+':'+n);audIdx.delete(id);
  });
}
async function logout(){
  try{const {client,tg}=await withTimeout(tgClient(),15000,'TIMEOUT');await withTimeout(client.invoke(new tg.Api.auth.LogOut()),10000,'TIMEOUT')}catch(e){}
  clearSession();try{localStorage.removeItem('sb_cat');localStorage.removeItem('sb_cov_try');indexedDB.deleteDatabase('sb_cov')}catch(e){}
  tgReset();location.reload();
}

/* ---------- audio narrato ----------
   File MP3 prodotti sul PC dal «Narratore Libri» (uno per capitolo, numerati 001, 002…), caricati nel gruppo
   come a<id libro>_<NNN>.mp3 e abbinati al capitolo dal numero. Dopo il primo ascolto restano nel browser. */
const pad3=n=>String(n).padStart(3,'0');
const audioOf=id=>audIdx.get(id)||{};
const setAudioCache=(id,o)=>{const l=cached().map(x=>x.id===id?{...x,audio:Object.keys(o).length?o:null}:x);saveCache(l);annuncia(l)};
async function putAudio(id,n,file,onProgress,title){
  return run(async({client,tg,ent})=>{
    if(!idx.has(id))await _list({client,ent});
    if(!idx.has(id))throw new Error('Libro non trovato nel gruppo');
    const f=new File([file],'a'+id+'_'+pad3(n+1)+'.mp3',{type:'audio/mpeg'});
    const msg=await tgSendFile(tg,client,ent,f,p=>{if(onProgress)onProgress(typeof p==='number'?p:0)},'Audio · '+one(title).slice(0,120)+' · cap. '+(n+1));
    const o={...audioOf(id)},old=o[n];o[n]=msg.id;audIdx.set(id,o);
    if(old)try{await client.deleteMessages(ent,[old],{revoke:true})}catch(e){}     /* sostituisce un audio già presente */
    await idbSet('aud:'+id+':'+n,f);
    setAudioCache(id,o);
  });
}
async function getAudio(id,n,onProgress){
  const k='aud:'+id+':'+n,hit=await idbGet(k);
  if(hit)return hit;
  return run(async c=>{
    let mid=audioOf(id)[n];
    if(!mid){await _list(c);mid=audioOf(id)[n]}
    if(!mid)throw new Error('Audio non trovato');
    const [m]=await c.client.getMessages(c.ent,{ids:[mid]});
    if(!m)throw new Error('Audio non trovato');
    const buf=await withTimeout(c.client.downloadMedia(m,{progressCallback:onProgress&&((d,t)=>{const x=Number(d)/Number(t);if(isFinite(x))onProgress(Math.min(1,x))})}),900000,'TIMEOUT_DOWNLOAD');
    const bl=new Blob([buf],{type:'audio/mpeg'});
    await idbSet(k,bl);return bl;
  });
}
async function hasAudioLocal(id,n){return !!(await idbGet('aud:'+id+':'+n))}
async function delAudio(id){
  return run(async c=>{
    if(!idx.has(id))await _list(c);
    const o=audioOf(id),ids=Object.values(o);
    if(ids.length)await c.client.deleteMessages(c.ent,ids,{revoke:true});
    for(const n of Object.keys(o))idbDel('aud:'+id+':'+n);
    audIdx.delete(id);setAudioCache(id,{});
  });
}

/* ---------- copertine ----------
   Per ogni libro: si cerca online (Google Books, poi Open Library), altrimenti si usa quella dentro l'EPUB.
   L'immagine viene ridimensionata, salvata nel gruppo come documento c<id>.jpg (abbinata al libro dall'id)
   e tenuta anche nel browser (IndexedDB) per non riscaricarla. */
const urls={};            /* id libro → indirizzo locale dell'immagine, per <img> */
const idb=()=>new Promise((res,rej)=>{const r=indexedDB.open('sb_cov',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
const idbGet=async k=>{try{const d=await idb();return await new Promise((res,rej)=>{const q=d.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}catch(e){return undefined}};
const idbSet=async(k,v)=>{try{const d=await idb();await new Promise((res,rej)=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').put(v,k);t.oncomplete=res;t.onerror=()=>rej(t.error)})}catch(e){}};
const idbDel=async k=>{try{const d=await idb();await new Promise(res=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').delete(k);t.oncomplete=res;t.onerror=res})}catch(e){}};
const sig=ms=>{try{return AbortSignal.timeout(ms)}catch(e){const c=new AbortController();setTimeout(()=>c.abort(),ms);return c.signal}};
const getJSON=async u=>{const r=await fetch(u,{signal:sig(12000)});if(!r.ok)throw new Error('HTTP '+r.status);return r.json()};
const getImg=async u=>{const r=await fetch(u,{signal:sig(20000)});if(!r.ok)throw new Error('HTTP '+r.status);const b=await r.blob();if(!/^image\//.test(b.type)||b.size<1500)throw new Error('non è una copertina');return b};
const toks=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9]+/).filter(w=>w.length>2);
const simil=(a,b)=>{const A=toks(a),B=new Set(toks(b));return A.length?A.filter(w=>B.has(w)).length/A.length:0};   /* quanto il titolo trovato somiglia a quello cercato */
const enc=encodeURIComponent;

async function daGoogleBooks(title,author){
  for(const q of [author?`intitle:${title} inauthor:${author}`:'',`intitle:${title}`].filter(Boolean)){
    const j=await getJSON('https://www.googleapis.com/books/v1/volumes?printType=books&maxResults=8&fields=items(volumeInfo(title,imageLinks))&q='+enc(q));
    for(const it of j.items||[]){
      const v=it.volumeInfo||{},l=v.imageLinks;if(!l||simil(title,v.title)<.6)continue;
      const u=(l.thumbnail||l.smallThumbnail||'').replace(/^http:/,'https:').replace(/&edge=curl/,'');if(!u)continue;
      try{return await getImg(u.replace(/zoom=\d/,'zoom=0'))}catch(e){}
      return await getImg(u);
    }
  }
  return null;
}
async function daOpenLibrary(title,author){
  for(const p of [author?`title=${enc(title)}&author=${enc(author)}`:'',`title=${enc(title)}`].filter(Boolean)){
    const j=await getJSON('https://openlibrary.org/search.json?limit=8&fields=title,cover_i&'+p);
    for(const d of j.docs||[]){
      if(!d.cover_i||simil(title,d.title)<.6)continue;
      return await getImg(`https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg?default=false`);
    }
  }
  return null;
}
async function cercaOnline(title,author){
  for(const [nome,f] of [['Google Books',daGoogleBooks],['Open Library',daOpenLibrary]]){
    try{const bl=await f(one(title),one(author));if(bl)return {blob:bl,src:nome}}
    catch(e){console.warn('Copertina '+nome+': '+((e&&e.message)||e))}
  }
  return null;
}
/* ridimensiona (lato massimo 700 px) e converte in JPEG; rifiuta immagini minuscole o non valide */
async function preparaImmagine(blob){
  const u=URL.createObjectURL(blob);
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('immagine non valida'));i.src=u});
    const w=img.naturalWidth,h=img.naturalHeight;if(Math.min(w,h)<80)throw new Error('immagine troppo piccola');
    const k=Math.min(1,700/Math.max(w,h)),c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);
    const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(img,0,0,c.width,c.height);
    return await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('conversione non riuscita')),'image/jpeg',.86));
  }finally{URL.revokeObjectURL(u)}
}
function mostra(id,blob){
  if(urls[id])URL.revokeObjectURL(urls[id]);
  urls[id]=URL.createObjectURL(blob);
  window.dispatchEvent(new CustomEvent('sbtg-cover',{detail:{id,url:urls[id]}}));
}
/* invia la copertina al gruppo e la abbina al libro (nome file c<id>.jpg) */
async function salvaCopertina(b,jpg){
  await run(async({client,tg,ent})=>{
    const file=new File([jpg],'c'+b.id+'.jpg',{type:'image/jpeg'});
    const msg=await tgSendFile(tg,client,ent,file,()=>{},'Copertina: '+one(b.title).slice(0,150));
    covIdx.set(b.id,msg.id);
    saveCache(cached().map(x=>x.id===b.id?{...x,cover:msg.id}:x));
  });
  await idbSet(b.id,jpg);mostra(b.id,jpg);
}
const lavoro=new Set();   /* libri per cui è già in corso la ricerca */
/* b = {id,title,author}; embedded = copertina contenuta nell'EPUB (Blob), usata se online non si trova nulla.
   Restituisce 'Google Books', 'Open Library', 'epub' oppure null se non è stato possibile trovarne una. */
async function cover(b,embedded){
  if(lavoro.has(b.id))return null;
  lavoro.add(b.id);
  try{
    const online=await cercaOnline(b.title,b.author);
    const cand=[online&&[online.blob,online.src],embedded&&[embedded,'epub']].filter(Boolean);
    for(const [blob,src] of cand){
      let jpg;try{jpg=await preparaImmagine(blob)}catch(e){console.warn('Copertina scartata ('+src+'): '+e.message);continue}
      await salvaCopertina(b,jpg);return src;
    }
    return null;
  }finally{lavoro.delete(b.id)}
}
/* all'avvio e a ogni aggiornamento del catalogo: mostra le copertine già salvate e cerca quelle che mancano */
let sweeping=false,again=null;
const triedGet=()=>{try{return JSON.parse(localStorage.getItem('sb_cov_try')||'{}')}catch(e){return{}}};
async function sweep(list){
  if(sweeping){again=list;return}
  sweeping=true;
  try{
    const need=[];
    for(const b of list){
      if(!b.cover||urls[b.id])continue;
      const bl=await idbGet(b.id);
      if(bl)mostra(b.id,bl);else need.push(b);
    }
    if(!hasSession()||!tgConfigured())return;
    if(need.length)try{
      await run(async c=>{
        const ms=await c.client.getMessages(c.ent,{ids:need.map(b=>b.cover)});
        for(const m of ms){
          const b=m&&need.find(x=>x.cover===m.id);if(!b)continue;
          try{const buf=await withTimeout(c.client.downloadMedia(m,{}),60000,'TIMEOUT_DOWNLOAD');const bl=new Blob([buf],{type:'image/jpeg'});await idbSet(b.id,bl);mostra(b.id,bl)}
          catch(e){console.warn('Copertina '+b.id+': '+e.message)}
        }
      });
    }catch(e){console.warn('Copertine: '+((e&&e.message)||e))}
    const tr=triedGet(),now=Date.now();
    for(const b of list){
      if(b.cover||lavoro.has(b.id)||(tr[b.id]&&now-tr[b.id]<3*864e5))continue;   /* se non si trova, riprova dopo 3 giorni */
      tr[b.id]=now;try{localStorage.setItem('sb_cov_try',JSON.stringify(tr))}catch(e){}
      try{await cover(b,null)}catch(e){console.warn('Copertina «'+b.title+'»: '+((e&&e.message)||e));break}
    }
  }finally{sweeping=false;if(again){const l=again;again=null;sweep(l)}}
}
function cercaMancanti(){try{localStorage.removeItem('sb_cov_try')}catch(e){}sweep(cached())}

/* ---------- tocco sul pallino ---------- */
const listW=wrap(list);
async function menu(){
  const s=ledState();
  if(s==='off'){if(await login()){try{await listW()}catch(e){}}return}
  show();notaEl=null;
  const nome=accountLabel();
  card.append(el('h2','Telegram','margin:0 0 8px;font-size:20px'),
    el('p',(s==='err'?LED.err[1]+'.':LED[s][1]+'.')+(nome?' Account: '+nome+'.':'')+' Gruppo: «'+TG_CHANNEL+'».','margin:0 0 12px;font-size:14px;line-height:1.45'));
  if(s==='err')card.appendChild(el('pre',lastErr,'font-size:12px;white-space:pre-wrap;color:var(--mut,#6b6b6b);margin:0 0 12px;max-height:160px;overflow:auto'));
  const b=el('button',s==='err'?'Riprova ora':'Aggiorna catalogo',BTN);
  b.onclick=async()=>{ov.remove();try{await listW()}catch(e){}};
  const cm=el('button','Cerca le copertine mancanti',LINK);cm.onclick=()=>{ov.remove();cercaMancanti()};
  const x=el('button','Esci da Telegram',LINK);
  x.onclick=()=>{if(confirm('Scollegare Telegram da questo dispositivo?'))logout()};
  const k=el('button','Chiudi',LINK);k.onclick=()=>ov.remove();
  card.append(b,cm,x,k);
}

window.SBTG={cached,list:listW,get:wrap(get),put:wrap(put),del:wrap(del),cover:wrap(cover),putAudio:wrap(putAudio),getAudio:wrap(getAudio),hasAudioLocal,delAudio:wrap(delAudio),audioOf,logout,menu};
ledUpdate();
window.dispatchEvent(new Event('sbtg-load'));
