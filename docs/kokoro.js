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
async function getTts(onProgress){
  if(tts)return tts;
  const {KokoroTTS}=await loadLib(),files={};
  tts=await KokoroTTS.from_pretrained(REPO,{dtype:'q8',device:'wasm',progress_callback:p=>{
    if(p&&p.status==='progress'&&p.total){files[p.file]={l:p.loaded,t:p.total};
      if(onProgress){let l=0,t=0;for(const f in files){l+=files[f].l;t+=files[f].t}onProgress(Math.min(1,l/t))}}
  }}).catch(e=>{tts=null;throw e});
  return tts;
}

export async function download(id,onProgress){
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
  await getMap();
  await getTts(onProgress);
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
    if(frasi.length)return frasi.join(' ').replace(/d\u0292/g,'\u02A4').replace(/t\u0283/g,'\u02A7').trim();
    inst=null;
  }
  throw new Error('fonemizzazione senza risultato'+(errSink?': '+errSink.slice(0,150):''));
}

let chain=Promise.resolve();
/* text → {pcm:Float32Array, rate}; length>1 rallenta, <1 accelera (come in piper.js) */
export function synth(id,text,length=1){
  const run=async()=>{
    await loadLib();const t=await getTts();
    const ph=await phonemizeIt(text);
    if(!ph)throw new Error('nessun fonema per il testo');
    const {input_ids}=t.tokenizer(ph,{truncation:true});
    const a=await t.generate_from_ids(input_ids,{voice:id,speed:Math.min(2,Math.max(.5,1/length))});
    const pcm=Float32Array.from(a.audio),rate=a.sampling_rate||24000;
    let peak=0;for(let i=0;i<pcm.length;i++){const v=Math.abs(pcm[i]);if(v>peak)peak=v}
    if(peak>0){const g=Math.min(4,.85/peak);if(g!==1)for(let i=0;i<pcm.length;i++)pcm[i]*=g}
    return{pcm,rate};
  };
  const p=chain.then(run,run);chain=p.catch(()=>{});return p;
}
window.KOKORO={VOICES,label,ok,check,has,remove,download,synth};
window.dispatchEvent(new Event('kokoro-load'));
