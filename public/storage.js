/* "Database" di Storybooks: un canale Telegram, letto e scritto dal browser con l'account dell'utente.
   Ogni libro = un messaggio con il documento <id>.json (nella didascalia: titolo e autore su due righe).
   Il catalogo è l'elenco dei messaggi del canale: niente catalog.json, niente messaggio fissato. */
import {tgConfigured,hasSession,clearSession,loadTg,newClient,tgLogin,tgClient,tgReset,tgEntity,tgErrText,tgSendFile,withTimeout,libSource,shimError,consoleLog} from "./telegram.js";
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

/* fields: [{type,ph,ac}]; opts.sms: aggiunge "Non arriva? Invia via SMS". Restituisce i valori, oppure '__SMS__' */
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
/* messaggio con "Riprova" (e, se serve, "Chiudi"); restituisce 'retry' o 'close' */
function avviso(title,msg,dett,btn,close){
  show();notaEl=null;
  card.append(el('h2',title,'margin:0 0 8px;font-size:20px'),el('p',msg,'margin:0 0 12px;font-size:14px;line-height:1.45'));
  if(dett)card.appendChild(el('pre',dett,'font-size:11px;white-space:pre-wrap;color:var(--mut,#6b6b6b);margin:0 0 12px;max-height:160px;overflow:auto'));
  const b=el('button',btn||'Riprova',BTN);card.appendChild(b);
  return new Promise(res=>{b.onclick=()=>res('retry');if(close){const k=el('button','Chiudi',LINK);k.onclick=()=>{ov.remove();res('close')};card.appendChild(k)}});
}
const dettagli=e=>[shimError&&('Buffer: '+shimError),libSource&&('Libreria: '+libSource),...(e&&e.details||[]),...consoleLog.slice(-5)].filter(Boolean).join('\n');

/* ---------- accesso (una volta per dispositivo; la sessione resta nel browser) ---------- */
async function accessoTelegram(){
  const ui={
    phone:async()=>(await ask('Collega Telegram','Inserisci il numero, con prefisso (es. +39…), dell’account Telegram che è proprietario o amministratore del canale «'+TG_CHANNEL+'».',[{type:'tel',ph:'+39…',ac:'tel'}]))[0],
    code:async()=>{const r=await ask('Codice Telegram','Il codice arriva nell’app Telegram (chat «Telegram») se l’account è già aperto su un altro dispositivo, altrimenti via SMS.',[{ph:'Codice',ac:'one-time-code'}],{sms:true});return r==='__SMS__'?r:r[0].trim()},
    password:async()=>(await ask('Password Telegram','Inserisci la password a due fattori di Telegram.',[{type:'password',ph:'Password'}]))[0],
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
      ov.remove();return;
    }catch(e){
      try{if(client)await client.disconnect()}catch(_){}
      clearSession();
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
  const apri=async()=>{const c=await tgClient();const ent=await tgEntity();return {...c,ent}};
  if(!hasSession())await login();
  try{return await apri()}
  catch(e){if(e&&e.message==='NO_SESSION'){await login();return await apri()}throw e}
}
/* esegue fn; se la connessione è caduta la riapre e riprova una volta */
async function run(fn){
  try{return await fn(await conn())}
  catch(e){
    const m=(e&&e.message)||'';
    if(/^TIMEOUT|CONNECTION|not connected|disconnected|Cannot send requests/i.test(m)){tgReset();return await fn(await conn())}
    throw e}
}
const wrap=fn=>async(...a)=>{try{return await fn(...a)}catch(e){console.error(e);const x=new Error(tgErrText(e));x.cause=e;throw x}};

/* ---------- libri ---------- */
const idx=new Map();   /* id libro → id del messaggio nel canale */
const fname=m=>(m.file&&m.file.name)||((m.document&&m.document.attributes)||[]).find(a=>a.className==='DocumentAttributeFilename')?.fileName||'';
const saveCache=l=>{try{localStorage.setItem('sb_cat',JSON.stringify(l))}catch(e){}};
function cached(){try{const l=JSON.parse(localStorage.getItem('sb_cat')||'[]');l.forEach(b=>idx.set(b.id,b.msg));return l}catch(e){return[]}}
async function _list({client,ent}){
  const ms=await withTimeout(client.getMessages(ent,{limit:3000}),90000,'TIMEOUT_LIST');
  const out=[];idx.clear();
  for(const m of ms){
    const name=fname(m);if(!/^b[0-9a-z]+\.json$/i.test(name))continue;
    const id=name.slice(0,-5),[t,a]=String(m.message||'').split('\n');
    out.push({id,title:t||id,author:a||'',added:(m.date||0)*1000,msg:m.id});idx.set(id,m.id);
  }
  saveCache(out);return out;
}
async function list(){
  for(;;){
    try{return await run(_list)}
    catch(e){
      if(e&&e.message==='NO_CONFIG')throw e;
      console.error(e);
      const r=await avviso('Telegram non raggiungibile',tgErrText(e),dettagli(e),'Riprova',true);
      if(r==='close')throw new Error(tgErrText(e));
    }
  }
}
async function get(id,onProgress){
  return run(async c=>{
    if(!idx.has(id))await _list(c);
    const mid=idx.get(id);if(!mid)throw new Error('Libro non trovato nel canale');
    const [m]=await c.client.getMessages(c.ent,{ids:[mid]});
    if(!m)throw new Error('Libro non trovato nel canale');
    const buf=await withTimeout(c.client.downloadMedia(m,{progressCallback:onProgress}),300000,'TIMEOUT_DOWNLOAD');
    return JSON.parse(new TextDecoder().decode(buf));
  });
}
async function put(b,onProgress){
  return run(async({client,tg,ent})=>{
    const body=JSON.stringify({title:b.title,author:b.author,chapters:b.chapters});
    const file=new File([body],b.id+'.json',{type:'application/json'});
    if(file.size>1.9e9)throw new Error('Libro troppo grande');
    const one=s=>String(s||'').replace(/\s+/g,' ').trim();
    const caption=one(b.title).slice(0,200)+'\n'+one(b.author).slice(0,120);
    const msg=await tgSendFile(tg,client,ent,file,p=>{if(onProgress)onProgress(typeof p==='number'?p:0)},caption);
    idx.set(b.id,msg.id);
    const l=cached().filter(x=>x.id!==b.id);l.push({id:b.id,title:b.title,author:b.author||'',added:b.added,msg:msg.id});saveCache(l);
  });
}
async function del(id){
  return run(async c=>{
    if(!idx.has(id))await _list(c);
    const mid=idx.get(id);
    if(mid)await c.client.deleteMessages(c.ent,[mid],{revoke:true});
    idx.delete(id);saveCache(cached().filter(x=>x.id!==id));
  });
}
async function logout(){
  try{const {client,tg}=await withTimeout(tgClient(),15000,'TIMEOUT');await withTimeout(client.invoke(new tg.Api.auth.LogOut()),10000,'TIMEOUT')}catch(e){}
  clearSession();try{localStorage.removeItem('sb_cat')}catch(e){}
  tgReset();location.reload();
}

window.SBTG={cached,list:wrap(list),get:wrap(get),put:wrap(put),del:wrap(del),logout};
window.dispatchEvent(new Event('sbtg-load'));
