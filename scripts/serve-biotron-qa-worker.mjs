// Local acceptance harness for the actual Pages worker; no remote storage or deploy.
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
const root=path.resolve(process.argv[2] || 'dist'), port=Number(process.argv[3] || 49291)
const {default:worker}=await import(pathToFileURL(path.join(root,'_worker.js')))
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.wasm':'application/wasm'}
const headers={}
for(const line of (await fs.readFile(path.join(root,'_headers'),'utf8')).split('\n')){
 if(!/^\s+\S+:/.test(line))continue
 const [name,...value]=line.trim().split(':');headers[name]=value.join(':').trim()
}
const env={ASSETS:{async fetch(request){
 const pathname=decodeURIComponent(new URL(request.url).pathname)
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname))
 if(!file.startsWith(root+path.sep))return new Response('Forbidden',{status:403})
 try{return new Response(await fs.readFile(file),{headers:{...headers,'Content-Type':mime[path.extname(file)]||'application/octet-stream'}})}
 catch{return new Response('Not found',{status:404,headers})}
}}}
http.createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})})
  const response=await worker.fetch(request,env)
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))
 }catch(error){res.writeHead(500);res.end(String(error))}
}).listen(port,'127.0.0.1',()=>console.log(`Local Pages-worker QA: http://localhost:${port}; telemetry storage unavailable intentionally`))
