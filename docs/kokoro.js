/* Voci offline con Kokoro-82M (sintesi neurale nel browser, senza server). Stessa interfaccia di piper.js.
   Componenti serviti dal tuo sito nella cartella kokoro/ (li prepara l'azione GitHub «Prepara Kokoro»):
     kokoro/kokoro.bundle.js   libreria (kokoro-js + trascrizione in fonemi)
     kokoro/ort/…              ONNX Runtime Web
   Il modello (circa 90 MB) e le voci si scaricano da Hugging Face una sola volta e restano nel browser. */
const BASE=new URL('./kokoro/',import.meta.url).href;
const REPO='onnx-community/Kokoro-82M-v1.0-ONNX';
export const VOICES=[
  {id:'if_sara',nome:'Sara (Kokoro)',info:'femminile · modello circa 90 MB'},
  {id:'im_nicola',nome:'Nicola (Kokoro)',info:'maschile · modello circa 90 MB (condiviso con Sara)'}
];
export const label='Kokoro';
export const ok=()=>typeof WebAssembly==='object'&&typeof caches==='object'&&!!(window.AudioContext||window.webkitAudioContext);

const FILES=['kokoro.bundle.js','ort/ort-wasm-simd-threaded.jsep.wasm'];
export async function check(){
  const miss=[];
  for(const f of FILES){
    try{const ac=new AbortController(),r=await fetch(BASE+f,{headers:{Range:'bytes=0-0'},signal:ac.signal});ac.abort();if(!r.ok)miss.push(f)}catch(e){miss.push(f)}
  }
  return miss;
}

/* controlla nelle cache del browser se modello e voce sono già stati scaricati */
async function cached(re){
  try{for(const k of await caches.keys()){const c=await caches.open(k);for(const r of await c.keys())if(re.test(r.url))return true}}catch(e){}
  return false;
}
export async function has(id){
  return (await cached(/Kokoro-82M.*\.onnx/i))&&(await cached(new RegExp('voices/'+id+'\\.bin')));
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
  await getTts(onProgress);
  await synth(id,'Ciao.',1);          /* scarica anche il file della voce */
  if(onProgress)onProgress(1);
}

let chain=Promise.resolve();
/* text → {pcm:Float32Array, rate}; length>1 rallenta, <1 accelera (come in piper.js) */
export function synth(id,text,length=1){
  const run=async()=>{
    const lib=await loadLib(),t=await getTts();
    const ph=(await lib.phonemize(text,'it')).join(' ').trim();
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
