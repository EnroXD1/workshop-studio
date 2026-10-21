import assert from 'node:assert/strict';
import fs from 'node:fs';
import {geometry,splitRGBA,cropRect,frameSchedule,patchGIF} from './src/core.js';
import gifenc from 'gifenc';
const {GIFEncoder}=gifenc;
import {parseGIF,decompressFrames} from 'gifuct-js';
import {zipSync,unzipSync} from 'fflate';
for(const rows of [1,2,3]){
 const g=geometry(rows,430);assert.equal(g.count,rows*5);assert.equal(g.height%rows,0);
 const rgba=new Uint8Array(750*g.height*4);
 for(let y=0;y<g.height;y++)for(let x=0;x<750;x++){const i=(y*750+x)*4;rgba[i]=Math.floor(y/g.tileHeight)*5+Math.floor(x/150);rgba[i+1]=x%150;rgba[i+2]=y%g.tileHeight;rgba[i+3]=255;}
 const tiles=splitRGBA(rgba,750,g.height,rows);assert.equal(tiles.length,rows*5);
 tiles.forEach((tile,i)=>{assert.equal(tile.length,150*g.tileHeight*4);assert.equal(tile[0],i);assert.equal(tile[tile.length-4],i);assert.equal(tile[tile.length-3],149);assert.equal(tile[tile.length-2],(g.tileHeight-1)%256);});
}
for(const fps of [10,15,24,30]){const schedule=frameSchedule(2,fps);assert.equal(schedule.length,2*fps);assert.equal(schedule.reduce((s,f)=>s+f.delay,0),2000);}
assert.deepEqual(cropRect(1500,860,750,430),{x:0,y:0,width:750,height:430});
assert.equal(cropRect(1000,1000,750,430,1,0,-1).y,-320);
assert.equal(cropRect(1000,1000,750,430,1,0,0,'contain').width,430);
const gif=GIFEncoder(),palette=[[0,0,0],[255,80,0],[0,255,180],[30,50,180]];
for(let frame=0;frame<4;frame++){const idx=new Uint8Array(750*300);for(let y=0;y<300;y++)for(let x=0;x<750;x++)idx[y*750+x]=(Math.floor(x/150)+Math.floor(y/100)+frame)%4;gif.writeFrame(idx,750,300,{palette,delay:200,repeat:0});}gif.finish();const bytes=gif.bytes();
const parsed=parseGIF(bytes.buffer);assert.equal(decompressFrames(parsed).length,4);assert.equal(parsed.lsd.width,750);
const patched=patchGIF(bytes);assert.equal(patched.at(-1),0x21);assert.equal(bytes.at(-1),0x3b);assert.deepEqual(patchGIF(patched),patched);assert.throws(()=>patchGIF(new Uint8Array([1,2,3])));
const zip=unzipSync(zipSync({'01.gif':bytes,'02.gif':patched}));assert.deepEqual(zip['01.gif'],bytes);assert.equal(zip['02.gif'].at(-1),0x21);
fs.mkdirSync('../qa',{recursive:true});fs.writeFileSync('../qa/sample.gif',bytes);fs.writeFileSync('../qa/invalid.gif','invalid');
console.log('PASS: tile order and dimensions (1–3 rows), exact timing (10/15/24/30 FPS), cover/contain, GIF encoding/decoding, non-destructive hex patch, ZIP integrity.');
