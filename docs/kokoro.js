/* Voci offline con Kokoro-82M (sintesi neurale nel browser, senza server). Stessa interfaccia di piper.js.
   Componenti serviti dal tuo sito nella cartella kokoro/ (li prepara l'azione GitHub «Prepara Kokoro»):
     kokoro/kokoro.bundle.js   libreria (kokoro-js + trascrizione in fonemi)
     kokoro/ort/…              ONNX Runtime Web
   Il modello (circa 90 MB) e le voci si scaricano da Hugging Face una sola volta e restano nel browser. */
const BASE=new URL('./kokoro/',import.meta.url).href;
const PBASE=new URL('./piper/',import.meta.url).href;   /* fonemizzatore italiano (espeak-ng) di Piper */
const REPO='onnx-community/Kokoro-82M-v1.0-ONNX';
const CACHE='sb-kokoro-v1';
/* tabella id→fonema di Piper (piccola, uguale per tutte le voci espeak): serve a rileggere i fonemi dal fonemizzatore */
const MAPURL='https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/riccardo/x_low/it_IT-riccardo-x_low.onnx.json';
export const VOICES=[
  {id:'if_sara',nome:'Sara (Kokoro)',info:'femminile · modello circa 90 MB'},
  {id:'im_nicola',nome:'Nicola (Kokoro)',info:'maschile · modello circa 90 MB (condiviso con Sara)'}
];
export const label='Kokoro';
export const ok=()=>typeof WebAssembly==='object'&&typeof caches==='object'&&!!(window.AudioContext||window.webkitAudioContext);

const FILES=[[BASE,'kokoro.bundle.js'],[BASE,'ort/ort-wasm-simd-threaded.jsep.wasm'],[PBASE,'piper_phonemize.js'],[PBASE,'piper_phonemize.wasm'],[PBASE,'piper_phonemize.data']];
export async function check(){
  const miss=[];
  for(const [b,f] of FILES){
    try{const ac=new AbortController(),r=await fetch(b+f,{headers:{Range:'bytes=0-0'},signal:ac.signal});ac.abort();if(!r.ok)miss.push(f)}catch(e){miss.push(f)}
  }
  return miss;
}

/* controlla nelle cache del browser se modello e voce sono già stati scaricati */
async function cached(re){
  try{for(const k of await caches.keys()){const c=await caches.open(k);for(const r of await c.keys())if(re.test(r.url))return true}}catch(e){}
  return false;
}
export async function has(id){
  return (await cached(/Kokoro-82M.*\.onnx/i))&&(await cached(new RegExp('voices/'+id+'\\.bin')))&&(await hasMap());
}
export async function remove(id){
  try{for(const k of await caches.keys()){const c=await caches.open(k);for(const r of await c.keys())if(new RegExp('voices/'+id+'\\.bin').test(r.url))await c.delete(r)}}catch(e){}
}

let libP=null,tts=null;
const loadLib=()=>libP||(libP=(async()=>{
  const lib=await import(BASE+'kokoro.bundle.js');
  lib.env.allowLocalModels=false;lib.env.useBrowserCache=true;
  lib.env.backends.onnx.wasm.wasmPaths=BASE+'ort/';lib.env.backends.onnx.wasm.numThreads=1;
  return lib;
})().catch(e=>{libP=null;throw e}));
let proxyOn=true;   /* il calcolo gira in un worker: l’interfaccia non si congela; se non parte si ripiega sul calcolo diretto */
const limit=(p,ms)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('worker non risponde')),ms))]);
async function getTts(onProgress,id){
  if(tts)return tts;
  const lib=await loadLib(),{KokoroTTS}=lib;
  for(let tent=0;;tent++){
    lib.env.backends.onnx.wasm.proxy=proxyOn;
    const files={};
    const t=await KokoroTTS.from_pretrained(REPO,{dtype:'q8',device:'wasm',progress_callback:p=>{
      if(p&&p.status==='progress'&&p.total){files[p.file]={l:p.loaded,t:p.total};
        if(onProgress){let l=0,tt=0;for(const f in files){l+=files[f].l;tt+=files[f].t}onProgress(Math.min(1,l/tt))}}
    }});
    try{
      if(id){const {input_ids}=t.tokenizer('\u02C8a',{truncation:true});await limit(t.generate_from_ids(input_ids,{voice:id}),60000)}   /* prova rapida */
      tts=t;return t;
    }catch(e){
      if(proxyOn&&tent===0){proxyOn=false;continue}
      throw e;
    }
  }
}

export async function download(id,onProgress){
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
  await getMap();
  await getTts(onProgress,id);
  await synth(id,'Ciao.',1);          /* scarica anche il file della voce */
  if(onProgress)onProgress(1);
}

/* ---------- fonemi italiani (espeak-ng di Piper) ---------- */
let mapP=null;
async function hasMap(){
  for(const n of [CACHE,'sb-piper-v1']){try{const c=await caches.open(n);if(await c.match(MAPURL))return true}catch(e){}}
  return false;
}
function getMap(){
  return mapP||(mapP=(async()=>{
    let r=null;
    for(const n of [CACHE,'sb-piper-v1']){try{const c=await caches.open(n);r=await c.match(MAPURL);if(r)break}catch(e){}}
    if(!r){
      const f=await fetch(MAPURL);if(!f.ok)throw new Error('tabella dei fonemi non scaricabile (HTTP '+f.status+')');
      const t=await f.text();JSON.parse(t);
      try{const c=await caches.open(CACHE);await c.put(MAPURL,new Response(t,{headers:{'content-type':'application/json'}}))}catch(e){}
      r=new Response(t);
    }
    const cfg=await r.json(),inv={};
    for(const [ph,ids] of Object.entries(cfg.phoneme_id_map||{}))inv[ids[0]]=ph;
    return inv;
  })().catch(e=>{mapP=null;throw e}));
}
const loadScript=src=>new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('file non trovato: '+src));document.head.appendChild(s)});
let inst=null,uses=0,sink=[],errSink='';
async function getInst(){
  if(inst&&uses<40)return inst;
  inst=null;uses=0;
  if(typeof window.createPiperPhonemize!=='function')await loadScript(PBASE+'piper_phonemize.js');
  if(typeof window.createPiperPhonemize!=='function')throw new Error('fonemizzatore non valido');
  inst=await window.createPiperPhonemize({
    print:l=>sink.push(l),printErr:m=>{errSink+=m+'\n'},
    locateFile:u=>u.endsWith('.wasm')?PBASE+'piper_phonemize.wasm':u.endsWith('.data')?PBASE+'piper_phonemize.data':u
  });
  return inst;
}
/* testo → stringa di fonemi IPA (una frase dopo l'altra) */
async function phonemizeIt(text){
  const inv=await getMap();
  for(let tent=0;tent<2;tent++){
    const m=await getInst();sink=[];errSink='';uses++;
    try{m.callMain(['-l','it','--input',JSON.stringify([{text}]),'--espeak_data','/espeak-ng-data'])}catch(e){}
    const frasi=[];
    for(const l of sink){
      try{const j=JSON.parse(l);
        if(j&&j.phoneme_ids&&j.phoneme_ids.length)frasi.push(j.phoneme_ids.map(i=>i<=2?'':(inv[i]||'')).join(''))}catch(e){}
    }
    if(frasi.length)return frasi.map(f=>f.replace(/d\u0292/g,'\u02A4').replace(/t\u0283/g,'\u02A7').trim()).filter(Boolean);   /* una stringa per frase */
    inst=null;
  }
  throw new Error('fonemizzazione senza risultato'+(errSink?': '+errSink.slice(0,150):''));
}

let chain=Promise.resolve();
const GAP=.18;   /* pausa tra una frase e l'altra, in secondi */
/* il modello accetta circa 500 simboli: una frase molto lunga si spezza sugli spazi */
function pieces(fr){
  if(fr.length<=380)return[fr];
  const out=[];let cur='';
  for(const w of fr.split(' ')){if(cur&&(cur+' '+w).length>380){out.push(cur);cur=w}else cur=cur?cur+' '+w:w}
  if(cur)out.push(cur);return out;
}
/* text → {pcm:Float32Array, rate}; length>1 rallenta, <1 accelera (come in piper.js); raw=true: senza normalizzare il volume */
export function synth(id,text,length=1,raw=false){
  const run=async()=>{
    await loadLib();const t=await getTts(undefined,id);
    const frasi=await phonemizeIt(text),outs=[];let rate=24000,n=0;
    for(const fr of frasi)for(const p of pieces(fr)){
      const {input_ids}=t.tokenizer(p,{truncation:true});
      const a=await t.generate_from_ids(input_ids,{voice:id,speed:Math.min(2,Math.max(.5,1/length))});
      rate=a.sampling_rate||24000;
      const pcm=Float32Array.from(a.audio),gap=new Float32Array(Math.round(rate*GAP));
      outs.push(pcm,gap);n+=pcm.length+gap.length;
    }
    const pcm=new Float32Array(n);let o=0,peak=0;
    for(const x of outs){pcm.set(x,o);o+=x.length}
    if(!raw){
      for(let i=0;i<n;i++){const v=Math.abs(pcm[i]);if(v>peak)peak=v}
      if(peak>0){const g=Math.min(4,.85/peak);if(g!==1)for(let i=0;i<n;i++)pcm[i]*=g}
    }
    return{pcm,rate};
  };
  const p=chain.then(run,run);chain=p.catch(()=>{});return p;
}

/* ---------- audiolibro: si genera una volta sola e si conserva sul dispositivo (archivio del browser) ---------- */
const KDB='sb-kokoro-audio';
let dbP=null;
const kdb=()=>dbP||(dbP=new Promise((res,rej)=>{const r=indexedDB.open(KDB,1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}));
const kget=async key=>{const d=await kdb();return new Promise((res,rej)=>{const q=d.transaction('kv').objectStore('kv').get(key);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})};
const kset=async(key,v)=>{const d=await kdb();return new Promise((res,rej)=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').put(v,key);t.oncomplete=res;t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||new Error('spazio insufficiente sul dispositivo'))})};
const kkey=(b,n)=>b+'|'+n;
/* il file del capitolo c'è già sul dispositivo? */
export const kaudHas=async(b,n)=>{try{return !!(await kget(kkey(b,n)))}catch(e){return false}};
export const kaudGet=(b,n)=>kget(kkey(b,n));
export const kaudPut=(b,n,blob)=>kset(kkey(b,n),blob);
export async function kaudRemove(b){
  const d=await kdb();
  return new Promise((res,rej)=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').delete(IDBKeyRange.bound(b+'|',b+'|\uffff'));t.oncomplete=res;t.onerror=()=>rej(t.error)});
}
/* 'mp3' se il compressore è nel pacchetto compilato, altrimenti 'wav' (molto più pesante) */
export async function encoder(){try{return (await loadLib()).Mp3Encoder?'mp3':'wav'}catch(e){return 'wav'}}

const toI16=pcm=>{const o=new Int16Array(pcm.length);for(let i=0;i<pcm.length;i++){const v=Math.max(-1,Math.min(1,pcm[i]));o[i]=v<0?v*32768:v*32767}return o};
/* items: [{t:testo, r:velocità, sil:pausa dopo in secondi}] → Blob audio del capitolo, oppure null se interrotto */
export async function renderChapter(id,items,{onProgress,stop}={}){
  const lib=await loadLib();
  let enc=null,rate=0;const parts=[];
  const put=i16=>{
    if(!enc&&!parts.wav&&lib.Mp3Encoder){enc=new lib.Mp3Encoder(1,rate,64)}
    if(enc){for(let o=0;o<i16.length;o+=1152*16){const b=enc.encodeBuffer(i16.subarray(o,o+1152*16));if(b.length)parts.push(new Uint8Array(b))}}
    else parts.push(i16);
  };
  const total=items.reduce((a,i)=>a+i.t.length,0)||1;let done=0;
  for(const it of items){
    if(stop&&stop())return null;
    let r;
    try{r=await synth(id,it.t,1/Math.max(.4,it.r||1),true)}
    catch(e){if(!/^fonemizzazione senza risultato/.test((e&&e.message)||''))throw e}   /* testo senza parole: solo pausa */
    if(r){if(!rate)rate=r.rate;put(toI16(r.pcm))}
    if(rate&&it.sil>0)put(new Int16Array(Math.round(it.sil*rate)));
    done+=it.t.length;if(onProgress)onProgress(Math.min(1,done/total));
    await new Promise(res=>setTimeout(res,0));   /* lascia respirare l'interfaccia */
  }
  if(!rate)return new Blob([],{type:'audio/mpeg'});
  if(enc){const e=enc.flush();if(e.length)parts.push(new Uint8Array(e));return new Blob(parts,{type:'audio/mpeg'})}
  const len=parts.reduce((a,x)=>a+x.length,0),h=new DataView(new ArrayBuffer(44));
  const w=(o,s)=>{for(let i=0;i<s.length;i++)h.setUint8(o+i,s.charCodeAt(i))};
  w(0,'RIFF');h.setUint32(4,36+len*2,true);w(8,'WAVE');w(12,'fmt ');h.setUint32(16,16,true);h.setUint16(20,1,true);h.setUint16(22,1,true);
  h.setUint32(24,rate,true);h.setUint32(28,rate*2,true);h.setUint16(32,2,true);h.setUint16(34,16,true);w(36,'data');h.setUint32(40,len*2,true);
  return new Blob([h.buffer,...parts],{type:'audio/wav'});
}

window.KOKORO={VOICES,label,ok,check,has,remove,download,synth,kaudHas,kaudGet,kaudPut,kaudRemove,renderChapter,encoder};
window.dispatchEvent(new Event('kokoro-load'));
