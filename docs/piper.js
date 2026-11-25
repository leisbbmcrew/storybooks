/* Voci offline con Piper (sintesi neurale che gira nel browser, senza server).
   Componenti, tutti serviti dal tuo sito nella cartella piper/ (li prepara l'azione GitHub «Prepara Piper»):
     piper/ort/…            ONNX Runtime Web (esegue il modello)
     piper/piper_phonemize.* trascrive il testo in fonemi (espeak-ng)
   Il modello della voce (decine di MB) si scarica una sola volta da Hugging Face e resta nel browser (Cache Storage). */
const BASE=new URL('./piper/',import.meta.url).href;
const HF='https://huggingface.co/rhasspy/piper-voices/resolve/main/';
const CACHE='sb-piper-v1';
export const VOICES=[
  {id:'it_IT-paola-medium',nome:'Paola',info:'qualità media · circa 64 MB',path:'it/it_IT/paola/medium/it_IT-paola-medium',size:63511038},
  {id:'it_IT-riccardo-x_low',nome:'Riccardo',info:'più leggera e veloce · circa 28 MB',path:'it/it_IT/riccardo/x_low/it_IT-riccardo-x_low',size:28130791}
];
const voiceOf=id=>VOICES.find(v=>v.id===id);
const urls=id=>{const v=voiceOf(id);if(!v)throw new Error('Voce Piper sconosciuta: '+id);return{model:HF+v.path+'.onnx',json:HF+v.path+'.onnx.json',size:v.size}};
export const ok=()=>typeof WebAssembly==='object'&&typeof caches==='object'&&!!(window.AudioContext||window.webkitAudioContext);

/* ---------- controllo dei componenti ---------- */
const FILES=['ort/ort.min.js','piper_phonemize.js','piper_phonemize.wasm','piper_phonemize.data'];
/* restituisce l'elenco dei file mancanti (vuoto = tutto a posto) */
export async function check(){
  const miss=[];
  for(const f of FILES){
    /* richiesta di 1 byte (Range) e subito interrotta: funziona anche offline grazie alla cache del service worker */
    try{const ac=new AbortController(),r=await fetch(BASE+f,{headers:{Range:'bytes=0-0'},signal:ac.signal});ac.abort();if(!r.ok)miss.push(f)}catch(e){miss.push(f)}
  }
  return miss;
}

/* ---------- modelli (Cache Storage) ---------- */
export async function has(id){
  try{const u=urls(id),c=await caches.open(CACHE);return !!(await c.match(u.model))&&!!(await c.match(u.json))}catch(e){return false}
}
export async function remove(id){
  const u=urls(id),c=await caches.open(CACHE);await c.delete(u.model);await c.delete(u.json);sess.delete(id);
}
/* scarica il modello con avanzamento (0..1) e lo conserva nel browser */
export async function download(id,onProgress){
  const u=urls(id),c=await caches.open(CACHE);
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
  const rj=await fetch(u.json);if(!rj.ok)throw new Error('configurazione non scaricabile (HTTP '+rj.status+')');
  const cfg=await rj.clone().text();JSON.parse(cfg);
  const r=await fetch(u.model);if(!r.ok||!r.body)throw new Error('modello non scaricabile (HTTP '+r.status+')');
  const total=+r.headers.get('content-length')||u.size,rd=r.body.getReader(),parts=[];let got=0;
  for(;;){const {done,value}=await rd.read();if(done)break;parts.push(value);got+=value.length;if(onProgress)onProgress(Math.min(1,got/total))}
  if(got<1e6)throw new Error('modello incompleto ('+got+' byte)');
  await c.put(u.model,new Response(new Blob(parts),{headers:{'content-type':'application/octet-stream'}}));
  await c.put(u.json,new Response(cfg,{headers:{'content-type':'application/json'}}));
  if(onProgress)onProgress(1);
}

/* ---------- caricamento dei componenti ---------- */
const loadScript=src=>new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('file non trovato: '+src));document.head.appendChild(s)});
let ortP=null;
const loadOrt=()=>ortP||(ortP=(async()=>{
  if(!window.ort)await loadScript(BASE+'ort/ort.min.js');
  const ort=window.ort;if(!ort||!ort.InferenceSession)throw new Error('ONNX Runtime non valido');
  ort.env.wasm.wasmPaths=BASE+'ort/';ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
  return ort;
})().catch(e=>{ortP=null;throw e}));
let phP=null;
const loadPh=()=>phP||(phP=(async()=>{
  if(typeof window.createPiperPhonemize!=='function')await loadScript(BASE+'piper_phonemize.js');
  if(typeof window.createPiperPhonemize!=='function')throw new Error('fonemizzatore non valido');
  return window.createPiperPhonemize;
})().catch(e=>{phP=null;throw e}));

/* ---------- fonemizzazione ---------- */
let inst=null,uses=0,sink=[],errSink='';
async function getInst(){
  if(inst&&uses<40)return inst;     /* ogni tanto si ricrea l'istanza per non accumulare memoria */
  inst=null;uses=0;
  const create=await loadPh();
  inst=await create({
    print:l=>sink.push(l),printErr:m=>{errSink+=m+'\n'},
    locateFile:u=>u.endsWith('.wasm')?BASE+'piper_phonemize.wasm':u.endsWith('.data')?BASE+'piper_phonemize.data':u
  });
  return inst;
}
async function phonemize(text,espeakVoice){
  for(let tent=0;tent<2;tent++){
    const m=await getInst();sink=[];errSink='';uses++;
    try{m.callMain(['-l',espeakVoice,'--input',JSON.stringify([{text}]),'--espeak_data','/espeak-ng-data'])}catch(e){}
    const ids=[];
    for(const l of sink){try{const j=JSON.parse(l);if(j&&j.phoneme_ids&&j.phoneme_ids.length)ids.push(j.phoneme_ids)}catch(e){}}
    if(ids.length)return ids;      /* una riga per frase */
    inst=null;                      /* nessun risultato: ricrea l'istanza e riprova una volta */
  }
  throw new Error('fonemizzazione senza risultato'+(errSink?': '+errSink.slice(0,150):''));
}

/* ---------- modello e sintesi ---------- */
const sess=new Map();   /* id voce → {session,cfg} */
async function getSession(id){
  if(sess.has(id))return sess.get(id);
  const ort=await loadOrt(),u=urls(id),c=await caches.open(CACHE);
  const [m,j]=await Promise.all([c.match(u.model),c.match(u.json)]);
  if(!m||!j)throw new Error('voce non scaricata');
  const cfg=await j.json();
  const session=await ort.InferenceSession.create(new Uint8Array(await m.arrayBuffer()),{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  sess.clear();const s={session,cfg};sess.set(id,s);return s;
}
let chain=Promise.resolve();   /* una sintesi alla volta */
/* text → {pcm:Float32Array, rate}; length>1 rallenta, <1 accelera */
export function synth(id,text,length=1){
  const run=async()=>{
    const ort=await loadOrt(),{session,cfg}=await getSession(id);
    const rate=cfg.audio&&cfg.audio.sample_rate||22050,inf=cfg.inference||{};
    const idsList=await phonemize(text,(cfg.espeak&&cfg.espeak.voice)||'it');
    const gap=new Float32Array(Math.round(rate*.2)),outs=[];let n=0;
    for(const ids of idsList){
      const feeds={
        input:new ort.Tensor('int64',BigInt64Array.from(ids,x=>BigInt(x)),[1,ids.length]),
        input_lengths:new ort.Tensor('int64',BigInt64Array.from([BigInt(ids.length)]),[1]),
        scales:new ort.Tensor('float32',Float32Array.from([inf.noise_scale??.667,(inf.length_scale??1)*length,inf.noise_w??.8]),[3])
      };
      if((cfg.num_speakers||1)>1)feeds.sid=new ort.Tensor('int64',BigInt64Array.from([0n]),[1]);
      const res=await session.run(feeds),t=res.output||Object.values(res)[0];
      if(!t||!t.data)throw new Error('il modello non ha prodotto audio');
      outs.push(t.data,gap);n+=t.data.length+gap.length;
    }
    const pcm=new Float32Array(n);let o=0,peak=0;
    for(const a of outs){pcm.set(a,o);o+=a.length}
    for(let i=0;i<n;i++){const v=Math.abs(pcm[i]);if(v>peak)peak=v}
    if(peak>0){const g=Math.min(4,.85/peak);if(g!==1)for(let i=0;i<n;i++)pcm[i]*=g}   /* volume omogeneo, senza distorsione */
    return{pcm,rate};
  };
  const p=chain.then(run,run);chain=p.catch(()=>{});return p;
}
window.PIPER={VOICES,ok,check,has,remove,download,synth};
window.dispatchEvent(new Event('piper-load'));
