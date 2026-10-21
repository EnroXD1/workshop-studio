import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('docs');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.gif':'image/gif','.mp4':'video/mp4','.webm':'video/webm','.png':'image/png'};
http.createServer((req,res)=>{let pathname;try{pathname=decodeURIComponent(req.url.split('?')[0]);}catch{res.writeHead(400);res.end('Bad request');return;}const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.readFile(target,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});}).listen(4287,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4287'));
