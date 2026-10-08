// Render the actual Elementary voices; nothing is normalized after rendering.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const {execFileSync} = require('node:child_process')
const {chromium} = require('playwright-core')
const {chromePath} = require('./browser-test-harness')
const http = require('node:http')
const root = path.resolve(__dirname,'..')
const output = path.resolve(process.argv.find(arg=>arg.startsWith('--output='))?.slice(9) || `/private/tmp/biotron-auditions-${Date.now()}`)
const prefix=`scripts/_audition-${process.pid}`, entry=path.join(root,prefix+'.mjs'), bundle=path.join(root,prefix+'.js')
const sourceInputs = Object.fromEntries(['src/audio/auditionBanks.mjs','src/audio/elementary/timbres.mjs','src/audio/elementary/engine.mjs','scripts/test-audition-render.js','package.json','package-lock.json'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]))
const selectedCase=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7)
const timeoutMs=Number(process.env.AUDITION_TIMEOUT_MS)||30000
const cleanup=()=>{fs.rmSync(entry,{force:true});fs.rmSync(bundle,{force:true})}
process.on('exit',cleanup)
fs.writeFileSync(entry,"export {ElementarySynthEngine} from '../src/audio/elementary/engine.mjs'\nexport {AUDITION_BANKS,auditionEvents,auditionDuration} from '../src/audio/auditionBanks.mjs'\n")
execFileSync('npx',['--yes','esbuild@0.24.0',prefix+'.mjs','--bundle','--format=iife','--global-name=__Audition','--outfile='+prefix+'.js','--log-level=error'],{cwd:root,timeout:60000})
const server=http.createServer((request,response)=>{
 if(request.url==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><meta charset="utf-8"><title>Audition rendering</title>')}
 else if(request.url===`/${prefix}.js`){response.setHeader('Content-Type','text/javascript');response.end(fs.readFileSync(bundle))}
 else{response.writeHead(404);response.end()}
})
function wav(samples,sampleRate){
 const body=Buffer.alloc(44+samples.length*2);body.write('RIFF');body.writeUInt32LE(body.length-8,4);body.write('WAVEfmt ',8);body.writeUInt32LE(16,16);body.writeUInt16LE(1,20);body.writeUInt16LE(1,22);body.writeUInt32LE(sampleRate,24);body.writeUInt32LE(sampleRate*2,28);body.writeUInt16LE(2,32);body.writeUInt16LE(16,34);body.write('data',36);body.writeUInt32LE(samples.length*2,40)
 samples.forEach((sample,i)=>body.writeInt16LE(Math.round(Math.max(-1,Math.min(1,sample))*32767),44+i*2));return body
}
;(async()=>{
 fs.mkdirSync(output,{recursive:true})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const browser=await chromium.launch({executablePath:chromePath(),headless:true})
 try{
  let page
  const preparePage=async()=>{
  if(page)await page.close()
  page=await browser.newPage();page.setDefaultTimeout(timeoutMs)
  await page.addInitScript(()=>{
   window.__auditionIntervals=new Set();window.__auditionBlobs=new Set()
   const interval=window.setInterval,clear=window.clearInterval,create=URL.createObjectURL,revoke=URL.revokeObjectURL
   window.setInterval=(...args)=>{const id=interval(...args);window.__auditionIntervals.add(id);return id}
   window.clearInterval=id=>{window.__auditionIntervals.delete(id);clear(id)}
   URL.createObjectURL=blob=>{const url=create(blob);window.__auditionBlobs.add(url);return url}
   URL.revokeObjectURL=url=>{window.__auditionBlobs.delete(url);revoke(url)}
  })
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.addScriptTag({url:`http://127.0.0.1:${server.address().port}/${prefix}.js`})
  }
  const metrics=[],sampleRate=48000
  for(const quality of ['standard','safe']){
   for(let bankIndex=0;bankIndex<3;bankIndex++)for(let variantIndex=0;variantIndex<10;variantIndex++){
    const caseId=`${quality}/${['timbres','calibration','high-notes'][bankIndex]}/${variantIndex+1}`
    if(selectedCase&&selectedCase!==caseId)continue
    // OfflineAudioContext cannot be closed. Destroy each bank’s page so native
    // offline contexts do not accumulate; realtime repeated-close is a separate lane.
    if(variantIndex===0||selectedCase)await preparePage()
    let watchdog
    const running=page.evaluate(async({quality,bankIndex,variantIndex,sampleRate})=>{
     const {ElementarySynthEngine,AUDITION_BANKS,auditionEvents,auditionDuration}=window.__Audition
     const bank=AUDITION_BANKS[bankIndex],option=bank.variants[variantIndex],seconds=auditionDuration(bank.id)
     const render=async(events,preset=option.preset,duration=seconds,level=option.level??1,volume=70)=>{
      const context=new OfflineAudioContext(1,Math.ceil(sampleRate*duration),sampleRate), engine=new ElementarySynthEngine(context,{preset,quality,volume})
      const started=performance.now();window.__auditionPhase='initializing';await engine.ensureReady()
      const quantum=128/sampleRate,bySample=new Map()
      for(const event of events){const at=Math.max(0,Math.floor(event.at/quantum)*quantum-quantum);if(!bySample.has(at))bySample.set(at,[]);bySample.get(at).push(event)}
      let maximumVoices=0
      const chain=[...bySample].sort((a,b)=>a[0]-b[0]).reduce((next,[at,events])=>next.then(()=>(window.__auditionPhase=`suspend ${at}`,context.suspend(at)).then(async()=>{
       for(const event of events){if(event.type==='on')engine.noteOn('audition',0,event.note,event.velocity,event.at,level);else if(event.type==='off')engine.noteOff('audition',0,event.note,event.at);else engine.panic()}
       maximumVoices=Math.max(maximumVoices,engine.activeVoiceCount);window.__auditionPhase=`ref barrier ${at}`;await engine.whenIdle();window.__auditionPhase=`resume ${at}`;await context.resume()
      })),Promise.resolve())
      window.__auditionPhase='start rendering';const rendering=context.startRendering();await chain;window.__auditionPhase='finish rendering';const audio=await rendering
      const samples=audio.getChannelData(0),peak=samples.reduce((p,x)=>Math.max(p,Math.abs(x)),0),rms=Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length)
      const late=samples.slice(-sampleRate/5),tailPeak=late.reduce((p,x)=>Math.max(p,Math.abs(x)),0)
      const voices=engine.activeVoiceCount,poolSize=engine.poolSize
      window.__auditionPhase='release';await engine.stop()
      return {samples,peak,rms,tailPeak,nonFinite:samples.reduce((n,x)=>n+!Number.isFinite(x),0),maximumVoices,voices,poolSize,elapsedMs:performance.now()-started}
     }
     const phrase=await render(auditionEvents(bank.id))
     const chordEvents=Array.from({length:12},(_,i)=>({at:.05,type:'on',note:72+i,velocity:127})).concat([{at:.3,type:'panic'}])
     const chord=await render(chordEvents,option.preset,2,option.level??1,100)
     let middleDifference=null
     if(bank.id==='high-notes'&&variantIndex>0){
      const events=[{at:.05,type:'on',note:64,velocity:98},{at:.4,type:'off',note:64}]
      const current=await render(events,option.preset,2,1),control=await render(events,AUDITION_BANKS[2].variants[0].preset,2,1)
      middleDifference=current.samples.reduce((maximum,value,i)=>Math.max(maximum,Math.abs(value-control.samples[i])),0)
     }
     const {samples,...measurements}=phrase
     return {id:option.id,bank:bank.id,quality,option,measurements,retainedIntervals:window.__auditionIntervals.size,retainedBlobs:window.__auditionBlobs.size,chord:{peak:chord.peak,nonFinite:chord.nonFinite,maximumVoices:chord.maximumVoices,voices:chord.voices,poolSize:chord.poolSize},middleDifference,samples:quality==='standard'?Array.from(samples):null}
    },{quality,bankIndex,variantIndex,sampleRate})
    let result
    try{result=await Promise.race([running,new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(new Error(`Case ${caseId} exceeded ${timeoutMs} ms`)),timeoutMs)})])}
    catch(error){
     const phase=await Promise.race([page.evaluate(()=>window.__auditionPhase).catch(()=>null),new Promise(resolve=>setTimeout(()=>resolve('browser unresponsive'),1000))])
     fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({status:'FAIL',caseId,phase,error:error.message,completed:metrics.length,sourceInputs},null,2)+'\n');throw error
    }finally{clearTimeout(watchdog)}
    const {samples,...metric}=result
    if(samples){const audio=wav(samples,sampleRate);const name=result.id+'.wav';fs.writeFileSync(path.join(output,name),audio);metric.wav=name;metric.wavSha256=crypto.createHash('sha256').update(audio).digest('hex')}
    metrics.push(metric)
    fs.writeFileSync(path.join(output,'metrics.partial.json'),JSON.stringify(metrics,null,2)+'\n')
    assert.equal(result.retainedIntervals,0,result.id+': renderer retained a polling interval after Stop')
    assert.equal(result.retainedBlobs,0,result.id+': renderer retained a worklet Blob URL')
    assert.equal(result.measurements.nonFinite,0,result.id+': non-finite phrase')
    assert(result.measurements.peak>1e-5&&result.measurements.peak<.98,result.id+': silent or missing phrase headroom')
    assert.equal(result.measurements.voices,0,result.id+': phrase left held voices')
    assert(result.measurements.tailPeak<.001,result.id+': tail did not settle')
    assert.equal(result.chord.nonFinite,0,result.id+': non-finite chord')
    assert(result.chord.peak>1e-5&&result.chord.peak<.98,result.id+': full-volume chord lost headroom')
    assert.equal(result.chord.voices,0,result.id+': panic left voices')
    assert.equal(result.chord.maximumVoices,quality==='safe'?4:8,result.id+': voice cap changed')
    if(result.middleDifference!==null)assert(result.middleDifference<1e-6,result.id+': treatment changed the middle register')
    console.log(`${quality} ${result.id} PASS peak=${result.measurements.peak.toFixed(4)} middleDifference=${result.middleDifference}`)
   }
  }
  const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
  const sourceDirty=Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim())
  if(!selectedCase)assert.equal(metrics.length,60,'Incomplete bank coverage')
  for(const bank of ['timbres','calibration','high-notes']){const hashes=metrics.filter(x=>x.bank===bank&&x.quality==='standard').map(x=>x.wavSha256);assert.equal(new Set(hashes).size,hashes.length,bank+': duplicate rendered options')}
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({schema:'biotron-audition-render/v1',sourceCommit,sourceDirty,sourceInputs,bundleSha256:crypto.createHash('sha256').update(fs.readFileSync(bundle)).digest('hex'),sampleRate,masterVolume:70,chordMasterVolume:100,phraseNormalization:false,browser:browser.version(),metrics,status:selectedCase?'PARTIAL':'RENDERED',humanListening:'NOT RUN'},null,2)+'\n')
  console.log(`${metrics.filter(x=>x.wav).length} listening WAVs and ${metrics.length} quality/render cases passed${selectedCase ? " (selected diagnostic case only)" : ""}: ${output}`)
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));cleanup()}
})().catch(error=>{if(fs.existsSync(output)&&!fs.existsSync(path.join(output,'failure.json')))fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({status:'FAIL',error:error.message,sourceInputs},null,2)+'\n');console.error(error);process.exitCode=1})
