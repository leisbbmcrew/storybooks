/* Storybooks – interfaccia, lettore e importazione. Il database (Telegram) è in storage.js, le voci offline in piper.js e kokoro.js. */
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){}return null}
const ic=(n,c='')=>`<svg class="ic ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const nrm=t=>String(t==null?'':t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
let books=[],cur=null,segs=[],si=0,ci=0,playing=false,tok=0;
let speed=+(ls('sb_speed')||1),voiceName=ls('sb_voice')||'',voices=[];
let view='home',q='',fg='',fd='',lf='all',sortBy=ls('sb_sort')||'recent';

/* ---------- accesso ai dati ---------- */
const sbReady=()=>window.SBTG?Promise.resolve():new Promise(r=>addEventListener('sbtg-load',r,{once:true}));
const dbPut=async b=>{await sbReady();return SBTG.put(b,p=>toast('Carico «'+b.title+'»… '+Math.round(p*100)+'%'))};
const dbGet=async id=>{await sbReady();return SBTG.get(id)};
const dbDel=async id=>{await sbReady();return SBTG.del(id)};
const prog=id=>{try{return JSON.parse(ls('sb_p_'+id))||{}}catch(e){return{}}};
const isFin=id=>(prog(id).pc||0)>=.98;
function save(){
  if(!cur)return;
  const am=useAudio(),fr=am?(au.duration?aT/au.duration:0):si/Math.max(1,segs.length);
  ls('sb_p_'+cur.id,JSON.stringify({ch:ci,si:am?0:si,at:am?aT:0,pc:Math.min(1,(ci+fr)/cur.chapters.length)}));
}
function toast(t){const e=$('#toast');e.textContent=t;e.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>e.style.display='none',Math.max(2600,t.length*55))}

/* ---------- formati ---------- */
const fmtMB=n=>n>=1e9?(n/1e9).toFixed(1).replace('.',',')+' GB':n>=1e6?(n/1e6).toFixed(1).replace('.',',')+' MB':Math.max(1,Math.round(n/1e3))+' KB';
const fmtDur=m=>!m?'':m<60?m+' min':Math.floor(m/60)+' h'+(m%60?' '+String(m%60).padStart(2,'0')+' min':'');
const estMin=ch=>{let w=0;for(const c of ch)for(const p of c.p)w+=(p.match(/\S+/g)||[]).length;return Math.max(1,Math.round(w/150))};   /* ~150 parole al minuto a velocità 1× */
const detectLang=ch=>{const t=ch.slice(0,3).map(c=>c.p.slice(0,20).join(' ')).join(' ').toLowerCase().slice(0,6000);
  const it=(t.match(/\b(il|lo|la|di|che|non|per|con|una|del|della|sono|era|gli|le)\b/g)||[]).length,en=(t.match(/\b(the|and|of|to|was|that|with|for|his|her|you)\b/g)||[]).length;return en>it?'en':'it'};
const remaining=b=>{const pc=prog(b.id).pc||0;return b.minutes?Math.max(1,Math.round(b.minutes*(1-pc)/speed)):0};

/* ---------- importazione (EPUB, TXT, HTML, Markdown) ---------- */
const norm=s=>s.replace(/\s+/g,' ').trim();
let zipP=null;   /* JSZip si carica solo quando serve (primo EPUB), non a ogni avvio */
const loadZip=()=>window.JSZip?Promise.resolve():(zipP||(zipP=new Promise((res,rej)=>{
  const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  s.onload=res;s.onerror=()=>{zipP=null;rej(new Error('lettore EPUB non caricabile: serve internet'))};document.head.appendChild(s);
})));
function chunkText(txt){
  const ps=txt.replace(/\r/g,'').split(/\n+/).map(norm).filter(Boolean),chs=[];let c={t:'Parte 1',p:[]},n=0;
  const push=()=>{if(c.p.length)chs.push(c)};
  for(const p of ps){
    const isH=/^(capitolo|chapter|parte|libro)\b/i.test(p)&&p.length<70;
    if(isH||n>6000){
      if(c.p.length){push();c={t:isH?p:'Parte '+(chs.length+1),p:[]};n=0}
      else if(isH)c.t=p;
    }
    c.p.push(p);n+=p.length;
  }
  push();return chs;
}
const resolvePath=(dir,h)=>{const out=[];(dir+decodeURIComponent(h.split('#')[0])).split('/').forEach(x=>x==='..'?out.pop():x!=='.'&&out.push(x));return out.join('/')};
async function parseEpub(f){
  await loadZip();
  const z=await JSZip.loadAsync(f),dp=new DOMParser(),rd=async p=>{const e=z.file(p);return e?e.async('string'):''};
  const cont=dp.parseFromString(await rd('META-INF/container.xml'),'application/xml');
  const opfP=cont.querySelector('rootfile').getAttribute('full-path'),dir=opfP.replace(/[^/]*$/,'');
  const opf=dp.parseFromString(await rd(opfP),'application/xml');
  const g=t=>{const e=opf.getElementsByTagName(t)[0];return e?norm(e.textContent):''};
  const man={};[...opf.getElementsByTagName('item')].forEach(i=>man[i.getAttribute('id')]=i.getAttribute('href'));
  const chs=[];let k=0;
  for(const r of opf.getElementsByTagName('itemref')){
    const h=man[r.getAttribute('idref')];if(!h)continue;
    const d=dp.parseFromString(await rd(resolvePath(dir,h)),'text/html');
    d.querySelectorAll('script,style,sup.noteref').forEach(e=>e.remove());
    const ps=[...d.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li')].map(e=>norm(e.textContent)).filter(Boolean);
    if(ps.join(' ').length<150)continue;
    const hd=d.querySelector('h1,h2,h3');k++;
    chs.push({t:hd?norm(hd.textContent).slice(0,70):'Capitolo '+k,p:ps});
  }
  let embedded=null;
  try{
    const it=[...opf.getElementsByTagName('item')],img=i=>/^image\//.test(i.getAttribute('media-type')||'');
    const meta=[...opf.getElementsByTagName('meta')].find(m=>m.getAttribute('name')==='cover');
    const e=it.find(i=>(i.getAttribute('properties')||'').split(/\s+/).includes('cover-image'))||(meta&&it.find(i=>i.getAttribute('id')===meta.getAttribute('content')&&img(i)))||it.find(i=>/cover/i.test((i.getAttribute('id')||'')+(i.getAttribute('href')||''))&&img(i));
    const zf=e&&z.file(resolvePath(dir,e.getAttribute('href')));
    if(zf)embedded=new Blob([await zf.async('uint8array')],{type:e.getAttribute('media-type')||'image/jpeg'});
  }catch(e){}
  return{title:g('dc:title'),author:g('dc:creator'),chapters:chs,embedded};
}
async function addFile(f){
  const ext=f.name.split('.').pop().toLowerCase(),base=f.name.replace(/\.[^.]+$/,'');
  let b;
  try{
    if(ext==='epub')b=await parseEpub(f);
    else{
      let t=await f.text();
      if(ext==='html'||ext==='htm'){const d=new DOMParser().parseFromString(t,'text/html');t=[...d.querySelectorAll('p,h1,h2,h3,li')].map(e=>e.textContent).join('\n')}
      b={title:base,author:'',chapters:chunkText(t)};
    }
    if(!b.chapters.length)throw new Error('nessun testo trovato');
    b.title=b.title||base;
    if(books.some(x=>nrm(x.title)===nrm(b.title)&&nrm(x.author)===nrm(b.author))&&!confirm('«'+b.title+'» è già nella libreria. Aggiungerlo di nuovo?'))return;
    b.id='b'+Date.now()+Math.random().toString(36).slice(2,6);b.added=Date.now();
    b.minutes=estMin(b.chapters);b.lang=detectLang(b.chapters);
    await dbPut(b);books.push(b);render();toast('Aggiunto: '+b.title+' · cerco la copertina…');
    try{
      const r=await SBTG.cover(b,b.embedded),src=r&&r.src;
      toast((src?(src==='epub'?'Copertina presa dall’EPUB':'Copertina trovata su '+src):'Nessuna copertina trovata')+(r&&r.meta?' · trama e genere aggiunti':''));refresh();
    }catch(e){toast('Libro aggiunto, copertina non salvata: '+e.message)}
    delete b.embedded;
  }catch(e){toast('Errore con «'+f.name+'»: '+e.message)}
}
async function addFiles(list){
  const files=[...list].filter(f=>/\.(epub|txt|md|html?)$/i.test(f.name));
  if(!files.length){toast('Formati supportati: EPUB, TXT, HTML, Markdown');return}
  for(const f of files)await addFile(f);
  render();
}
$('#file').onchange=async e=>{const l=[...e.target.files];e.target.value='';await addFiles(l)};
/* trascinare i file sulla pagina (computer) */
{let dc=0;const dz=$('#drop'),has=e=>e.dataTransfer&&[...e.dataTransfer.types].includes('Files');
  addEventListener('dragenter',e=>{if(has(e)){dc++;dz.classList.add('on')}});
  addEventListener('dragleave',e=>{if(has(e)&&--dc<=0){dc=0;dz.classList.remove('on')}});
  addEventListener('dragover',e=>{if(has(e))e.preventDefault()});
  addEventListener('drop',e=>{if(!has(e))return;e.preventDefault();dc=0;dz.classList.remove('on');addFiles(e.dataTransfer.files)});}

/* ---------- elementi grafici ---------- */
const hue=s=>{let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))%360;return h};
const covers={};   /* id libro → indirizzo locale della copertina */
const cover=(b,x='')=>{
  const h=hue(b.title),bg=`linear-gradient(145deg,hsl(${h} 60% 42%),hsl(${(h+40)%360} 65% 26%))`;
  if(covers[b.id])return `<div class="cv ${x}" style="background:${bg};padding:0"><img class="cvi" src="${covers[b.id]}" alt="${esc(b.title)}" decoding="async"></div>`;
  return `<div class="cv ${x}" style="background:${bg}"><b>${esc(b.title)}</b><i>${esc(b.author||'')}</i></div>`;
};
const isDl=id=>!!(window.SBTG&&SBTG.isDownloaded&&SBTG.isDownloaded(id));
function card(b,menu){
  const p=prog(b.id).pc||0,fin=p>=.98;
  return `<div class="card" data-id="${b.id}" tabindex="0" role="button"><div class="cvw">${cover(b)}`+
    (isDl(b.id)?`<span class="bdg dl" title="Scaricato: funziona anche offline">${ic('down')}</span>`:'')+
    (fin?`<span class="bdg ok" title="Finito">${ic('check')}</span>`:'')+
    (p>.01&&!fin?`<div class="pbar"><i style="width:${Math.round(p*100)}%"></i></div>`:'')+
    (menu?`<button class="opt" data-opt="${b.id}" aria-label="Opzioni di ${esc(b.title)}">${ic('more')}</button>`:'')+
    `</div><p>${esc(b.title)}</p><small>${esc(b.author||'Autore sconosciuto')}${b.minutes?' · '+fmtDur(b.minutes):''}${audCount(b.id)?' · '+ic('phones','sm'):''}</small></div>`;
}
const emptyBox=()=>`<div class="empty"><b>La tua libreria è vuota</b>Carica file EPUB, TXT, HTML o Markdown: compariranno qui e potrai ascoltarli subito.<br><label class="go" style="cursor:pointer">Aggiungi libri<input type="file" multiple accept=".epub,.txt,.md,.html,.htm" hidden data-addin></label></div>`;
const shelf=(t,l)=>l.length?`<h2>${esc(t)}</h2><div class="shelf">${l.map(b=>card(b)).join('')}</div>`:'';

/* ---------- ricerca, filtri, ordinamento ---------- */
const DUR={s:[0,120],m:[120,360],l:[360,1e9]};   /* minuti */
function matches(b){
  const hay=nrm([b.title,b.author,(b.genres||[]).join(' '),b.synopsis].join(' '));
  if(!nrm(q).split(/\s+/).filter(Boolean).every(t=>hay.includes(t)))return false;
  if(fg&&!(b.genres||[]).includes(fg))return false;
  if(fd){const r=DUR[fd];if(!b.minutes||b.minutes<r[0]||b.minutes>=r[1])return false}
  return true;
}
function paintChips(){
  const cnt={};books.forEach(b=>(b.genres||[]).forEach(g=>cnt[g]=(cnt[g]||0)+1));
  const gs=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a]||a.localeCompare(b));
  const ch=(k,v,t,on)=>`<button class="chip ${on?'on':''}" data-${k}="${esc(v)}">${esc(t)}</button>`;
  const g=$('#fg'),d=$('#fd');if(!g||!d)return;
  g.innerHTML=gs.length?ch('fg','','Tutti i generi',!fg)+gs.map(x=>ch('fg',x,x,fg===x)).join(''):'';
  d.innerHTML=books.length?ch('fd','','Qualsiasi durata',!fd)+[['s','Fino a 2 h'],['m','2–6 h'],['l','Oltre 6 h']].map(([k,t])=>ch('fd',k,t,fd===k)).join(''):'';
}
function paintRes(all){
  const res=$('#res');if(!res)return;
  if(!books.length){res.innerHTML=emptyBox();return}
  if(q.trim()||fg||fd||all){
    const l=books.filter(matches);
    res.innerHTML=l.length?`<p class="cnt">${l.length} ${l.length===1?'libro':'libri'}</p><div class="grid">${l.map(b=>card(b)).join('')}</div>`:'<p class="mut">Nessun libro corrisponde. Prova con meno filtri.</p>';
    return;
  }
  const last=books.find(b=>b.id===ls('sb_last')),rec=[...books].sort((a,b)=>b.added-a.added);
  const gc={};books.forEach(b=>(b.genres||[]).forEach(g=>gc[g]=(gc[g]||0)+1));
  const topG=Object.keys(gc).filter(g=>gc[g]>=2&&g!=='Narrativa').sort((a,b)=>gc[b]-gc[a]).slice(0,3);
  res.innerHTML=(last?`<h2>Continua ad ascoltare</h2><div class="hero" data-id="${last.id}" tabindex="0" role="button"><div class="cvw">${cover(last)}</div><div class="t"><b>${esc(last.title)}</b><br><small class="mut">${esc(last.author||'')}</small><div class="bar"><i style="width:${Math.round((prog(last.id).pc||0)*100)}%"></i></div><small class="mut">${remaining(last)?'restano '+fmtDur(remaining(last)):''}</small></div><span class="go1">${ic('play')}</span></div>`:'')+
    shelf('Aggiunti di recente',rec.slice(0,14))+
    shelf('Scaricati',books.filter(b=>isDl(b.id)))+
    topG.map(g=>shelf(g,books.filter(b=>(b.genres||[]).includes(g)))).join('');
}
const SORTS={recent:['Più recenti',(a,b)=>b.added-a.added],title:['Titolo',(a,b)=>a.title.localeCompare(b.title,'it')],author:['Autore',(a,b)=>(a.author||'~').localeCompare(b.author||'~','it')],dur:['Durata',(a,b)=>(a.minutes||0)-(b.minutes||0)]};
const LFS=[['all','Tutti'],['prog','In corso'],['dl','Scaricati'],['fin','Finiti'],['aud','Con audio']];
function libList(){
  const f={all:()=>true,prog:b=>{const p=prog(b.id).pc||0;return p>.01&&p<.98},dl:b=>isDl(b.id),fin:b=>isFin(b.id),aud:b=>audCount(b.id)>0}[lf];
  return books.filter(f).sort(SORTS[sortBy][1]);
}
function paintLib(){
  const l=libList(),el=$('#libres');if(!el)return;
  $('#libcnt').textContent=books.length+(books.length===1?' libro':' libri');
  el.innerHTML=l.length?`<div class="grid">${l.map(b=>card(b,1)).join('')}</div>`:(books.length?'<p class="mut">Nessun libro in questa categoria.</p>':emptyBox());
  $('#libf').innerHTML=LFS.map(([k,t])=>`<button class="chip ${lf===k?'on':''}" data-lf="${k}">${t}</button>`).join('');
}
/* aggiorna senza ricostruire la pagina (non si perde il cursore nella barra di ricerca) */
function refresh(){
  if(view==='home'||view==='search'){if($('#q')){paintChips();paintRes(view==='search')}else render()}
  else if(view==='lib')paintLib();
}
function render(){
  const m=$('#main');
  if(view==='home'||view==='search'){
    m.innerHTML=`<input type="search" id="q" placeholder="Cerca titolo, autore, genere, trama…" aria-label="Cerca" value="${esc(q)}"><div class="chips" id="fg"></div><div class="chips" id="fd"></div><div id="res" style="margin-top:12px"></div>`;
    let raf=0;$('#q').oninput=e=>{q=e.target.value;cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>paintRes(view==='search'))};
    paintChips();paintRes(view==='search');
    if(view==='search'&&books.length&&matchMedia('(pointer:fine)').matches)$('#q').focus();
  }else if(view==='lib'){
    m.innerHTML=`<div class="libhd"><h2>La mia libreria <small class="mut" id="libcnt" style="font-weight:400;font-size:13px"></small></h2><select class="sel" id="sort" aria-label="Ordina per">${Object.entries(SORTS).map(([k,v])=>`<option value="${k}" ${k===sortBy?'selected':''}>${v[0]}</option>`).join('')}</select></div><div class="chips" id="libf"></div><div id="libres" style="margin-top:12px"></div>`;
    $('#sort').onchange=e=>{sortBy=e.target.value;ls('sb_sort',sortBy);paintLib()};
    paintLib();
  }else paintSettings();
}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{
  if(view!==b.dataset.v){q='';fg='';fd=''}   /* cambiando scheda i filtri di ricerca ripartono da zero */
  view=b.dataset.v;document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x===b));
  render();scrollTo(0,0);
});

/* ---------- schede a comparsa ---------- */
function sheet(h){$('#sheet').innerHTML=h;$('#sheet').style.display='block';$('#scrim').style.display='block';$('#sheet').scrollTop=0}
const closeSheet=()=>{$('#sheet').style.display=$('#scrim').style.display='none'};
$('#scrim').onclick=closeSheet;
const sheetOpen=()=>$('#sheet').style.display==='block';
const item=(attr,icon,t,sub,cls='')=>`<button class="it ${cls}" ${attr}>${icon?ic(icon):''}<span>${t}${sub?`<small>${sub}</small>`:''}</span></button>`;

/* ---------- scheda del libro ---------- */
const langOf=b=>b.lang||'it';
function showBook(id){
  const b=books.find(x=>x.id===id);if(!b)return;
  const pc=Math.round((prog(id).pc||0)*100),dl=isDl(id),di=dl&&SBTG.downloadInfo(id);
  const gen=(b.genres||[]).map(g=>`<span class="tag">${esc(g)}</span>`).join(' ');
  const itOk=!b.synopsis||langOf(b)==='en'||!(window.SBTG&&SBTG.isItalian)||SBTG.isItalian(b.synopsis);
  sheet(`<div style="display:flex;gap:14px;align-items:flex-start"><div style="width:110px;flex:none">${cover(b)}</div><div style="min-width:0;flex:1"><h3 style="margin:0 0 4px">${esc(b.title)}</h3><div class="mut">${esc(b.author||'Autore sconosciuto')}</div>
    <div class="mut" style="margin:8px 0;font-size:13px">${b.minutes?'circa '+fmtDur(b.minutes)+' di ascolto':'durata non ancora calcolata'}${b.chapters?' · '+b.chapters.length+' capitoli':''}${audCount(b.id)?' · audio narrato':''}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">${gen}</div></div></div>
    ${b.synopsis?`<p style="line-height:1.5;font-size:14px;margin:14px 0">${esc(b.synopsis)}</p>${itOk?'':item('data-a="info"','search','Cerca la trama in italiano')}`:`<p class="mut" style="font-size:14px;margin:14px 0">Trama e genere non ancora trovati.</p>${item('data-a="info"','search','Cerca trama e genere')}`}
    <div class="row2"><button class="go" data-a="play">${ic('play','sm')} ${pc>0&&pc<98?'Riprendi · '+pc+'%':pc>=98?'Riascolta':'Riproduci'}</button><button class="go alt" data-a="${dl?'ok':'dl'}">${dl?'✓ Scaricato':'Scarica'}</button></div>
    ${dl?`<p class="note" style="margin:10px 0 0">Salvato sul dispositivo (${fmtMB(di.bytes)}${di.audio?' · con audio narrato':''}): lo ascolti anche senza internet.</p>${item('data-a="rm"','trash','Rimuovi il download')}`:''}
    ${item('data-a="menu"','more','Altre opzioni')}`);
  $('#sheet').onclick=async e=>{
    const x=e.target.closest('[data-a]');if(!x)return;const a=x.dataset.a;
    if(a==='play'){closeSheet();openBook(id)}
    else if(a==='dl')dlChoose(b);
    else if(a==='menu')bookMenu(id);
    else if(a==='rm'){
      if(!confirm('Rimuovere il download? Il libro resta nella libreria e si scarica di nuovo quando serve.'))return;
      try{await sbReady();await SBTG.removeDownload(id);toast('Download rimosso');refresh()}catch(err){toast('Errore: '+err.message)}
      showBook(id);
    }else if(a==='info'){
      x.querySelector('span').textContent='Cerco…';
      try{await sbReady();const ok=await SBTG.enrich({id:b.id,title:b.title,author:b.author,lang:b.lang});toast(ok?'Scheda aggiornata':'Nessuna informazione trovata online')}catch(err){toast('Ricerca non riuscita: '+err.message)}
      showBook(id);
    }
  };
}
$('#main').onclick=e=>{
  if(e.target.closest('[data-addin]'))return;
  const o=e.target.closest('[data-opt]');if(o){e.stopPropagation();bookMenu(o.dataset.opt);return}
  const c=e.target.closest('[data-id]');if(c){c.classList.contains('hero')?openBook(c.dataset.id):showBook(c.dataset.id);return}
  const f=e.target.closest('[data-fg],[data-fd],[data-lf],[data-theme],[data-act]');if(!f)return;
  if(f.dataset.fg!==undefined){fg=f.dataset.fg;paintChips();paintRes(view==='search')}
  else if(f.dataset.fd!==undefined){fd=f.dataset.fd;paintChips();paintRes(view==='search')}
  else if(f.dataset.lf!==undefined){lf=f.dataset.lf;paintLib()}
  else if(f.dataset.theme){ls('sb_theme',f.dataset.theme==='auto'?null:f.dataset.theme);applyTheme();paintSettings()}
  else if(f.dataset.act)settingsAct(f.dataset.act);
};
$('#main').onkeydown=e=>{if(e.key==='Enter'){const c=e.target.closest('.card,.hero');if(c)c.click()}};
$('#main').addEventListener('change',e=>{if(e.target.matches('[data-addin]')){const l=[...e.target.files];e.target.value='';addFiles(l)}});

/* ---------- menu del libro: modifica, avanzamento, audio narrato, audiolibro Kokoro, elimina ---------- */
let audioBook=null;
async function ensureChapters(b){
  if(!b.chapters){toast('Preparo il testo…');b.chapters=(await dbGet(b.id)).chapters}
  if(!b.lang||!b.minutes){
    const l=detectLang(b.chapters),p={};
    if(!b.lang){b.lang=l;if(l==='en')p.lang='en'}
    if(!b.minutes){b.minutes=estMin(b.chapters);p.minutes=b.minutes}
    if(Object.keys(p).length)sbReady().then(()=>SBTG.setMeta(b.id,p)).catch(()=>{});
  }
  return b.chapters;
}
const NVOCI=[['elsa','Elsa','femminile chiara e naturale (consigliata per libri)'],['isabella','Isabella','femminile calda e narrativa'],['diego','Diego','maschile naturale e fluida'],['benigno','Benigno','maschile calmo e rilassante']];
function exportText(b){
  const last=ls('sb_nvoce')||'elsa';
  sheet('<h3>Voce del narratore</h3><p class="note">Scarico il testo del libro; la voce la usa il programma sul PC. Ti mostro il comando già pronto.</p>'+
    NVOCI.map(v=>item(`data-n="${v[0]}"`,'',v[1],v[2],v[0]===last?'on':'')).join(''));
  $('#sheet').onclick=e=>{const x=e.target.closest('[data-n]');if(!x)return;ls('sb_nvoce',x.dataset.n);exportFile(b,x.dataset.n)};
}
async function exportFile(b,voce){
  try{
    const chapters=await ensureChapters(b);
    const bl=new Blob([JSON.stringify({title:b.title,author:b.author||'',chapters})],{type:'application/json'});
    const fname=(b.title||'libro').replace(/[^\w\-]+/g,'_').slice(0,40)+'.storybooks.json';
    const a=document.createElement('a');a.href=URL.createObjectURL(bl);a.download=fname;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    const cmd='python src/narratore.py audiolibro "'+fname+'" -v '+voce;
    sheet('<h3>Testo scaricato</h3><p class="note">Sul PC, nella cartella del narratore, lancia questo comando (crea un MP3 per capitolo; poi li carichi qui con «Aggiungi audio»):</p><pre>'+esc(cmd)+'</pre>'+item('data-k="1"','file','Copia il comando'));
    $('#sheet').onclick=e=>{if(e.target.closest('[data-k]'))navigator.clipboard.writeText(cmd).then(()=>toast('Comando copiato'),()=>toast('Copia non riuscita: selezionalo a mano'))};
  }catch(e){toast('Errore: '+e.message)}
}
/* i file si abbinano al capitolo dall'ultimo numero nel nome: 001.mp3 → capitolo 1 */
const chapterOf=name=>{const m=String(name).match(/(\d+)(?!.*\d)/);return m?+m[1]-1:-1};
$('#afile').onchange=async e=>{
  const files=[...e.target.files];e.target.value='';
  const b=books.find(x=>x.id===audioBook);if(!b||!files.length)return;
  try{
    const N=(await ensureChapters(b)).length,ok=[],skip=[];
    for(const f of files){const n=chapterOf(f.name);(n>=0&&n<N?ok:skip).push({f,n})}
    ok.sort((x,y)=>x.n-y.n);
    if(!ok.length){toast('Nessun file corrisponde ai capitoli: i nomi devono contenere il numero (001.mp3, 002.mp3…)');return}
    await sbReady();
    for(let k=0;k<ok.length;k++){
      const {f,n}=ok[k];
      await SBTG.putAudio(b.id,n,f,p=>toast(`Carico l’audio · capitolo ${n+1} (${k+1}/${ok.length}) ${Math.round(p*100)}%`),b.title);
    }
    toast(`Audio caricato per ${ok.length} capitol${ok.length===1?'o':'i'}`+(skip.length?` · ${skip.length} file ignorati (numero non valido)`:''));
    render();
  }catch(err){toast('Audio non caricato: '+err.message)}
};
function editBook(b){
  sheet(`<h3>Modifica libro</h3><label class="fld">Titolo<input id="et" value="${esc(b.title)}"></label><label class="fld">Autore<input id="ea" value="${esc(b.author||'')}"></label><button class="go" id="esave">Salva</button>`);
  $('#esave').onclick=async()=>{
    const title=$('#et').value.trim(),author=$('#ea').value.trim();
    if(!title){toast('Il titolo non può essere vuoto');return}
    if(!navigator.onLine){toast('Serve internet per salvare le modifiche');return}
    try{await sbReady();await SBTG.setMeta(b.id,{title,author});b.title=title;b.author=author;closeSheet();toast('Libro aggiornato');refresh();if(cur&&cur.id===b.id)uiBook(true)}
    catch(e){toast('Modifica non salvata: '+e.message)}
  };
}
function setProgress(id,pc){
  if(pc===null)ls('sb_p_'+id,null);else{const p=prog(id);ls('sb_p_'+id,JSON.stringify({...p,pc}))}
  if(cur&&cur.id===id){if(pc===null){pause();jump(0,0)}}
  refresh();
}
async function removeBook(id){
  const b=books.find(x=>x.id===id);
  if(!b||!confirm('Eliminare «'+b.title+'»? Il libro, la copertina e gli audio saranno cancellati anche da Telegram.'))return;
  if(cur&&cur.id===id)closePlayer();
  books=books.filter(x=>x.id!==id);render();
  try{
    await dbDel(id);
    ['sb_p_','sb_au_','sb_kau_'].forEach(p=>ls(p+id,null));
    try{window.KOKORO&&await KOKORO.kaudRemove(id)}catch(e){}
    toast('Libro eliminato');
  }catch(e){books.push(b);render();toast('Eliminazione non riuscita: '+((e&&e.message)||e))}
}
function bookMenu(id){
  const b=books.find(x=>x.id===id);if(!b)return;
  const tc=tgAudCount(id),ka=kauGet(id),kc=ka.done.length,kt=ka.total||(b.chapters&&b.chapters.length)||0,pc=prog(id).pc||0;
  const kvoce=v=>item(`data-g="${v.id}" ${genJob?'disabled':''}`,'mic',esc(v.nome.replace(' (Kokoro)',''))+(ka.voice===v.id&&kc?` · ${kc}${kt?'/'+kt:''} capitoli pronti`:''),ka.voice===v.id&&kt&&kc>=kt?'Audiolibro completo: si ascolta dal dispositivo':ka.voice===v.id&&kc?'Completa: rifà solo i capitoli mancanti':'Crea l’audiolibro con questa voce');
  sheet(`<h3>${esc(b.title)}</h3>
   ${item('data-a="edit"','edit','Modifica titolo e autore')}
   ${pc>=.98?item('data-a="unfin"','back','Segna come da ascoltare'):item('data-a="fin"','check','Segna come finito')}
   ${pc>0?item('data-a="reset"','back','Azzera l’avanzamento'):''}
   <h4>Audio narrato</h4>
   ${item('data-a="add"','phones','Aggiungi audio (MP3 del narratore)')}
   ${item('data-a="export"','file','Scarica il testo per il narratore','Voci Elsa, Isabella, Diego, Benigno sul PC')}
   ${tc?item('data-a="rem"','trash',`Rimuovi l’audio narrato (${tc} capitoli)`):''}
   <h4>Audiolibro con voce Kokoro</h4>
   ${window.KOKORO&&KOKORO.ok()?KOKORO.VOICES.map(kvoce).join(''):'<p class="note">Questo browser non supporta le voci Kokoro.</p>'}
   ${kc?item('data-a="krem"','trash',`Rimuovi l’audiolibro Kokoro (${kc} capitoli)`):''}
   <p class="note">Kokoro prepara tutto il libro una sola volta e lo salva sul dispositivo; poi lo ascolti da lì, senza calcoli e senza internet. La prima volta richiede tempo (tieni l’app aperta e lo schermo acceso): se la interrompi, i capitoli finiti restano. Circa 30 MB per ora di ascolto.</p>
   <h4>Zona pericolosa</h4>
   ${item('data-a="del"','trash','Elimina il libro','Lo cancella anche da Telegram','danger')}`);
  $('#sheet').onclick=async e=>{
    const g=e.target.closest('[data-g]');
    if(g){closeSheet();genBook(b,g.dataset.g);return}
    const x=e.target.closest('[data-a]');if(!x)return;const a=x.dataset.a;
    if(a==='edit'){editBook(b);return}
    if(a==='export'){exportText(b);return}
    closeSheet();
    if(a==='add'){audioBook=id;$('#afile').click()}
    else if(a==='fin')setProgress(id,1);
    else if(a==='unfin')setProgress(id,0);
    else if(a==='reset'){if(confirm('Azzerare l’avanzamento di questo libro?'))setProgress(id,null)}
    else if(a==='del')removeBook(id);
    else if(a==='rem'&&confirm('Rimuovere tutto l’audio narrato di questo libro? Il testo resta.')){
      try{await sbReady();if(cur&&cur.id===id&&useAudio())pause();await SBTG.delAudio(id);toast('Audio rimosso');render()}catch(err){toast('Errore: '+err.message)}
    }else if(a==='krem'&&confirm('Rimuovere l’audiolibro Kokoro di questo libro? Il testo resta.')){
      try{if(cur&&cur.id===id&&useAudio())pause();await KOKORO.kaudRemove(id);kauSet(id,{voice:'',done:[]});aBlobs.clear();toast('Audiolibro Kokoro rimosso');render()}catch(err){toast('Errore: '+err.message)}
    }
  };
}

/* ---------- download per l'uso offline ---------- */
async function doDl(b,btn){
  if(!navigator.onLine){toast('Serve internet per scaricare il libro');return false}
  toast('Scarico il libro…');
  try{await sbReady();const r=await SBTG.download(b.id,p=>{if(btn)btn.textContent='Scarico… '+Math.round(p*100)+'%'});toast('Libro scaricato ('+fmtMB(r.bytes)+'): ora funziona anche offline');refresh();return true}
  catch(err){toast('Download non riuscito: '+err.message);return false}
}
async function dlChoose(b){
  const P=window.PIPER&&PIPER.ok()?PIPER:null,K=window.KOKORO&&KOKORO.ok()?KOKORO:null;
  if(!P&&!K){closeSheet();await doDl(b);showBook(b.id);return}
  const E=eng(voiceName),curName=E?((E.VOICES.find(v=>'piper:'+v.id===voiceName)||{}).nome||voiceName):(voiceName||'voce del telefono');
  const st=P?await Promise.all(P.VOICES.map(v=>P.has(v.id))):[];
  sheet(`<h3>Scarica «${esc(b.title)}»</h3><p class="note">Il libro si salva sul dispositivo. Scegli con quale voce ascoltarlo.</p>
   ${item('data-d="keep"','','Mantieni la voce attuale',esc(curName))}
   ${P?P.VOICES.map((v,k)=>item(`data-d="piper:${v.id}"`,'',esc(v.nome),st[k]?'Pronta · funziona senza internet':'Da scaricare una volta · '+esc(v.info),voiceName==='piper:'+v.id?'on':'')).join(''):''}
   ${K?K.VOICES.map(v=>item(`data-d="kok:${v.id}"`,'',esc(v.nome.replace(' (Kokoro)',''))+' · crea anche l’audiolibro','Dopo il download prepara l’audio di tutto il libro con questa voce (ci vuole tempo)')).join(''):''}`);
  $('#sheet').onclick=async e=>{
    const x=e.target.closest('[data-d]');if(!x)return;const d=x.dataset.d;
    if(d==='keep'){closeSheet();await doDl(b)}
    else if(d.startsWith('piper:')){if(await pickPiper(d,x))await doDl(b)}   /* pickPiper chiude la scheda quando ha finito */
    else if(d.startsWith('kok:')){closeSheet();if(await doDl(b))genBook(b,d.slice(4))}
  };
}

/* ---- audiolibro con Kokoro: si genera una volta sola, si conserva sul dispositivo e si ascolta da lì ---- */
let genJob=null;
addEventListener('beforeunload',e=>{if(genJob){e.preventDefault();e.returnValue=''}});
async function genBook(b,voice){
  if(genJob){toast('Sto già preparando un audiolibro');return}
  const K=window.KOKORO;
  if(!K||!K.ok()){toast('Questo browser non supporta le voci Kokoro');return}
  const miss=await K.check();
  if(miss.length){toast('Componenti Kokoro mancanti: esegui su GitHub l’azione «Prepara Kokoro»');return}
  let chs;try{chs=await ensureChapters(b)}catch(e){toast('Libro non disponibile: '+((e&&e.message)||e));return}
  let meta=kauGet(b.id);
  if(meta.voice&&meta.voice!==voice&&meta.done.length){
    if(!confirm('Questo libro ha già un audiolibro con un’altra voce. Lo rifaccio da capo con la nuova?'))return;
    await K.kaudRemove(b.id);meta={voice,done:[]};aBlobs.clear();
  }
  if((await K.encoder())==='wav'&&!confirm('Manca il compressore MP3: l’audio occuperà molto spazio (circa 170 MB per ora di ascolto). Per ridurlo rilancia su GitHub l’azione «Prepara Kokoro». Continuo comunque?'))return;
  meta.voice=voice;meta.total=chs.length;kauSet(b.id,meta);
  const job=genJob={stop:false},box=$('#gen'),gt=$('#gt'),gbar=$('#gbar');
  box.classList.add('on');gt.textContent='Preparo la voce…';gbar.style.width='0%';
  $('#gx').onclick=()=>{job.stop=true;gt.textContent='Mi fermo dopo la frase in corso…'};
  let wl=null;
  try{
    try{wl=await navigator.wakeLock.request('screen')}catch(e){}
    if(!(await K.has(voice))){
      if(!navigator.onLine)throw new Error('serve internet solo per scaricare la voce la prima volta');
      await K.download(voice,p=>{gt.textContent='Scarico la voce… '+Math.round(p*100)+'%';gbar.style.width=Math.round(p*100)+'%'});
    }
    const todo=[];
    for(let n=0;n<chs.length;n++){
      if(meta.done.includes(n)&&await K.kaudHas(b.id,n))continue;   /* il file c’è già sul dispositivo: non si rifà */
      const items=buildSegs(chs[n]).map(g=>({t:g.t,r:g.r||1,sil:pSil(g)*speed}));
      if(items.length)todo.push({n,items,chars:items.reduce((a,i)=>a+i.t.length,0)});
    }
    meta.done=meta.done.filter(n=>!todo.some(x=>x.n===n));kauSet(b.id,meta);
    if(!todo.length){toast('L’audiolibro è già completo sul dispositivo');return}
    const total=todo.reduce((a,x)=>a+x.chars,0),t0=Date.now();let before=0,fin=0;
    for(const x of todo){
      if(job.stop)break;
      const blob=await K.renderChapter(voice,x.items,{stop:()=>job.stop,onProgress:f=>{
        const fr=(before+f*x.chars)/total,el=(Date.now()-t0)/60000,eta=fr>.02?el/fr*(1-fr):0;
        gbar.style.width=Math.round(fr*100)+'%';
        gt.textContent='Capitolo '+(fin+1)+'/'+todo.length+' · '+Math.round(fr*100)+'%'+(eta>=1?' · restano circa '+fmtDur(Math.ceil(eta)):'');
      }});
      if(!blob)break;
      await K.kaudPut(b.id,x.n,blob);
      meta.done.push(x.n);meta.done.sort((p,q)=>p-q);kauSet(b.id,meta);
      before+=x.chars;fin++;
    }
    toast(job.stop?'Interrotto: i capitoli finiti restano salvati':'Audiolibro pronto: ora si ascolta dal dispositivo');
  }catch(e){console.error(e);toast('Audiolibro: '+((e&&e.message)||e))}
  finally{try{wl&&wl.release()}catch(e){}genJob=null;box.classList.remove('on');render()}
}

/* ---------- impostazioni ---------- */
function applyTheme(){
  const t=ls('sb_theme'),r=document.documentElement;
  if(t==='light'||t==='dark')r.dataset.theme=t;else delete r.dataset.theme;
  requestAnimationFrame(()=>{const m=$('#tc');if(m)m.content=getComputedStyle(document.body).backgroundColor});
}
const voiceLabel=()=>{const E=eng(voiceName);return E?((E.VOICES.find(v=>'piper:'+v.id===voiceName)||{}).nome||voiceName):(pickVoice()?pickVoice().name:'voce del dispositivo')};
function paintSettings(){
  const th=ls('sb_theme')||'auto',seg=(k,t)=>`<button class="${th===k?'on':''}" data-theme="${k}">${t}</button>`;
  const dls=books.filter(b=>isDl(b.id)),bytes=dls.reduce((a,b)=>a+((window.SBTG&&SBTG.downloadInfo(b.id)||{}).bytes||0),0);
  $('#main').innerHTML=`<h2>Impostazioni</h2>
   <section class="set"><h3>Aspetto</h3><div class="seg">${seg('auto','Automatico')}${seg('light','Chiaro')}${seg('dark','Scuro')}</div></section>
   <section class="set"><h3>Lettura</h3>
    <button class="row-b" data-act="voice"><span>Voce di lettura</span><small>${esc(voiceLabel())}</small></button>
    <button class="row-b" data-act="speed"><span>Velocità</span><small>${speed}×</small></button></section>
   <section class="set"><h3>Telegram</h3><p class="mut">${esc($('#tgout').title||'')}</p>
    <button class="row-b" data-act="tg"><span>Collegamento e account</span></button>
    <button class="row-b" data-act="sync"><span>Aggiorna il catalogo</span></button>
    <button class="row-b" data-act="fill"><span>Cerca copertine, trame e generi mancanti</span></button></section>
   <section class="set"><h3>Spazio sul dispositivo</h3><p class="mut" id="sspace">Calcolo…</p>
    <p class="mut">Libri scaricati: ${dls.length}${bytes?' ('+fmtMB(bytes)+')':''}</p>
    <button class="row-b" data-act="rmdl"><span>Rimuovi tutti i download dei libri</span></button>
    <button class="row-b" data-act="rmvoices"><span>Elimina le voci offline scaricate</span></button></section>
   <p class="mut small" style="text-align:center">Storybooks · ${books.length} ${books.length===1?'libro':'libri'}</p>`;
  if(navigator.storage&&navigator.storage.estimate)navigator.storage.estimate().then(e=>{const s=$('#sspace');if(s)s.textContent='Spazio usato dall’app: '+fmtMB(e.usage||0)+(e.quota?' su '+fmtMB(e.quota)+' disponibili':'')}).catch(()=>{});
  else $('#sspace').textContent='Stima dello spazio non disponibile in questo browser.';
}
async function settingsAct(a){
  try{
    await sbReady();
    if(a==='voice')voiceSheet();
    else if(a==='speed')speedSheet();
    else if(a==='tg')SBTG.menu();
    else if(a==='sync'){toast('Aggiorno il catalogo…');await SBTG.list();toast('Catalogo aggiornato')}
    else if(a==='fill'){SBTG.fillMissing();toast('Cerco copertine, trame e generi…')}
    else if(a==='rmdl'){
      const l=books.filter(b=>isDl(b.id));if(!l.length){toast('Nessun libro scaricato');return}
      if(!confirm('Rimuovere i download di '+l.length+' libri? Restano nella libreria.'))return;
      for(const b of l)await SBTG.removeDownload(b.id);toast('Download rimossi');paintSettings();
    }else if(a==='rmvoices'){
      if(!confirm('Eliminare le voci offline (Piper e Kokoro) dal dispositivo? Si potranno riscaricare.'))return;
      for(const k of await caches.keys())if(/^(sb-piper|sb-kokoro|transformers)/.test(k))await caches.delete(k);
      if(voiceName.startsWith('piper:')){voiceName='';ls('sb_voice',null)}
      toast('Voci offline eliminate');paintSettings();
    }
  }catch(e){toast('Errore: '+((e&&e.message)||e))}
}

/* ---------- testo → brani di lettura (intonazione e paraverbale) ---------- */
const clean=s=>s.replace(/[«»“”"*_]/g,'').replace(/^[\s—–-]+/,'').replace(/\s[—–]\s?/g,', ').replace(/\s+/g,' ').trim();
const MAXC=190,MINC=70;   /* un brano = 1-3 frasi (≈70-190 caratteri), mai a cavallo di due paragrafi */
function splitLong(t){   /* frasi molto lunghe: si spezza alle virgole, poi agli spazi */
  if(t.length<=MAXC)return[t];
  const out=[];let a='';
  for(const x of t.split(/(?<=[,;:])\s+/)){
    if(a&&(a+' '+x).length>MAXC){out.push(a);a=''}
    a=a?a+' '+x:x;
    while(a.length>MAXC){let k=a.lastIndexOf(' ',MAXC);if(k<40)k=MAXC;out.push(a.slice(0,k));a=a.slice(k).trim()}
  }
  if(a)out.push(a);return out;
}
function buildSegs(ch){
  const out=[];let bal=0;
  const prosody=(t,dlg)=>{   /* intonazione dalla punteggiatura finale e dai dialoghi */
    const end=t.replace(/["»”’)\s]+$/,'').slice(-1);let r=1,p=dlg?1.1:.97;
    if(end==='?')p+=.14;else if(end==='!'){p+=.1;r=1.07}else if(end==='…'||/\.\.\.$/.test(t)){r=.88;p-=.05}
    if(dlg)r*=1.03;return{r,p};
  };
  ch.p.forEach((para,pi)=>{
    const start=out.length;
    const head=pi===0&&ch.p.length>1&&para.length<90&&!/[.!?…]$/.test(para);
    if(head){const c=clean(para);if(c)out.push({d:para,t:c,r:.9,p:.94,pp:true});return}
    const ss=para.match(/[^.!?…]+(?:[.!?…]+["»”’)]*|$)\s*/g)||[para];
    let buf='',bdlg=false;
    const flush=()=>{const c=clean(buf);if(c){const q=prosody(buf.trim(),bdlg);out.push({d:buf.trim(),t:c,r:q.r,p:q.p})}buf=''};
    ss.forEach(x=>{
      const t=x.trim();if(!/[\p{L}\p{N}]/u.test(t))return;
      const open=/^[«“"—–-]/.test(t),was=bal>0;
      bal=Math.max(0,bal+(t.match(/[«“]/g)||[]).length-(t.match(/[»”]/g)||[]).length);
      const dlg=open||was;
      if(buf&&dlg!==bdlg)flush();            /* si cambia tono tra narrazione e dialogo */
      for(const piece of splitLong(t)){
        if(buf&&(buf+' '+piece).length>MAXC)flush();
        if(!buf)bdlg=dlg;
        buf=buf?buf+' '+piece:piece;
        if(buf.length>=MINC)flush();
      }
    });
    flush();
    if(out.length>start)out[out.length-1].pp=true;   /* fine paragrafo */
  });
  return out.length?out:[{d:'…',t:'…',r:1,p:1,pp:true}];
}

/* ---------- voce del sistema ---------- */
const qual=v=>{const n=v.name+' '+(v.voiceURI||'');let q=0;
  if(/natural|neural/i.test(n))q+=6;if(/premium|enhanced|migliorat|potenziat/i.test(n))q+=5;
  if(/siri/i.test(n))q+=4;if(/google/i.test(n))q+=3;if(v.localService===false)q+=1;
  if(/elsa|isabella|diego|giuseppe|alice|federica|luca|paola|emma/i.test(n))q+=1;
  if(/compact|eloquence|espeak/i.test(n))q-=3;return q};
function loadVoices(){try{voices=(speechSynthesis.getVoices()||[]).filter(v=>/^it/i.test(v.lang.replace('_','-'))).sort((a,b)=>qual(b)-qual(a)||a.name.localeCompare(b.name))}catch(e){voices=[]}}
try{loadVoices();speechSynthesis.onvoiceschanged=loadVoices}catch(e){}
const pickVoice=()=>voices.find(v=>v.name===voiceName)||voices[0]||null;
/* Lettura continua: i prossimi brani vengono messi in coda al sintetizzatore mentre il corrente è in corso,
   così la voce non aspetta e non ricarica nulla a ogni punteggiatura. I capitoli si susseguono da soli. */
const LOOK=3,clampR=x=>Math.min(2,Math.max(.5,x)),clampP=x=>Math.min(2,Math.max(0,x));
let pend=0,qc=0,qi=0,qs=[],ka=0;
function enqueue(my,v,c,i,arr){
  const g=arr[i],u=new SpeechSynthesisUtterance(g.t);
  u.lang='it-IT';if(v)u.voice=v;
  u.rate=clampR(g.r*speed);u.pitch=clampP(g.p);
  pend++;
  u.onstart=()=>{if(my!==tok)return;if(c!==ci){ci=c;segs=arr}si=i;if(i%4===0)save();ui()};
  u.onend=()=>{pend--;if(my===tok)feed(my)};
  u.onerror=e=>{pend--;if(my!==tok||e.error==='interrupted'||e.error==='canceled')return;feed(my)};
  speechSynthesis.speak(u);
}
function feed(my){
  if(my!==tok||!playing)return;
  const v=pickVoice();
  while(pend<LOOK){
    if(qi>=qs.length){
      if(qc+1>=cur.chapters.length)break;
      if(sleepEoc&&qc===sleepCh){if(pend===0)sleepDone();return}   /* timer «fine capitolo» */
      if(audOn(cur.id)&&hasAud(cur.id,qc+1)){if(pend===0)jump(qc+1,0);return}   /* il capitolo dopo ha l'audio narrato: ci si passa a fine coda */
      qc++;qs=buildSegs(cur.chapters[qc]);qi=0;
    }
    enqueue(my,v,qc,qi,qs);qi++;
  }
  if(pend===0&&qi>=qs.length&&qc+1>=cur.chapters.length)pause();   /* fine del libro */
}
/* alcune voci online di Chrome si interrompono dopo ~15 s: un "respiro" ogni 10 s le tiene vive */
function keepAlive(v){clearInterval(ka);ka=0;
  if(v&&v.localService===false&&/google/i.test(v.name)&&!/android/i.test(navigator.userAgent))
    ka=setInterval(()=>{if(speechSynthesis.speaking&&!speechSynthesis.paused){speechSynthesis.pause();speechSynthesis.resume()}},10000)}

/* ---------- voce offline (Piper) ----------
   Il testo viene sintetizzato qualche brano in anticipo e programmato sul clock audio senza spazi:
   nessuna attesa tra una frase e l'altra, anche senza internet. */
const eng=n=>n.startsWith('piper:')?window.PIPER:null;   /* Kokoro non legge più dal vivo: genera l’audiolibro (vedi genBook) */
const isPiper=()=>!!eng(voiceName);
let actx=null,pNodes=[],pTimers=[],pCache=new Map(),pSlow=false,pReady=false;
const mkCtx=()=>{if(!actx){actx=new (window.AudioContext||window.webkitAudioContext)()}try{actx.resume&&actx.resume()}catch(e){}return actx};
/* A schermo bloccato il telefono ferma l'audio prodotto dalla pagina, ma non quello di un normale lettore: l'uscita di Piper
   passa quindi dall'elemento <audio> (come per gli MP3), con i controlli nella schermata di blocco. */
let pDest=null,pViaAu=false;
function pAttach(ctx){
  try{
    if(!pDest)pDest=ctx.createMediaStreamDestination();
    au.srcObject=pDest.stream;
    const p=au.play();
    if(p&&p.then)p.then(()=>{if(au.srcObject===pDest.stream)pViaAu=true}).catch(()=>{pViaAu=false;try{au.srcObject=null}catch(e){}});
    else pViaAu=true;
  }catch(e){pViaAu=false;try{au.srcObject=null}catch(x){}}
}
function pStop(){pNodes.forEach(n=>{try{n.stop()}catch(e){}try{n.disconnect()}catch(e){}});pNodes=[];pTimers.forEach(clearTimeout);pTimers=[];
  pViaAu=false;if(au.srcObject){try{au.pause()}catch(e){}try{au.srcObject=null}catch(e){}}}
const pSil=g=>{const e=g.t.replace(/["»”’)\s]+$/,'').slice(-1);return(g.pp?.75:e==='?'||e==='!'?.32:e==='…'?.5:/[,;:]/.test(e)?.16:.3)/speed};   /* pausa dopo il brano, in secondi */
async function pSeg(id,g,key){
  if(pCache.has(key))return pCache.get(key);
  const r=await eng(voiceName).synth(id,g.t,1/Math.max(.4,g.r*speed));
  pCache.set(key,r);if(pCache.size>14)pCache.delete(pCache.keys().next().value);return r;
}
async function pRun(my){
  const id=voiceName.slice(voiceName.indexOf(':')+1),ctx=mkCtx();
  try{
    let c=ci,i=si,arr=segs,t=0,started=false,toAudio=-1,eoc=false;
    if(!pReady)toast('Preparo la voce offline…');
    while(my===tok&&playing){
      if(i>=arr.length){
        if(c+1>=cur.chapters.length)break;
        if(sleepEoc&&c===sleepCh){eoc=true;break}
        if(audOn(cur.id)&&hasAud(cur.id,c+1)){toAudio=c+1;break}
        c++;arr=buildSegs(cur.chapters[c]);i=0;
      }
      while(my===tok&&playing&&started&&t-ctx.currentTime>(document.hidden?75:20))await new Promise(r=>setTimeout(r,250));   /* non si anticipa più di ~20 s */
      if(my!==tok||!playing)return;
      const g=arr[i],{pcm,rate}=await pSeg(id,g,id+'|'+c+'|'+i+'|'+speed);
      if(my!==tok||!playing)return;
      pReady=true;
      const now=ctx.currentTime,at=Math.max(t,now+.05);
      if(started&&at-t>1.2&&!pSlow){pSlow=true;toast('Il dispositivo è lento con questa voce: prova «Riccardo» (Piper) o una voce del sistema')}
      const buf=ctx.createBuffer(1,pcm.length,rate);buf.copyToChannel(pcm,0);
      const src=ctx.createBufferSource();src.buffer=buf;src.connect(pViaAu&&pDest?pDest:ctx.destination);src.start(at);pNodes.push(src);
      src.onended=()=>{pNodes=pNodes.filter(n=>n!==src)};
      const cc=c,ii=i,aa=arr;
      pTimers.push(setTimeout(()=>{if(my!==tok)return;if(cc!==ci){ci=cc;segs=aa}si=ii;if(ii%4===0)save();ui()},Math.max(0,(at-now)*1000)));
      t=at+buf.duration+pSil(g);started=true;i++;
    }
    if(my===tok&&playing){await new Promise(r=>setTimeout(r,Math.max(0,(t-ctx.currentTime)*1000)));if(my===tok){if(eoc)sleepDone();else if(toAudio>=0)jump(toAudio,0);else pause()}}   /* fine capitolo (→ audio narrato) o fine libro */
  }catch(e){if(my!==tok)return;console.error(e);toast('Voce offline: '+((e&&e.message)||e));pause()}
}

/* ---------- audio narrato (MP3 del Narratore Libri e audiolibri Kokoro) ----------
   Capitoli già registrati: si ascoltano con un normale lettore audio, con riproduzione in background, controlli nella
   schermata di blocco e ripresa dal punto in cui eri. I capitoli senza audio continuano a essere letti dalla voce scelta. */
const au=$('#au');
let aT=0,aT0=0,aF=0,aUrl='',aSave=0,aPos=0;const aBlobs=new Map();
const SILENT='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
/* audiolibro Kokoro: registro locale dei capitoli già generati (la presenza dei file si verifica all’avvio e prima di rigenerare) */
const kauGet=id=>{try{const o=JSON.parse(ls('sb_kau_'+id)||'null');return o&&Array.isArray(o.done)?o:{voice:'',done:[]}}catch(e){return{voice:'',done:[]}}};
const kauSet=(id,o)=>ls('sb_kau_'+id,JSON.stringify(o));
const hasKau=(id,n)=>kauGet(id).done.includes(n);
const hasAud=(id,n)=>!!(window.SBTG&&SBTG.audioOf(id)[n])||hasKau(id,n);
const audOn=id=>ls('sb_au_'+id)!=='off';
const useAudio=()=>!!cur&&audOn(cur.id)&&hasAud(cur.id,ci);
const tgAudCount=id=>window.SBTG?Object.keys(SBTG.audioOf(id)).length:0;
const audCount=id=>{const s=new Set(window.SBTG?Object.keys(SBTG.audioOf(id)).map(Number):[]);kauGet(id).done.forEach(n=>s.add(n));return s.size};
let unlocked=false;   /* il primo tocco "sblocca" l'audio sui telefoni, che altrimenti bloccano l'avvio automatico */
addEventListener('pointerdown',()=>{if(unlocked)return;unlocked=true;try{au.src=SILENT;const p=au.play();p&&p.then(()=>au.pause()).catch(()=>{})}catch(e){}},{once:true,passive:true});
async function aBlob(id,n,my,visible){
  const k=id+':'+n;if(aBlobs.has(k))return aBlobs.get(k);
  const keep=bl=>{aBlobs.set(k,bl);if(aBlobs.size>3)aBlobs.delete(aBlobs.keys().next().value);return bl};
  if(!(window.SBTG&&SBTG.audioOf(id)[n])&&hasKau(id,n)&&window.KOKORO){   /* audio Kokoro: si apre dal dispositivo, senza rete */
    const bl=await KOKORO.kaudGet(id,n);if(!bl)throw new Error('Audio non trovato sul dispositivo: rigeneralo dalla scheda del libro');
    return keep(bl);
  }
  const loc=await SBTG.hasAudioLocal(id,n);
  if(visible&&my===tok)toast(loc?'Apro l’audio…':'Scarico l’audio del capitolo…');
  return keep(await SBTG.getAudio(id,n,p=>{if(visible&&!loc&&my===tok)toast('Scarico l’audio… '+Math.round(p*100)+'%')}));
}
addEventListener('visibilitychange',()=>{if(!document.hidden&&playing&&actx&&actx.state!=='running'){try{actx.resume()}catch(e){}}});
function mediaSess(){
  if(!('mediaSession' in navigator)||typeof MediaMetadata==='undefined')return;
  try{navigator.mediaSession.metadata=new MediaMetadata({title:cur.chapters[ci].t,artist:cur.author||'',album:cur.title,artwork:covers[cur.id]?[{src:covers[cur.id],sizes:'512x512',type:'image/jpeg'}]:[]})}catch(e){}
  const h=(a,f)=>{try{navigator.mediaSession.setActionHandler(a,f)}catch(e){}};
  h('play',()=>play());h('pause',()=>pause());h('seekbackward',()=>skip(-1));h('seekforward',()=>skip(1));
  h('previoustrack',()=>prevCh());h('nexttrack',()=>nextCh());
}
function aSeekBy(d){if(!au.duration)return;au.currentTime=Math.max(0,Math.min(au.duration-.5,au.currentTime+d));aT=au.currentTime;aTick(true)}
function aTick(force){
  if(!cur||!useAudio())return;
  aT=au.currentTime;const d=au.duration||0;
  $('#seek').value=Math.round(1000*(d?aT/d:0));
  const pc=Math.round(100*(ci+(d?aT/d:0))/cur.chapters.length);
  $('#l2').textContent=pc+'% · '+(remaining(cur)?'restano '+fmtDur(remaining(cur)):'');
  $('#mprog').style.width=pc+'%';
  if(force||Date.now()-aSave>5000){aSave=Date.now();save()}
  if(d&&Date.now()-aPos>1000&&'mediaSession' in navigator&&navigator.mediaSession.setPositionState){aPos=Date.now();try{navigator.mediaSession.setPositionState({duration:d,position:Math.min(aT,d),playbackRate:speed})}catch(e){}}
}
async function aPlay(){
  try{speechSynthesis.cancel()}catch(e){}pStop();
  playing=true;const my=++tok;pend=0;ui();
  const id=cur.id,n=ci;
  try{
    const bl=await aBlob(id,n,my,true);
    if(my!==tok)return;
    if(aUrl)URL.revokeObjectURL(aUrl);aUrl=URL.createObjectURL(bl);
    au.src=aUrl;au.playbackRate=speed;au.preservesPitch=true;au.webkitPreservesPitch=true;
    await new Promise(r=>{au.onloadedmetadata=r;setTimeout(r,8000)});
    if(my!==tok)return;
    const d=au.duration||0;
    const t=aT0>0?aT0:(aF>0&&d?aF*d:0);aT0=0;aF=0;
    if(t>0&&d)au.currentTime=Math.min(t,Math.max(0,d-1));
    aT=au.currentTime;
    await au.play();
    if(my!==tok)return;
    mediaSess();ui();
    if(hasAud(id,n+1))aBlob(id,n+1,my,false).catch(()=>{});   /* scarica in anticipo il capitolo successivo */
  }catch(e){
    if(my!==tok)return;
    if(e&&e.name==='NotAllowedError'){playing=false;ui();toast('Tocca ▶ per avviare l’audio');return}
    console.error(e);toast('Audio: '+((e&&e.message)||e));pause();
  }
}
au.addEventListener('timeupdate',()=>aTick());
au.addEventListener('ended',()=>{
  if(!playing||!useAudio())return;aT0=0;
  if(sleepEoc&&ci===sleepCh){sleepDone();return}
  if(ci+1<cur.chapters.length)jump(ci+1,0);else pause();
});
au.addEventListener('error',()=>{if(playing&&useAudio()&&au.src&&!au.src.startsWith('data:')){toast('Audio non riproducibile');pause()}});

/* ---------- controlli di riproduzione ---------- */
function play(){
  if(!cur)return;
  if(useAudio()){aPlay();return}
  try{au.pause()}catch(e){}
  if(isPiper()){try{speechSynthesis.cancel()}catch(e){}pStop();pAttach(mkCtx());mediaSess();playing=true;const my=++tok;pend=0;ui();pRun(my);return}
  if(!('speechSynthesis' in window)){toast('Questo browser non supporta la sintesi vocale');return}
  pStop();speechSynthesis.cancel();playing=true;const my=++tok;pend=0;qc=ci;qs=segs;qi=si;keepAlive(pickVoice());mediaSess();ui();setTimeout(()=>feed(my),60)
}
function pause(){playing=false;tok++;pend=0;clearInterval(ka);ka=0;pStop();try{au.pause();aT=au.currentTime}catch(e){}try{speechSynthesis.cancel()}catch(e){}save();ui()}
function loadCh(i,s){ci=i;segs=buildSegs(cur.chapters[i]);si=Math.max(0,Math.min(s,segs.length-1))}
function jump(i,s){
  const was=playing;tok++;pend=0;pStop();try{au.pause()}catch(e){}try{speechSynthesis.cancel()}catch(e){}
  if(i!==ci||s!==si){aT=0;aT0=0}
  if(sleepEoc)sleepCh=i;
  loadCh(i,s);save();was?play():ui();
}
function skip(dir){useAudio()?aSeekBy(15*dir):jump(ci,si+4*dir)}
function prevCh(){if(cur)jump(Math.max(0,(useAudio()?aT>5:si>3)?ci:ci-1),0)}
function nextCh(){if(cur&&ci+1<cur.chapters.length)jump(ci+1,0)}
async function openBook(id){
  const b=books.find(x=>x.id===id);if(!b)return;
  try{await ensureChapters(b)}catch(e){return toast('Errore di download: '+e.message)}
  if(cur&&cur.id!==id){pause()}
  if(!cur||cur.id!==id){cur=b;const p=prog(id);aT=0;aT0=p.at||0;loadCh(Math.min(p.ch||0,b.chapters.length-1),p.si||0);ls('sb_last',id);lastKey=''}
  openPlayer();play();
}
function openPlayer(){const p=$('#pl');p.classList.add('open');p.setAttribute('aria-hidden','false')}
function minimize(){const p=$('#pl');p.classList.remove('open');p.setAttribute('aria-hidden','true')}
function closePlayer(){   /* ✕: ferma, chiude il lettore (il libro resta in «Continua ad ascoltare») */
  pause();cur=null;segs=[];lastKey='';
  $('#mini').style.display='none';minimize();
  try{if('mediaSession' in navigator){navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none'}}catch(x){}
  refresh();
}
let lastKey='';
function uiBook(force){
  if(!cur)return;
  const key=cur.id+'|'+ci+'|'+(covers[cur.id]||'')+'|'+cur.title+'|'+(cur.author||'');
  if(key===lastKey&&!force)return;lastKey=key;
  $('#mcv').innerHTML=cover(cur);$('#mt').innerHTML=`<b>${esc(cur.title)}</b><small>${esc(cur.chapters[ci].t)}</small>`;
  $('#pcv').innerHTML=cover(cur);$('#pt').textContent=cur.title;$('#pa').textContent=cur.author||'';
  $('#pch').textContent=cur.chapters[ci].t;
}
const setIcon=(el,n)=>{if(el.dataset.i!==n){el.dataset.i=n;el.innerHTML=ic(n)}};
function ui(){
  if(!cur)return;
  $('#mini').style.display='flex';uiBook();
  const g=segs[si]||segs[segs.length-1],am=useAudio();
  $('#now').textContent=am?'Audio narrato · usa i pulsanti per spostarti di 15 secondi':(g?g.d:'');
  const fr=am?(au.duration?aT/au.duration:0):si/Math.max(1,segs.length),pc=Math.round(100*(ci+fr)/cur.chapters.length);
  $('#seek').value=am?Math.round(1000*fr):Math.round(1000*si/Math.max(1,segs.length-1));
  $('#l1').textContent=`Capitolo ${ci+1} di ${cur.chapters.length}`;
  $('#l2').textContent=pc+'%'+(remaining(cur)?' · restano '+fmtDur(remaining(cur)):'');
  $('#mprog').style.width=pc+'%';
  setIcon($('#pp'),playing?'pause':'play');setIcon($('#mplay'),playing?'pause':'play');
  $('#pp').setAttribute('aria-label',playing?'Pausa':'Riproduci');$('#mplay').setAttribute('aria-label',playing?'Pausa':'Riproduci');
  $('#sp span').textContent=speed+'×';
  sleepLabel();
}
$('#pp').onclick=$('#mplay').onclick=()=>playing?pause():play();
$('#mt').onclick=openPlayer;
$('#mx').onclick=e=>{e.stopPropagation();closePlayer()};
$('#close').onclick=minimize;
$('#pmenu').onclick=()=>cur&&bookMenu(cur.id);
$('#seek').onchange=e=>{if(useAudio()){if(au.duration){au.currentTime=e.target.value/1000*au.duration;aTick(true)}}else jump(ci,Math.round(e.target.value/1000*(segs.length-1)))};
$('#bk').onclick=()=>skip(-1);$('#fw').onclick=()=>skip(1);
$('#pc').onclick=prevCh;$('#nc').onclick=nextCh;

/* velocità */
const SPEEDS=[.75,.9,1,1.1,1.25,1.5,1.75,2];
function setSpeed(v){speed=v;ls('sb_speed',v);if(useAudio()){au.playbackRate=speed;ui()}else if(playing)jump(ci,si);else ui()}
function speedSheet(){
  sheet('<h3>Velocità di lettura</h3>'+SPEEDS.map(v=>item(`data-s="${v}"`,v===speed?'check':'',v+'×',v===1?'normale':'',v===speed?'on':'')).join(''));
  $('#sheet').onclick=e=>{const x=e.target.closest('[data-s]');if(x){closeSheet();setSpeed(+x.dataset.s);if(view==='set')paintSettings()}};
}
$('#sp').onclick=speedSheet;

/* timer di spegnimento: a tempo oppure a fine capitolo */
let sleepT=null,sleepEnd=0,sleepEoc=false,sleepCh=0;
function sleepClear(){clearTimeout(sleepT);sleepT=null;sleepEnd=0;sleepEoc=false}
function sleepDone(){sleepClear();pause();toast('Timer scaduto: buonanotte');sleepLabel()}
function sleepLabel(){
  const s=$('#sl span'),on=!!(sleepEnd||sleepEoc);
  s.textContent=sleepEoc?'Fine cap.':sleepEnd?Math.max(1,Math.ceil((sleepEnd-Date.now())/60000))+' min':'Timer';
  $('#sl').classList.toggle('on',on);
}
function setSleep(m){
  sleepClear();
  if(m==='eoc'){sleepEoc=true;sleepCh=ci;toast('Mi fermo alla fine del capitolo')}
  else if(m){sleepEnd=Date.now()+m*60000;sleepT=setTimeout(sleepDone,m*60000);toast('Timer impostato: '+m+' minuti')}
  sleepLabel();
}
$('#sl').onclick=()=>{
  sheet('<h3>Timer di spegnimento</h3>'+[[0,'Nessun timer'],[5,'5 minuti'],[15,'15 minuti'],[30,'30 minuti'],[45,'45 minuti'],[60,'1 ora'],['eoc','Fine del capitolo']].map(([v,t])=>item(`data-m="${v}"`,'',t,'',(v===0&&!sleepEnd&&!sleepEoc)||(v==='eoc'&&sleepEoc)?'on':'')).join(''));
  $('#sheet').onclick=e=>{const x=e.target.closest('[data-m]');if(x){closeSheet();setSleep(x.dataset.m==='eoc'?'eoc':+x.dataset.m)}};
};
setInterval(()=>{if(sleepEnd)sleepLabel()},30000);

/* capitoli */
$('#chs').onclick=()=>{
  if(!cur)return;
  sheet('<h3>Capitoli</h3>'+cur.chapters.map((c,i)=>item(`data-c="${i}"`,hasAud(cur.id,i)?'phones':'',`${i+1}. ${esc(c.t)}`,'',i===ci?'on':'')).join(''));
  const on=$('#sheet .on');if(on)on.scrollIntoView({block:'center'});
  $('#sheet').onclick=e=>{const b=e.target.closest('[data-c]');if(b){closeSheet();jump(+b.dataset.c,0)}};
};

/* voce di lettura */
const vTag=v=>/natural|neural/i.test(v.name)?'★ Neurale · online':/premium|enhanced|migliorat|potenziat/i.test(v.name)?'★ Alta qualità':v.localService===false?'Online':'Sul dispositivo';
function vTips(){
  const u=navigator.userAgent;
  const t=/iPhone|iPad/i.test(u)?'Su iPhone/iPad: Impostazioni → Accessibilità → Contenuto letto → Voci → Italiano, e scarica le voci «Premium» o «Avanzata» (per esempio Alice, Federica, Luca). Poi riapri questa pagina.'
   :/Android/i.test(u)?'Su Android: Impostazioni → Sintesi vocale (o «Servizi vocali di Google») → installa le voci italiane di qualità alta e scegli la migliore. Poi riapri questa pagina.'
   :/Edg\//.test(u)?'In Edge compaiono le voci «Online (Natural)» di Microsoft (Elsa, Diego, Isabella e altre): sono tra le più realistiche e non richiedono installazioni.'
   :/Mac/i.test(u)?'Su Mac: Impostazioni → Accessibilità → Contenuto letto → Voce di sistema → Gestisci voci → Italiano, e scarica le voci «Premium». Con Edge trovi anche le voci «Online (Natural)».'
   :'Per voci molto più naturali apri questa pagina con Microsoft Edge: offre le voci «Online (Natural)» (Elsa, Diego, Isabella e altre) senza installare nulla.';
  return '<p class="note">'+t+'</p>';
}
async function pickPiper(full,btn){
  const E=eng(full),id=full.slice(full.indexOf(':')+1);
  if(!E||!E.ok()){toast('Questo browser non supporta le voci offline');return false}
  mkCtx();
  const sm=btn.querySelector('small'),say=t=>{sm.textContent=t};
  say('Controllo i componenti…');
  const miss=await E.check();
  if(miss.length){say('Componenti mancanti ('+miss.join(', ')+'): esegui su GitHub l’azione «Prepara Piper».');return false}
  if(!(await E.has(id))){
    try{await E.download(id,p=>say('Scarico la voce… '+Math.round(p*100)+'%'))}
    catch(e){say('Download non riuscito: '+((e&&e.message)||e));return false}
  }
  pCache.clear();voiceName=full;ls('sb_voice',voiceName);closeSheet();
  if(playing)jump(ci,si);
  if(view==='set')paintSettings();
  return true;
}
async function voiceSheet(){
  loadVoices();const cv=pickVoice(),pv=!!eng(voiceName);
  let pip='';
  const E=window.PIPER;
  if(E&&E.ok()){
    const st=await Promise.all(E.VOICES.map(v=>E.has(v.id)));
    pip='<h4>Voci offline (Piper)</h4>'+E.VOICES.map((v,k)=>item(`data-p="piper:${v.id}"`,'',esc(v.nome),st[k]?'Pronta · funziona senza internet':'Da scaricare una volta · '+esc(v.info),voiceName==='piper:'+v.id?'on':'')).join('')+'<p class="note">Sintesi neurale che gira sul tuo dispositivo. Dopo il primo download legge anche senza internet; sui telefoni più vecchi può essere lenta.</p>';
  }
  const nA=cur?audCount(cur.id):0,on=cur&&audOn(cur.id);
  const audBtn=nA?item('data-aud="1"','phones',`Audio narrato (${nA} capitoli)`,on?'Attivo: i capitoli con audio si ascoltano con la voce del narratore':'Disattivato: si usa la voce scelta qui sotto',on?'on':''):'';
  sheet('<h3>Voce di lettura</h3>'+audBtn+(voices.length?'<h4>Voci del dispositivo</h4>'+voices.map(v=>item(`data-v="${esc(v.name)}"`,'',esc(v.name),vTag(v),!pv&&cv&&v.name===cv.name?'on':'')).join(''):'<p>Nessuna voce italiana trovata sul dispositivo.</p>')+vTips()+pip);
  $('#sheet').onclick=e=>{
    const t=e.target.closest('[data-aud]');
    if(t){
      const was=useAudio(),fr=was?(au.duration?aT/au.duration:0):0;
      ls('sb_au_'+cur.id,on?'off':'on');closeSheet();
      if(was){aT=0;jump(ci,Math.floor(fr*Math.max(1,segs.length)))}                 /* dall'audio alla voce: stesso punto del capitolo */
      else if(useAudio()){aF=si/Math.max(1,segs.length);const w=playing;if(w)jump(ci,0);else ui()}   /* dalla voce all'audio */
      else ui();
      return}
    const p=e.target.closest('[data-p]');if(p){pickPiper(p.dataset.p,p);return}
    const b=e.target.closest('[data-v]');if(b){voiceName=b.dataset.v;ls('sb_voice',voiceName);closeSheet();if(playing)jump(ci,si);if(view==='set')paintSettings()}
  };
}
$('#vo').onclick=voiceSheet;

/* scorciatoie da tastiera (computer) */
addEventListener('keydown',e=>{
  if(e.target.closest&&e.target.closest('input,textarea,select,[contenteditable]'))return;
  if(e.key==='Escape'){if(sheetOpen())closeSheet();else if($('#pl').classList.contains('open'))minimize();return}
  if(!cur||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key===' '&&!e.target.closest('button,a,label')){e.preventDefault();playing?pause():play()}
  else if(e.key==='ArrowLeft'){e.preventDefault();e.shiftKey?prevCh():skip(-1)}
  else if(e.key==='ArrowRight'){e.preventDefault();e.shiftKey?nextCh():skip(1)}
});

/* ---------- schermata di caricamento: si mostra solo finché i dati locali non sono pronti ---------- */
(()=>{
  const el=$('#boot'),bar=$('#bootbar'),st=$('#bootst'),go=$('#bootgo');
  const tasks={},label={};let closed=false;
  const upd=()=>{if(closed)return;const k=Object.keys(tasks),f=k.reduce((a,n)=>a+tasks[n],0)/Math.max(1,k.length);
    bar.style.width=Math.round(f*100)+'%';const open=k.find(n=>tasks[n]<1);st.textContent=open?label[open]:'Quasi pronto…'};
  const close=()=>{if(closed)return;closed=true;bar.style.width='100%';el.classList.add('out');setTimeout(()=>el.remove(),400)};
  const set=(n,f,txt)=>{tasks[n]=Math.min(1,f);if(txt)label[n]=txt;upd()};
  const finish=n=>{set(n,1);if(Object.keys(tasks).every(k=>tasks[k]>=1))close()};
  const limit=(p,ms)=>Promise.race([p,new Promise(r=>setTimeout(r,ms))]);
  const run=(n,fn,ms)=>limit(Promise.resolve().then(fn).catch(e=>console.warn('Avvio «'+n+'»: '+((e&&e.message)||e))),ms).then(()=>finish(n));
  /* i passaggi si registrano tutti prima di partire, così la barra non si chiude a metà */
  set('lib',0,'Carico la libreria…');set('cover',0,'Carico le copertine…');set('voci',0,'Preparo le voci…');
  setTimeout(()=>go.classList.add('on'),8000);go.onclick=close;   /* via d’uscita se qualcosa non risponde */

  async function bootLib(){
    await sbReady();
    books=SBTG.cached();render();
    if(books.length){   /* catalogo già sul dispositivo: l’app si apre subito, Telegram si aggiorna in secondo piano */
      SBTG.list().then(()=>refresh()).catch(e=>toast('Catalogo non aggiornato: '+e.message));
    }else{
      try{await SBTG.list()}catch(e){toast('Catalogo non raggiungibile: '+e.message)}
      render();
    }
  }
  async function bootCovers(){
    const need=books.filter(b=>b.cover),tot=need.length;
    if(!tot)return;
    for(;;){
      const n=need.filter(b=>covers[b.id]).length;
      set('cover',n/tot,'Carico le copertine ('+n+'/'+tot+')…');
      if(n>=tot)return;
      await new Promise(r=>setTimeout(r,250));
    }
  }
  async function bootVoices(){
    if('speechSynthesis' in window){
      await limit(new Promise(r=>{
        if((speechSynthesis.getVoices()||[]).length)return r();
        speechSynthesis.addEventListener('voiceschanged',r,{once:true});
      }),2000);
      loadVoices();
    }
    set('voci',.4);
    const wait=(k,ev)=>window[k]?0:new Promise(r=>addEventListener(ev,r,{once:true}));
    await limit(Promise.all([wait('PIPER','piper-load'),wait('KOKORO','kokoro-load')]),3000);
    if(voiceName.startsWith('kokoro:')){voiceName='';ls('sb_voice','')}   /* Kokoro non legge più dal vivo */
    /* verifica che i file dell’audiolibro Kokoro siano davvero sul dispositivo; se manca un capitolo lo si toglie dal registro */
    if(window.KOKORO){
      for(const key of Object.keys(localStorage).filter(x=>x.startsWith('sb_kau_'))){
        const id=key.slice(7),m=kauGet(id),ok=[];
        for(const n of m.done)if(await KOKORO.kaudHas(id,n))ok.push(n);
        if(ok.length!==m.done.length){m.done=ok;kauSet(id,m)}
      }
    }
  }
  run('lib',bootLib,20000).then(()=>run('cover',bootCovers,6000));
  run('voci',bootVoices,12000).then(()=>{   /* la voce offline scelta si prepara dopo l’apertura, senza far attendere */
    const E=eng(voiceName);if(!E||!E.warm)return;
    const id=voiceName.slice(voiceName.indexOf(':')+1);
    E.has(id).then(h=>h&&E.warm(id)).catch(()=>{});
  });
  setTimeout(close,30000);
})();

$('#tgout').onclick=async()=>{await sbReady();SBTG.menu()};
let rt=0;
addEventListener('sbtg-cover',e=>{covers[e.detail.id]=e.detail.url;clearTimeout(rt);rt=setTimeout(()=>{refresh();if(cur)uiBook(true)},150)});
addEventListener('sbtg-catalog',e=>{
  const old=new Map(books.map(b=>[b.id,b]));
  books=e.detail.map(b=>{const o=old.get(b.id);return o&&o.chapters?{...b,chapters:o.chapters,lang:b.lang||o.lang,minutes:b.minutes||o.minutes}:b});
  if(cur){const n=books.find(b=>b.id===cur.id);if(n&&n!==cur){n.chapters=n.chapters||cur.chapters;cur=n}}
  refresh();
});
addEventListener('online',()=>refresh());
applyTheme();
if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
