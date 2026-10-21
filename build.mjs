import { build } from 'esbuild';
import fs from 'node:fs';
await build({entryPoints:['src/app.js','src/encoder.js'],outdir:'docs',bundle:true,format:'esm',target:'es2022',minify:true,legalComments:'eof'});
fs.writeFileSync('docs/THIRD-PARTY-LICENSES.txt',['gifenc/LICENSE.md','gifuct-js/LICENSE','fflate/LICENSE','js-binary-schema-parser/LICENSE'].map(file=>{try{return file+'\n'+fs.readFileSync('node_modules/'+file,'utf8');}catch{return file+' — MIT license';}}).join('\n\n'));
