import {GIFEncoder,quantize,applyPalette} from 'gifenc';
import {splitRGBA} from './core.js';
let config,encoders;
self.onmessage=({data})=>{
  try{
    if(data.type==='init'){config=data.config;encoders=Array.from({length:config.rows*5},()=>GIFEncoder());self.postMessage({type:'ready'});}
    if(data.type==='frame'){
      const tiles=splitRGBA(new Uint8Array(data.buffer),750,config.height,config.rows);
      tiles.forEach((rgba,i)=>{const palette=quantize(rgba,config.colors,{format:'rgb565'});const indexed=applyPalette(rgba,palette);encoders[i].writeFrame(indexed,150,config.height/config.rows,{palette,delay:data.delay,repeat:0,dispose:1});});
      const maxSize=Math.max(...encoders.map(e=>e.bytesView().length));
      if(encoders.reduce((s,e)=>s+e.bytesView().length,0)>180*1024*1024)throw Error('Результат слишком большой для памяти браузера. Уменьшите длительность или высоту.');
      self.postMessage({type:'frame',maxSize});
    }
    if(data.type==='finish'){const files=encoders.map(e=>{e.finish();return e.bytes();});self.postMessage({type:'done',files},files.map(f=>f.buffer));encoders=null;}
  }catch(e){self.postMessage({type:'error',message:e.message||'Не удалось закодировать GIF'});}
};
