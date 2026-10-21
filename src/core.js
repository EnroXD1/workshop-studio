export const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export function geometry(rows,height){
  rows=clamp(Math.round(Number(rows)||1),1,3);
  const tileHeight=Math.ceil(clamp(Number(height)||430,30,1500)/rows);
  return {width:750,height:tileHeight*rows,tileWidth:150,tileHeight,rows,count:rows*5};
}
export function splitRGBA(data,width,height,rows){
  const tileHeight=height/rows;
  if(width!==750||!Number.isInteger(tileHeight)||data.length!==width*height*4)throw Error('Неверная геометрия кадра');
  return Array.from({length:rows*5},(_,i)=>{
    const tile=new Uint8Array(150*tileHeight*4),left=(i%5)*150,top=Math.floor(i/5)*tileHeight;
    for(let y=0;y<tileHeight;y++){const from=((top+y)*width+left)*4;tile.set(data.subarray(from,from+600),y*600);}
    return tile;
  });
}
export function frameSchedule(duration,fps){
  const count=Math.max(1,Math.ceil(duration*fps-1e-6));
  return Array.from({length:count},(_,i)=>({time:i/fps,delay:Math.max(10,(Math.round(Math.min(duration,(i+1)/fps)*100)-Math.round(i/fps*100))*10)}));
}
export function patchGIF(input){
  const bytes=new Uint8Array(input);
  if(bytes.length<14||!/^GIF8[79]a$/.test(String.fromCharCode(...bytes.subarray(0,6))))throw Error('Файл не является GIF');
  if(bytes.at(-1)!==0x3b&&bytes.at(-1)!==0x21)throw Error('В GIF нет ожидаемого завершающего байта 3B. Файл не изменён.');
  const result=bytes.slice();result[result.length-1]=0x21;return result;
}
export function cropRect(sw,sh,ow,oh,zoom=1,x=0,y=0,fit='cover'){
  const scale=(fit==='contain'?Math.min(ow/sw,oh/sh):Math.max(ow/sw,oh/sh))*zoom;
  const dw=sw*scale,dh=sh*scale;
  return {x:(ow-dw)/2+clamp(x,-1,1)*Math.max(0,(dw-ow)/2),y:(oh-dh)/2+clamp(y,-1,1)*Math.max(0,(dh-oh)/2),width:dw,height:dh};
}
