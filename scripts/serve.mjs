// Static dev server for the whole repository, so every app and shared package
// resolves the same relative paths it will have on GitHub Pages.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve(process.argv.find(a=>a.startsWith('--root='))?.slice(7)||'.');
const port=Number(process.argv.find(a=>a.startsWith('--port='))?.slice(7)||process.env.PORT||5173);
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.md':'text/plain','.wasm':'application/wasm','.zip':'application/zip','.stl':'model/stl','.ply':'application/octet-stream'};
createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file=resolve(root,'.'+pathname);
    if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    if((await stat(file)).isDirectory()){
      if(!pathname.endsWith('/')){res.writeHead(301,{Location:pathname+'/'});res.end();return;}
      file=resolve(file,'index.html');
    }
    const bytes=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
  }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`LabStudio: http://localhost:${port}/`));
