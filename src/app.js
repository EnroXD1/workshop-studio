import {parseGIF,decompressFrame} from 'gifuct-js';
import {zipSync,strToU8} from 'fflate';
import {clamp,geometry,cropRect,frameSchedule,patchGIF} from './core.js';
const $=id=>document.getElementById(id),$$=s=>[...document.querySelectorAll(s)];
const canvas=$('preview'),ctx=canvas.getContext('2d',{willReadFrequently:true});
const state={source:null,kind:'demo',width:1500,height:860,duration:6,start:0,end:6,time:0,playing:!matchMedia('(prefers-reduced-motion: reduce)').matches,rows:1,heightMode:'430',customHeight:430,zoom:1,x:0,y:0,fit:'cover',fps:15,colors:256,border:'none',format:'gif',brightness:100,contrast:100,saturation:100,view:'split',dirty:true,busy:false};
let objectURL,loadId=0,worker,cancelled=false,workerReject,toastTimer,lastTick=performance.now(),lastUi=0,archiveURL,resultURLs=[];
const demo=document.createElement('canvas');demo.width=1500;demo.height=860;const dc=demo.getContext('2d');
function notify(message,error=false){$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?12000:5000);}
function desiredHeight(){if(state.heightMode==='auto')return clamp(Math.round(750*state.height/state.width),30,1500);return state.heightMode==='custom'?state.customHeight:Number(state.heightMode);}
function geo(){return geometry(state.rows,desiredHeight());}
function filter(){return `brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturation}%)`;}
function demoFrame(t){
  const w=1500,h=860,phase=t/6*Math.PI*2;
  dc.clearRect(0,0,w,h);const sky=dc.createLinearGradient(0,0,w,h);sky.addColorStop(0,'#081925');sky.addColorStop(.5,'#194b55');sky.addColorStop(1,'#0b2333');dc.fillStyle=sky;dc.fillRect(0,0,w,h);
  const glow=dc.createRadialGradient(1050,310,10,1050,310,460);glow.addColorStop(0,'#a8dacb50');glow.addColorStop(.5,'#508c8d18');glow.addColorStop(1,'#1b444600');dc.fillStyle=glow;dc.fillRect(0,0,w,h);
  for(let i=0;i<80;i++){const x=(Math.sin(i*27.4)*.5+.5)*1500,y=(Math.cos(i*9.7)*.5+.5)*410;dc.globalAlpha=.15+(.5+.5*Math.sin(phase+i))*.4;dc.fillStyle='#d7f4df';dc.fillRect(x,y,i%5===0?2:1,i%5===0?2:1);}dc.globalAlpha=1;
  dc.save();dc.translate(1045,305+Math.sin(phase)*8);dc.fillStyle='#b6d9c7';dc.shadowBlur=42;dc.shadowColor='#9de3cc66';dc.beginPath();dc.arc(0,0,108,0,Math.PI*2);dc.fill();dc.shadowBlur=0;dc.globalCompositeOperation='destination-out';for(let i=0;i<11;i++){dc.fillRect(-110,15+i*10,220,2+i*.35);}dc.restore();
  const ridges=[{c:'#173f48',y:470,a:130,p:0},{c:'#0c303a',y:535,a:170,p:18},{c:'#08242e',y:640,a:155,p:37},{c:'#061b25',y:745,a:130,p:51}];
  ridges.forEach((r,k)=>{dc.beginPath();dc.moveTo(0,h);for(let x=0;x<=w+20;x+=20){const y=r.y-Math.abs(Math.sin(x*.005+r.p)*r.a)-Math.sin(x*.012+r.p)*30+Math.sin(phase)*k*2;dc.lineTo(x,y);}dc.lineTo(w,h);dc.fillStyle=r.c;dc.fill();if(k===1){dc.strokeStyle='#7fd2b029';dc.lineWidth=2;dc.stroke();}});
  dc.save();dc.globalAlpha=.18;dc.strokeStyle='#8bd3b3';dc.lineWidth=1;for(let i=0;i<7;i++){const y=760+i*i*2;dc.beginPath();dc.moveTo(0,y);dc.lineTo(w,y);dc.stroke();}dc.restore();
  dc.font='500 13px monospace';dc.letterSpacing='4px';dc.fillStyle='#abcbb380';dc.fillText('MAKE YOUR PROFILE A WORLD OF ITS OWN',55,796);dc.letterSpacing='0px';
  return demo;
}
class GIFSource{
  constructor(buffer){
    const bytes=new Uint8Array(buffer);if(bytes.length<14)throw Error('GIF повреждён');
    this.width=bytes[6]|bytes[7]<<8;this.height=bytes[8]|bytes[9]<<8;
    if(!this.width||!this.height||this.width*this.height>16e6||this.width>8000||this.height>8000)throw Error('GIF слишком большой: максимум 16 мегапикселей на кадр.');
    if(bytes.at(-1)===0x21)bytes[bytes.length-1]=0x3b;
    this.gif=parseGIF(bytes.buffer);this.frames=this.gif.frames.filter(f=>f.image);
    if(!this.frames.length||this.frames.length>10000)throw Error('В GIF нет кадров или их слишком много (максимум 10 000).');
    if(this.frames.some(f=>f.image.descriptor.width*f.image.descriptor.height>16e6))throw Error('GIF содержит слишком большой кадр.');
    this.ends=[];let total=0;for(const f of this.frames){total+=(f.gce?.delay||10)*.01;this.ends.push(total);}this.duration=total;
    this.canvas=document.createElement('canvas');this.canvas.width=this.width;this.canvas.height=this.height;this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});
    this.patch=document.createElement('canvas');this.pc=this.patch.getContext('2d');this.index=-1;this.prev=null;this.saved=null;
  }
  at(time){
    let target=this.ends.findIndex(e=>e>time+1e-7);if(target<0)target=this.frames.length-1;
    if(target<this.index){this.ctx.clearRect(0,0,this.width,this.height);this.index=-1;this.prev=null;this.saved=null;}
    while(this.index<target){
      if(this.prev?.disposalType===2){const d=this.prev.dims;this.ctx.clearRect(d.left,d.top,d.width,d.height);}
      if(this.prev?.disposalType===3&&this.saved)this.ctx.putImageData(this.saved,0,0);
      const f=decompressFrame(this.frames[++this.index],this.gif.gct,true);
      this.saved=f.disposalType===3?this.ctx.getImageData(0,0,this.width,this.height):null;
      const d=f.dims;this.patch.width=d.width;this.patch.height=d.height;this.pc.putImageData(new ImageData(f.patch,d.width,d.height),0,0);this.ctx.drawImage(this.patch,d.left,d.top);this.prev=f;
    }
    return this.canvas;
  }
}
function sourceAt(t){if(state.kind==='demo')return demoFrame(t);if(state.kind==='gif')return state.source.at(t);return state.source;}
function draw(t=state.time,target=canvas){
  const g=geo();if(target.width!==g.width||target.height!==g.height){target.width=g.width;target.height=g.height;}
  const c=target===canvas?ctx:target.getContext('2d',{willReadFrequently:true});c.filter='none';c.fillStyle='#0b1015';c.fillRect(0,0,g.width,g.height);
  const src=sourceAt(t);if(!src)return;c.save();c.filter=filter();c.imageSmoothingQuality='high';const r=cropRect(state.width,state.height,g.width,g.height,state.zoom,state.x,state.y,state.fit);c.drawImage(src,r.x,r.y,r.width,r.height);c.restore();
  if(state.border!=='none'){c.strokeStyle=state.border==='light'?'#dbeee5':'#101416';c.lineWidth=1;for(let i=0;i<g.count;i++){const x=i%5*150,y=Math.floor(i/5)*g.tileHeight;c.strokeRect(x+.5,y+.5,149,g.tileHeight-1);}}
  if(target===canvas&&state.view==='split')$$('#tileOverlay canvas').forEach((tile,i)=>{if(tile.width!==150||tile.height!==g.tileHeight){tile.width=150;tile.height=g.tileHeight;}tile.getContext('2d').drawImage(canvas,i%5*150,Math.floor(i/5)*g.tileHeight,150,g.tileHeight,0,0,150,g.tileHeight);});
  state.dirty=false;
}
function activate(selector,key,value){$$(selector).forEach(b=>{const on=b.dataset[key]===String(value);b.classList.toggle('active',on);b.setAttribute('aria-pressed',on);});}
function updateGeometry(){
  const g=geo();$('dimensions').textContent=`${g.width} × ${g.height}`;$('tileSize').textContent=`150 × ${g.tileHeight} px`;$('partsCount').textContent=`${g.count} частей`;$('layoutLabel').textContent=`${g.count} частей`;
  const overlay=$('tileOverlay');overlay.style.gridTemplateColumns='repeat(5,minmax(0,1fr))';overlay.style.gridTemplateRows=`repeat(${g.rows},minmax(0,1fr))`;overlay.innerHTML=Array.from({length:g.count},(_,i)=>`<div class="tile"><canvas width="150" height="${g.tileHeight}"></canvas><span>${String(i+1).padStart(2,'0')}</span></div>`).join('');$('stage').classList.toggle('split-mode',state.view==='split');
  overlay.classList.toggle('whole',state.view==='whole');$('exportSummary').textContent=`${g.count} ${state.format==='gif'?'GIF':'PNG'}-файлов`;$('customHeightWrap').hidden=state.heightMode!=='custom';state.dirty=true;updateTime();
}
function updateTime(writeFields=true){
  const length=state.end-state.start;$('durationLabel').textContent=`${length.toFixed(2)} сек`;$('exportDuration').textContent=state.format==='png'?'Текущий кадр':`${length.toFixed(2)} с`;
  $('scrub').max=state.duration;$('scrub').value=state.time;$('trimStart').max=Math.max(0,state.duration-.05);$('trimEnd').max=state.duration;$('currentTime').textContent=state.time.toFixed(2);
  $('selectionArea').style.left=`${state.start/state.duration*100}%`;$('selectionArea').style.right=`${(1-state.end/state.duration)*100}%`;
  if(writeFields){$('trimStart').value=state.start.toFixed(2);$('trimEnd').value=state.end.toFixed(2);}
}
function updatePlay(){ $('playBtn').setAttribute('aria-label',state.playing?'Приостановить':'Воспроизвести');$('playBtn').innerHTML=`<svg><use href="#${state.playing?'pause':'play'}"/></svg>`; }
async function setPlaying(on){
  if(state.busy)return;state.playing=on&&state.kind!=='image';lastTick=performance.now();
  if(state.kind==='video'){if(state.playing){if(state.time>=state.end)await seek(state.start);try{await state.source.play();}catch{state.playing=false;}}else state.source.pause();}
  updatePlay();state.dirty=true;
}
async function seek(t){
  t=clamp(t,0,Math.max(0,state.duration-.001));state.time=t;state.dirty=true;
  if(state.kind!=='video')return;
  const video=state.source;if(Math.abs(video.currentTime-t)<.0005&&video.readyState>=2)return;
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>done(Error('Не удалось прочитать кадр видео. Попробуйте MP4 H.264.')),15000);const onSeek=()=>done(),onError=()=>done(Error('Ошибка чтения видео'));function done(err){clearTimeout(timer);video.removeEventListener('seeked',onSeek);video.removeEventListener('error',onError);err?reject(err):resolve();}video.addEventListener('seeked',onSeek,{once:true});video.addEventListener('error',onError,{once:true});video.currentTime=t;});
}
function releaseSource(){if(state.kind==='video'&&state.source){state.source.pause();state.source.removeAttribute('src');state.source.load();}if(state.kind==='image')state.source?.close?.();if(objectURL){URL.revokeObjectURL(objectURL);objectURL=null;}}
async function loadFile(file){
  if(!file||state.busy)return;if(file.size>200*1024*1024){notify('Максимальный размер файла — 200 МБ.',true);return;}
  const id=++loadId;$('fileName').textContent='Открываем файл…';let candidateURL;
  try{
    let source,kind,width,height,duration;
    const header=new Uint8Array(await file.slice(0,12).arrayBuffer());
    if(/^GIF8[79]a$/.test(String.fromCharCode(...header.subarray(0,6)))){source=new GIFSource(await file.arrayBuffer());kind='gif';({width,height,duration}=source);source.at(0);}
    else if(file.type.startsWith('image/')||/\.(png|jpe?g|webp)$/i.test(file.name)){source=await createImageBitmap(file);kind='image';({width,height}=source);duration=1;if(width*height>50e6){source.close();throw Error('Изображение слишком большое: максимум 50 мегапикселей.');}}
    else{
      source=document.createElement('video');candidateURL=URL.createObjectURL(file);source.muted=true;source.playsInline=true;source.preload='auto';
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(Error('Браузер не смог открыть видео. Используйте MP4 H.264 или WebM.')),20000);function finish(error){clearTimeout(timer);source.onloadeddata=null;source.onerror=null;error?reject(error):resolve();}source.onloadeddata=()=>finish();source.onerror=()=>finish(Error('Этот видеокодек не поддерживается браузером. Конвертируйте файл в MP4 H.264 или WebM.'));source.src=candidateURL;source.load();});
      kind='video';width=source.videoWidth;height=source.videoHeight;duration=source.duration;if(!Number.isFinite(duration)||!duration||!width)throw Error('Не удалось определить длительность или размер видео.');
    }
    if(id!==loadId){if(candidateURL)URL.revokeObjectURL(candidateURL);source.close?.();return;}
    releaseSource();objectURL=candidateURL;Object.assign(state,{source,kind,width,height,duration,start:0,end:Math.min(duration,10),time:0,playing:false,x:0,y:0,zoom:1,dirty:true});
    $('zoom').value=100;$('zoomValue').textContent='100%';$('demoLabel').hidden=true;$('mediaBadge').textContent=kind==='image'?'ИЗОБРАЖЕНИЕ':kind.toUpperCase();$('fileName').textContent=file.name;$('fileMeta').textContent=`${width} × ${height} px · ${(file.size/1024/1024).toFixed(2)} МБ${kind!=='image'?` · ${duration.toFixed(2)} с`:''} · нажмите для замены`;
    $('trimStart').disabled=kind==='image';$('trimEnd').disabled=kind==='image';$('playBtn').disabled=kind==='image';$('trimHint').textContent=kind==='image'?'Статичное изображение':duration>10?'Выбраны первые 10 секунд':'Весь фрагмент зациклится в GIF';
    updateGeometry();updatePlay();draw();notify('Файл открыт. Настройте композицию и скачайте части.');
  }catch(e){if(candidateURL)URL.revokeObjectURL(candidateURL);$('fileName').innerHTML='Перетащите файл или <em>выберите на устройстве</em>';notify(e.message||'Не удалось открыть файл.',true);}
  $('fileInput').value='';
}
function animate(now){
  try{
    const dt=Math.min((now-lastTick)/1000,.15);lastTick=now;
    if(!state.busy&&state.playing){if(state.kind==='video'){state.time=state.source.currentTime;if(state.time>=state.end||state.source.ended){state.source.currentTime=state.start;state.source.play().catch(()=>{});state.time=state.start;}}else{state.time+=dt;if(state.time>=state.end)state.time=state.start+(state.time-state.end)%(state.end-state.start);}state.dirty=true;}
    if(state.dirty&&!state.busy)draw();if(now-lastUi>80){$('scrub').value=state.time;$('currentTime').textContent=state.time.toFixed(2);lastUi=now;}
  }catch(e){state.playing=false;updatePlay();notify('Не удалось отобразить кадр: '+e.message,true);}
  requestAnimationFrame(animate);
}
function progress(value,message){$('progressBar').style.width=`${Math.round(value*100)}%`;$('progressText').textContent=message;}
function workerCall(data,transfer=[]){
  return new Promise((resolve,reject)=>{workerReject=err=>finish(err);const timeout=setTimeout(()=>finish(Error('Кодирование заняло слишком много времени. Уменьшите высоту или палитру.')),60000);function finish(err,result){clearTimeout(timeout);workerReject=null;err?reject(err):resolve(result);}worker.onmessage=({data:r})=>r.type==='error'?finish(Error(r.message)):finish(null,r);worker.onerror=e=>finish(Error(e.message||'Ошибка рабочего потока'));worker.postMessage(data,transfer);});
}
async function encodeGIF(g){
  const schedule=state.kind==='image'?[{time:0,delay:1000}]:frameSchedule(state.end-state.start,state.fps);
  if(schedule.length>1200)throw Error('Максимум 1200 кадров за экспорт. Сократите фрагмент или снизьте FPS.');
  worker=new Worker(globalThis.WORKSHOP_ENCODER_URL||new URL('encoder.js',import.meta.url),{type:'module'});await workerCall({type:'init',config:{height:g.height,rows:g.rows,colors:state.colors}});
  for(let i=0;i<schedule.length;i++){
    if(cancelled)throw Error('Экспорт отменён');const frame=schedule[i];if(state.kind==='video')await seek(state.start+frame.time);draw(state.start+frame.time);
    const buffer=ctx.getImageData(0,0,750,g.height).data.buffer;await workerCall({type:'frame',buffer,delay:frame.delay},[buffer]);
    progress((i+1)/schedule.length*.94,`Кадр ${i+1} / ${schedule.length} · ${Math.round((i+1)/schedule.length*100)}%`);
  }
  const result=await workerCall({type:'finish'});worker.terminate();worker=null;return result.files;
}
async function encodePNG(g){
  draw();const tile=document.createElement('canvas');tile.width=150;tile.height=g.tileHeight;const tc=tile.getContext('2d');const files=[];
  for(let i=0;i<g.count;i++){
    if(cancelled)throw Error('Экспорт отменён');tc.clearRect(0,0,150,g.tileHeight);tc.drawImage(canvas,i%5*150,Math.floor(i/5)*g.tileHeight,150,g.tileHeight,0,0,150,g.tileHeight);
    const blob=await new Promise(resolve=>tile.toBlob(resolve,'image/png'));if(!blob)throw Error('Не удалось создать PNG');files.push(new Uint8Array(await blob.arrayBuffer()));progress((i+1)/g.count*.94,`Часть ${i+1} / ${g.count}`);
  }
  return files;
}
function downloadURL(url,name){const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();}
function downloadBlob(bytes,name,type='application/zip'){const url=URL.createObjectURL(new Blob([bytes],{type}));downloadURL(url,name);setTimeout(()=>URL.revokeObjectURL(url),60000);}
function clearResults(){if(archiveURL)URL.revokeObjectURL(archiveURL);archiveURL=null;resultURLs.forEach(URL.revokeObjectURL);resultURLs=[];$('resultsGrid').replaceChildren();}
async function exportFiles(){
  if(state.busy)return;
  const requestedStart=Number($('trimStart').value),requestedEnd=Number($('trimEnd').value);
  if(!Number.isFinite(requestedStart)||!Number.isFinite(requestedEnd)||requestedStart<0||requestedEnd>state.duration+.005||requestedEnd-requestedStart<.02){notify('Задайте корректный фрагмент длиной не меньше 0.02 с в пределах исходного файла.',true);return;}
  state.start=requestedStart;state.end=Math.min(state.duration,requestedEnd);updateTime();
  const g=geo(),wasTime=state.time;await setPlaying(false);state.busy=true;cancelled=false;document.body.classList.add('is-busy');
  const controls=$$('input,select,button').filter(el=>el.id!=='cancelExport').map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);
  $('exportProgress').hidden=false;progress(0,'Подготовка кадров…');
  try{
    const files=state.format==='gif'?await encodeGIF(g):await encodePNG(g);if(cancelled)throw Error('Экспорт отменён');
    const hex=state.format==='gif'&&$('hexPatch').checked,limit=Number($('sizeLimit').value)*1024*1024;const oversized=files.filter(f=>f.length>limit).length;
    const description=`Workshop Studio\n\n${g.count} частей · 5 колонок × ${g.rows} ряд(а)\nКаждая часть: 150 × ${g.tileHeight} px\nОбщий размер: 750 × ${g.height} px\nФормат: ${state.format.toUpperCase()}\nФрагмент: ${state.start.toFixed(2)}–${state.end.toFixed(2)} с\nFPS: ${state.fps}\nЦветов: ${state.colors}\nHex Patch: ${hex?'включён':'выключен'}\n\nПорядок: слева направо, затем следующий ряд.\n${oversized?'ВНИМАНИЕ: '+oversized+' файл(а) превышают выбранный лимит. Снизьте FPS, палитру, высоту или длительность и повторите экспорт.\n':''}Hex Patch меняет последний байт 3B на 21 для длинных GIF в Steam Workshop. Применяйте только при необходимости.\nФайлы обработаны локально в браузере.\n`;
    const zipFiles={'README.txt':strToU8(description)},names=[];
    files.forEach((bytes,i)=>{const name=`${String(i+1).padStart(2,'0')}_row${Math.floor(i/5)+1}_col${i%5+1}${hex?'_steam':''}.${state.format}`;names.push(name);zipFiles[name]=hex?patchGIF(bytes):bytes;});
    progress(.97,'Упаковываем ZIP…');await new Promise(r=>setTimeout(r,0));const zip=zipSync(zipFiles,{level:0});clearResults();archiveURL=URL.createObjectURL(new Blob([zip],{type:'application/zip'}));
    files.forEach((bytes,i)=>{const normalURL=URL.createObjectURL(new Blob([bytes],{type:`image/${state.format}`}));resultURLs.push(normalURL);const linkURL=hex?URL.createObjectURL(new Blob([zipFiles[names[i]]],{type:'image/gif'})):normalURL;if(hex)resultURLs.push(linkURL);
      const card=document.createElement('div');card.className='result-card'+(bytes.length>limit?' over':'');const img=document.createElement('img');img.src=normalURL;img.alt=`Часть ${i+1}, ряд ${Math.floor(i/5)+1}, колонка ${i%5+1}`;const a=document.createElement('a');a.href=linkURL;a.download=names[i];a.innerHTML=`<span>${String(i+1).padStart(2,'0')} · ${(bytes.length/1024/1024).toFixed(2)} МБ</span><span>↓</span>`;card.append(img,a);$('resultsGrid').append(card);
    });
    $('resultsMessage').textContent=oversized?`${oversized} из ${g.count} частей превышают выбранный лимит ${$('sizeLimit').value} МБ. Уменьшите FPS, палитру, высоту или длительность и повторите нарезку. Файлы выше лимита отмечены оранжевым.`:`${g.count} частей · каждая 150 × ${g.tileHeight} px · все в пределах выбранного лимита ${$('sizeLimit').value} МБ${hex?' · Steam Hex Patch применён':''}.`;
    $('resultsPanel').hidden=false;progress(1,'Готово');downloadURL(archiveURL,`workshop_${g.rows}x5${hex?'_steam':''}.zip`);notify(oversized?'ZIP готов, но есть части выше лимита. Проверьте блок результатов.':'ZIP готов. Распакуйте архив и загружайте части по номерам.',!!oversized);
  }catch(e){notify(e.message||'Экспорт не удался. Попробуйте уменьшить фрагмент.',!cancelled);}
  finally{if(worker){worker.terminate();worker=null;}state.busy=false;state.time=wasTime;document.body.classList.remove('is-busy');controls.forEach(([el,disabled])=>el.disabled=disabled);$('exportProgress').hidden=true;if(state.kind==='video')await seek(wasTime).catch(()=>{});state.dirty=true;}
}
$('fileInput').addEventListener('change',e=>loadFile(e.target.files[0]));$('dropzone').addEventListener('click',()=>$('fileInput').click());
['dragenter','dragover'].forEach(type=>$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.add('dragover');}));['dragleave','drop'].forEach(type=>$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.remove('dragover');if(type==='drop')loadFile(e.dataTransfer.files[0]);}));
document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>e.preventDefault());
$$('[data-rows]').forEach(b=>b.addEventListener('click',()=>{state.rows=Number(b.dataset.rows);activate('[data-rows]','rows',state.rows);updateGeometry();}));
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;activate('[data-view]','view',state.view);updateGeometry();}));
$$('[data-fps]').forEach(b=>b.addEventListener('click',()=>{state.fps=Number(b.dataset.fps);activate('[data-fps]','fps',state.fps);}));
$$('[data-format]').forEach(b=>b.addEventListener('click',()=>{state.format=b.dataset.format;activate('[data-format]','format',state.format);updateGeometry();}));
$('heightMode').addEventListener('change',e=>{state.heightMode=e.target.value;updateGeometry();});$('customHeight').addEventListener('change',e=>{state.customHeight=clamp(Number(e.target.value)||430,30,1500);e.target.value=state.customHeight;updateGeometry();});
$('colors').addEventListener('change',e=>state.colors=Number(e.target.value));$('border').addEventListener('change',e=>{state.border=e.target.value;state.dirty=true;});$('fit').addEventListener('change',e=>{state.fit=e.target.value;state.x=state.y=0;state.dirty=true;});
$('zoom').addEventListener('input',e=>{state.zoom=Number(e.target.value)/100;$('zoomValue').textContent=e.target.value+'%';state.dirty=true;});$('resetCrop').addEventListener('click',()=>{state.x=state.y=0;state.zoom=1;$('zoom').value=100;$('zoomValue').textContent='100%';state.dirty=true;});
let dragStart;
$('stage').addEventListener('pointerdown',e=>{if(state.busy)return;dragStart={x:e.clientX,y:e.clientY,sx:state.x,sy:state.y};$('stage').setPointerCapture(e.pointerId);});
$('stage').addEventListener('pointermove',e=>{if(!dragStart)return;const g=geo(),r=cropRect(state.width,state.height,g.width,g.height,state.zoom,0,0,state.fit),box=$('stage').getBoundingClientRect(),dx=(r.width-g.width)/2,dy=(r.height-g.height)/2;state.x=dx>0?clamp(dragStart.sx+(e.clientX-dragStart.x)*g.width/box.width/dx,-1,1):0;state.y=dy>0?clamp(dragStart.sy+(e.clientY-dragStart.y)*g.height/box.height/dy,-1,1):0;state.dirty=true;});
['pointerup','pointercancel','lostpointercapture'].forEach(type=>$('stage').addEventListener(type,()=>dragStart=null));
const presets={original:[100,100,100],vivid:[105,115,145],cinema:[95,125,75],mono:[100,110,0],soft:[110,85,80]};
function colorPreset(name){[state.brightness,state.contrast,state.saturation]=presets[name];['brightness','contrast','saturation'].forEach(k=>{$(k).value=state[k];$(k+'Value').textContent=state[k]+'%';});activate('[data-preset]','preset',name);state.dirty=true;}
$$('[data-preset]').forEach(b=>b.addEventListener('click',()=>colorPreset(b.dataset.preset)));$('resetColor').addEventListener('click',()=>colorPreset('original'));
['brightness','contrast','saturation'].forEach(k=>$(k).addEventListener('input',e=>{state[k]=Number(e.target.value);$(k+'Value').textContent=state[k]+'%';activate('[data-preset]','preset','custom');state.dirty=true;}));
$('playBtn').addEventListener('click',()=>setPlaying(!state.playing));$('scrub').addEventListener('input',async e=>{await setPlaying(false);await seek(Number(e.target.value)).catch(e=>notify(e.message,true));});
function trimChange(key,final=true){if(state.busy)return;const input=$(key==='start'?'trimStart':'trimEnd'),value=Number(input.value);if(!final&&(!input.value||!Number.isFinite(value)||value<0||value>state.duration||(key==='start'?value>=state.end:value<=state.start)))return;state[key]=clamp(Number.isFinite(value)?value:0,key==='end'?state.start+.02:0,key==='start'?Math.max(0,state.end-.02):state.duration);if(state.time<state.start||state.time>=state.end)seek(state.start).catch(e=>notify(e.message,true));updateTime(final);}
['input','change','blur'].forEach(type=>{$('trimStart').addEventListener(type,()=>trimChange('start',type!=='input'));$('trimEnd').addEventListener(type,()=>trimChange('end',type!=='input'));});
$('exportBtn').addEventListener('click',exportFiles);$('cancelExport').addEventListener('click',()=>{cancelled=true;if(workerReject)workerReject(Error('Экспорт отменён'));if(worker){worker.terminate();worker=null;}});$('downloadAgain').addEventListener('click',()=>{if(archiveURL)downloadURL(archiveURL,'workshop_parts.zip');});
$('demoBtn').addEventListener('click',()=>{if(state.busy)return;loadId++;releaseSource();Object.assign(state,{source:null,kind:'demo',width:1500,height:860,duration:6,start:0,end:6,time:0,playing:true,x:0,y:0,zoom:1,dirty:true});$('zoom').value=100;$('zoomValue').textContent='100%';$('fileName').innerHTML='Перетащите файл или <em>выберите на устройстве</em>';$('fileMeta').textContent='MP4, WebM, MOV, GIF, PNG, JPG, WebP · до 200 МБ';$('mediaBadge').textContent='ДЕМО';$('demoLabel').hidden=false;['trimStart','trimEnd','playBtn'].forEach(id=>$(id).disabled=false);$('trimHint').textContent='Весь фрагмент зациклится в GIF';updateGeometry();updatePlay();});
$('patchBtn').addEventListener('click',()=>$('patchInput').click());$('patchInput').addEventListener('change',async e=>{const selected=[...e.target.files];e.target.value='';if(!selected.length)return;if(selected.length>15){notify('Выберите не больше 15 GIF за один раз.',true);return;}if(selected.some(f=>f.size>200*1024*1024)||selected.reduce((s,f)=>s+f.size,0)>300*1024*1024){notify('Максимум 200 МБ на файл и 300 МБ на набор.',true);return;}$('patchBtn').disabled=true;try{const zip={};for(let i=0;i<selected.length;i++){const f=selected[i];zip[`${String(i+1).padStart(2,'0')}_${f.name.replace(/\.gif$/i,'').replace(/[\\/]/g,'_')}_steam.gif`]=patchGIF(await f.arrayBuffer());}downloadBlob(zipSync(zip,{level:0}),'workshop_hex_patched.zip');$('patchStatus').textContent=`Готово: ${selected.length} GIF · применён патч 3B → 21`;notify('Патч применён. ZIP скачан.');}catch(err){notify(err.message,true);}finally{$('patchBtn').disabled=false;}});
['helpBtn','guideBtn'].forEach(id=>$(id).addEventListener('click',()=>$('helpDialog').showModal()));['closeHelp','helpDone'].forEach(id=>$(id).addEventListener('click',()=>$('helpDialog').close()));$('helpDialog').addEventListener('click',e=>{if(e.target===$('helpDialog')){const r=$('helpDialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('helpDialog').close();}});
updateGeometry();updatePlay();draw();requestAnimationFrame(animate);
