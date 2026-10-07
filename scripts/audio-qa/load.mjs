import {captureScore} from './browser.mjs'
export async function runLoad(Engine,signal,frame){
 const rows=[],gaps=[];let last=0,raf,loadTimer,sceneTimer,rendered=false
 const onMessage=e=>{if(e.source===frame.contentWindow&&e.origin===location.origin&&e.data?.type==='garden-rendered')rendered=true}
 window.addEventListener('message',onMessage)
 const measure=now=>{if(last)gaps.push(now-last);last=now;raf=requestAnimationFrame(measure)};raf=requestAnimationFrame(measure)
 const send=data=>frame.contentWindow?.postMessage({type:'biotron-preview',...data},location.origin)
 frame.src='/garden/scene.html';
 try{
  await new Promise((resolve,reject)=>{const started=performance.now();const t=setInterval(()=>{if(signal.aborted){clearInterval(t);reject(new DOMException('Stopped','AbortError'))}else if(rendered){clearInterval(t);resolve()}else if(performance.now()-started>15000){clearInterval(t);reject(Error('Animation did not render; load test cannot pass'))}},100)})
  send({state:'ready'});sceneTimer=setInterval(()=>send({noteOn:true,pitch:60,velocity:90}),500)
  for(const budget of [0,4,10]){
   gaps.length=0;last=0
   if(budget)loadTimer=setInterval(()=>{const until=performance.now()+budget;while(performance.now()<until){Math.sqrt(Math.random())}},16)
   const data=await captureScore(Engine,'normal',signal)
   clearInterval(loadTimer);loadTimer=null
   const ordered=gaps.slice().sort((a,b)=>a-b)
   rows.push({syntheticMainThreadBusyMsPer16ms:budget,audio:data.report,animationRendered:rendered,uiFrameSamples:ordered.length,uiFrameP95Ms:ordered[Math.floor(ordered.length*.95)]??null,uiFrameMaxMs:ordered.at(-1)??null,heapBytes:performance.memory?.usedJSHeapSize??null})
  }
  return {result:rows.every(r=>r.audio.result==='PASS')?'PASS':'FAIL',rows,scope:'Synthetic main-thread contention plus actual Garden and isolated production audio engine; not hardware CPU throttling, physical output or sustained soak',animationQualityAcceptance:'NOT RUN: visual usability requires review',weakComputerAcceptance:'NOT RUN'}
 }finally{clearInterval(loadTimer);clearInterval(sceneTimer);cancelAnimationFrame(raf);window.removeEventListener('message',onMessage);send({state:'waiting',paused:true})}
}
