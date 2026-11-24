/* Telegram dal browser (MTProto, libreria gramjs compilata in telegram-lib.js).
   Adattato dal progetto carmamedical. */
import {TG_API_ID,TG_API_HASH,TG_CHANNEL} from "./telegram-config.js";
export const consoleLog=[];
for(const k of ['log','info','warn','error','debug']){const o=console[k];console[k]=(...a)=>{try{consoleLog.push(k+': '+a.map(x=>x&&x.message?x.message:typeof x==='object'?JSON.stringify(x):String(x)).join(' ').slice(0,300));if(consoleLog.length>60)consoleLog.shift()}catch(e){}return o.apply(console,a)}}
const ok=v=>typeof v==="string"||typeof v==="number"?String(v).trim()!==""&&String(v).trim()!=="INSERISCI":false;
export const credsOk=()=>ok(TG_API_ID)&&ok(TG_API_HASH)&&!isNaN(Number(String(TG_API_ID).trim()));
export const tgConfigured=()=>credsOk()&&ok(TG_CHANNEL);
export const hasSession=()=>{try{return !!localStorage.getItem('sb_tg_session')}catch(e){return false}};
export const clearSession=()=>{try{localStorage.removeItem('sb_tg_session')}catch(e){}};
const saveSession=s=>{try{localStorage.setItem('sb_tg_session',s)}catch(e){}};
const getSession=()=>{try{return localStorage.getItem('sb_tg_session')||''}catch(e){return ''}};
export const withTimeout=(p,ms,msg)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error(msg||'TIMEOUT')),ms))]);

/* La libreria locale viene provata per prima; gli altri indirizzi sono di ripiego. */
export const SOURCES=[
  "./telegram-lib.js",
  "https://cdn.jsdelivr.net/npm/telegram@2.26.22/+esm",
  "https://esm.sh/telegram@2.26.22?bundle"
];
export let libSource='';
let libP=null;
/* Buffer e process servono a gramjs: se mancano si prova a prenderli da esm.sh, ma un errore qui non blocca */
export let shimError='';
async function ensureShims(log){
  if(typeof globalThis.Buffer==='undefined'){
    for(const u of ["https://esm.sh/buffer@6.0.3","https://esm.sh/buffer"]){
      try{const m=await withTimeout(import(u),20000,'timeout');globalThis.Buffer=m.Buffer||(m.default&&m.default.Buffer);if(globalThis.Buffer){log('Buffer disponibile');break}}
      catch(e){shimError=(e&&e.message)||String(e)}
    }
  }
  if(typeof globalThis.process==='undefined')globalThis.process={env:{},browser:true,version:'',versions:{},argv:[],nextTick:(f,...a)=>queueMicrotask(()=>f(...a))};
  if(typeof globalThis.global==='undefined')globalThis.global=globalThis;
}
export function loadTg(log=()=>{}){
  if(libP)return libP;
  libP=(async()=>{
    await ensureShims(log);
    const errs=[];
    for(const u of SOURCES){
      try{
        log('Carico la libreria: '+u);
        const m=await withTimeout(import(u),60000,'timeout caricamento libreria');
        const tg=m.TelegramClient?m:(m.default&&m.default.TelegramClient?m.default:null);
        if(!tg)throw new Error('modulo senza TelegramClient');
        if(!tg.sessions||!tg.sessions.StringSession)throw new Error('modulo senza sessions.StringSession');
        libSource=u;log('Libreria caricata');return tg;
      }catch(e){errs.push(u+' → '+(e&&e.message||e));log('Non riuscito: '+(e&&e.message||e))}
    }
    const e=new Error('LIB_LOAD');e.details=errs;throw e;
  })();
  libP.catch(()=>{libP=null});
  return libP;
}
export function newClient(tg,saved){
  return new tg.TelegramClient(new tg.sessions.StringSession(saved||''),Number(String(TG_API_ID).trim()),String(TG_API_HASH).trim(),
    {connectionRetries:3,useWSS:true,deviceModel:'Storybooks',appVersion:'1.0'});
}
/* Accesso con numero e codice (come in carmamedical).
   ui = {phone(), code(), password(), info(testo)}: restituiscono una Promise<string>. */
export async function tgLogin(tg,client,ui,log=()=>{}){
  const creds={apiId:Number(String(TG_API_ID).trim()),apiHash:String(TG_API_HASH).trim()};
  const phone=(await ui.phone()).trim();
  log('Invio del numero a Telegram');
  const sent=await withTimeout(client.sendCode(creds,phone,false),40000,'TIMEOUT_SENDCODE');
  log('Codice inviato'+(sent.isCodeViaApp?' (nell’app Telegram)':' (via SMS o chiamata)'));
  let done=false,tries=0;
  while(!done&&tries<3){
    const code=await ui.code();
    if(code==='__SMS__'){
      try{
        const r=await withTimeout(client.invoke(new tg.Api.auth.ResendCode({phoneNumber:phone,phoneCodeHash:sent.phoneCodeHash})),40000,'TIMEOUT_SENDCODE');
        if(r&&r.phoneCodeHash)sent.phoneCodeHash=r.phoneCodeHash;
        const t=(r&&r.type&&r.type.className)||'',via=/Sms/.test(t)?'SMS':/Call/.test(t)?'chiamata':'app Telegram';
        if(ui.info)ui.info('Richiesta inviata: attendi il codice ('+via+').')
      }catch(e){
        const m=(e&&(e.errorMessage||e.message))||'';
        if(ui.info)ui.info(/SEND_CODE_UNAVAILABLE/.test(m)?'Telegram non permette altri invii per ora: aspetta qualche minuto.':/FLOOD/.test(m)?'Troppi tentativi: aspetta qualche minuto.':'Reinvio non riuscito ('+m+').')}
      continue}
    tries++;
    try{
      const r=await withTimeout(client.invoke(new tg.Api.auth.SignIn({phoneNumber:phone,phoneCodeHash:sent.phoneCodeHash,phoneCode:code})),40000,'TIMEOUT_SIGNIN');
      if(tg.Api.auth.AuthorizationSignUpRequired&&r instanceof tg.Api.auth.AuthorizationSignUpRequired)throw new Error('ACCOUNT_NOT_REGISTERED');
      done=true;
    }catch(e){
      const m=(e&&(e.errorMessage||e.message))||'';
      if(/SESSION_PASSWORD_NEEDED/.test(m)){
        log('Serve la password a due fattori');
        let last=null;
        try{await withTimeout(client.signInWithPassword(creds,{password:ui.password,onError:async er=>{last=er;return true}}),600000,'TIMEOUT_PASSWORD')}
        catch(e2){throw last||e2}
        done=true;
      }else if(/PHONE_CODE_INVALID/.test(m)&&tries<3){if(ui.info)ui.info('Codice non valido, riprova.')}
      else throw e;
    }
  }
  saveSession(client.session.save());
}

let cache=null;
export function tgClient(){
  if(cache)return cache;
  cache=(async()=>{
    if(!credsOk())throw new Error('NO_CONFIG');
    if(!hasSession())throw new Error('NO_SESSION');
    const tg=await loadTg();
    const client=newClient(tg,getSession());
    await withTimeout(client.connect(),30000,'TIMEOUT_CONNECT');
    if(!(await checkAuth(client,true))){clearSession();throw new Error('NO_SESSION')}
    return {client,tg};
  })();
  cache.catch(()=>{cache=null});
  return cache;
}
/* Chiude la connessione (anche se è rimasta appesa): la prossima richiesta ne apre una nuova. */
export function tgReset(){
  const c=cache;cache=null;ent=null;
  if(c)c.then(r=>{try{const p=r.client.disconnect();if(p&&p.catch)p.catch(()=>{})}catch(e){}},()=>{})}
const norm=s=>String(s||'').trim().toLowerCase();
/* Il gruppo o canale si trova per nome (o per ID numerico, se scritto in TG_CHANNEL) tra le chat dell'account */
export async function findDialog(client,name){
  const n=norm(name).replace(/^@/,'').replace(/\s+/g,' '),num=n.replace(/^-100/,'');
  const tit=x=>norm(x.title).replace(/\s+/g,' ');
  /* chat principali + archiviate (un gruppo archiviato non compare nell'elenco normale) */
  const ds=[];
  for(const folder of [0,1]){
    try{ds.push(...await withTimeout(client.getDialogs({limit:600,...(folder?{folder}:{})}),30000,'TIMEOUT_DIALOGS'))}
    catch(e){if(!folder)throw e}
  }
  let d=ds.find(x=>tit(x)===n||(x.entity&&x.entity.username&&norm(x.entity.username)===n)||String(x.id)===n||(x.entity&&String(x.entity.id)===num));
  if(!d){const p=ds.filter(x=>tit(x).includes(n));if(p.length===1)d=p[0]}   /* nome quasi uguale: se ce n'è una sola, è quella */
  return {dialog:d||null,titles:ds.map(x=>x.title).filter(Boolean)};
}
let ent=null;
export function tgEntity(){
  if(!ent){
    ent=(async()=>{
      const {client}=await tgClient();
      const {dialog,titles}=await findDialog(client,TG_CHANNEL);
      if(!dialog){const e=new Error('NO_CHAT');e.titles=titles;throw e}
      return dialog.entity;
    })();
    ent.catch(()=>{ent=null});
  }
  return ent;
}
export function tgErrText(e){
  const m=(e&&e.message)||String(e);
  if(m==='NO_CONFIG')return 'Configurazione Telegram incompleta: scrivi api_id e api_hash in telegram-config.js.';
  if(m==='NO_SESSION')return 'Non hai effettuato l’accesso a Telegram.';
  if(m==='NO_CHAT')return 'Gruppo o canale «'+TG_CHANNEL+'» non trovato: il nome deve coincidere con quello su Telegram e l’account deve farne parte.'+(e.titles&&e.titles.length?' Chat trovate: '+e.titles.slice(0,12).join(', ')+'.':'');
  if(m==='LIB_LOAD')return 'Impossibile caricare la libreria Telegram (telegram-lib.js). '+((e.details||[]).join(' | '));
  if(/^TIMEOUT/.test(m))return 'Telegram non risponde (timeout). Controlla la connessione, o che la rete non blocchi i WebSocket verso Telegram.';
  if(/API_ID_INVALID/.test(m))return 'api_id o api_hash non validi: ricontrolla i valori su my.telegram.org.';
  if(/API_ID_PUBLISHED_FLOOD/.test(m))return 'Telegram ha bloccato queste credenziali API: serve registrarne di nuove su my.telegram.org.';
  if(/PHONE_NUMBER_INVALID/.test(m))return 'Numero di telefono non valido: usa il prefisso internazionale (es. +39…).';
  if(/PHONE_CODE_INVALID|PHONE_CODE_EMPTY/.test(m))return 'Codice non valido.';
  if(/PHONE_CODE_EXPIRED/.test(m))return 'Codice scaduto: riprova l’accesso.';
  if(/PASSWORD_HASH_INVALID/.test(m))return 'Password a due fattori errata.';
  if(/FLOOD/.test(m))return 'Troppi tentativi: Telegram chiede di attendere ('+m+').';
  if(/CHAT_ADMIN_REQUIRED|CHAT_WRITE_FORBIDDEN|CHANNEL_PRIVATE/.test(m))return 'L’account non ha i permessi sul gruppo: deve esserne proprietario o amministratore. ('+m+')';
  return m;
}
/* Invio di un file nel canale (stessa tecnica di carmamedical: il File del browser con una "read" fittizia). */
export async function tgSendFile(tg,client,entity,file,onProgress,caption){
  const base={caption:caption||file.name,forceDocument:true,workers:3,progressCallback:onProgress,silent:true};
  if(typeof file.read!=='function'){try{Object.defineProperty(file,'read',{value:()=>{},configurable:true})}catch(e){}}
  return client.sendFile(entity,{...base,file});
}
export let tgMe=null;   /* account con cui si è collegati (per mostrarlo accanto a «Esci») */
export async function checkAuth(client,hadSession){
  if(!hadSession)return false;
  try{tgMe=await withTimeout(client.getMe(),30000,'TIMEOUT_AUTH');return true}catch(e){return false}
}
