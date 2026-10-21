import fs from 'node:fs';
const out=process.argv[2];if(!out)throw Error('Provide output HTML path');
const worker=fs.readFileSync('docs/encoder.js','utf8');
const script='globalThis.WORKSHOP_ENCODER_URL=URL.createObjectURL(new Blob(['+JSON.stringify(worker)+'],{type:"text/javascript"}));\n'+fs.readFileSync('docs/app.js','utf8');
const css=fs.readFileSync('docs/style.css','utf8').replace(/@import url\([^;]+;/,'');
const icon='data:image/svg+xml;base64,'+fs.readFileSync('docs/icon.svg').toString('base64');
const html=fs.readFileSync('docs/index.html','utf8').replace('href="icon.svg"',()=> 'href="'+icon+'"').replace('<link rel="stylesheet" href="style.css">',()=>'<style>'+css+'</style>').replace('<script type="module" src="app.js"></script>',()=>'<script type="module">'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
fs.writeFileSync(out,html);console.log('Saved standalone offline HTML.');
