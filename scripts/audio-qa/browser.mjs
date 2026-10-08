import {analyze,wav,SCORE} from './analyze.mjs'
export async function captureScore(Engine,mode='normal',signal){
 const context=new AudioContext({sampleRate:48000}),events=[],blocks=[];let engine,tap,drain,url,firstBlock
 const worklet=`class Capture extends AudioWorkletProcessor{constructor(){super();this.n=0;this.limit=sampleRate*8}process(inputs){const a=inputs[0]?.[0];if(a&&this.n<this.limit){this.port.postMessage({frame:currentFrame,pcm:a.slice()});this.n+=a.length}return true}}registerProcessor('qa-capture',Capture)`
 const wait=ms=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new DOMException('Stopped','AbortError'));const abort=()=>{clearTimeout(timer);reject(new DOMException('Stopped','AbortError'))};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},ms);signal?.addEventListener('abort',abort,{once:true})});let start=0
 try{
  await context.resume();engine=new Engine(context,{volume:70});await engine.ensureReady()
  url=URL.createObjectURL(new Blob([worklet],{type:'text/javascript'}));await context.audioWorklet.addModule(url)
  tap=new AudioWorkletNode(context,'qa-capture');drain=context.createGain();drain.gain.value=0;tap.connect(drain);drain.connect(context.destination)
  tap.port.onmessage=e=>{blocks.push(e.data);firstBlock?.(e.data.frame)}
  // Observe actual engine output after master processing; never a separate test oscillator.
  if(mode==='mute')engine.output.gain.value=0
  // A resumed context can still be waiting for its first device render block.
  // Anchor both the PCM and score to that block; retain warmup as an observation.
  const warmupStarted=performance.now()
  const firstFrame=await new Promise((resolve,reject)=>{
   let timer
   const abort=()=>finish(new DOMException('Stopped','AbortError'))
   const finish=(error,frame)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);firstBlock=null;error?reject(error):resolve(frame)}
   firstBlock=frame=>finish(null,frame)
   if(signal?.aborted)return abort()
   signal?.addEventListener('abort',abort,{once:true})
   timer=setTimeout(()=>finish(Error('No first audio block within10s; capture is not evidence')),10000)
   engine.output.connect(tap)
  })
  start=firstFrame/context.sampleRate;const wall=performance.now(),firstBlockWaitWallMs=wall-warmupStarted
  const action=async(at,name,fn)=>{await wait(Math.max(0,wall+at*1000-performance.now()));const event={name,expected:at,actual:context.currentTime-start,wall:performance.now()-wall};events.push(event);event.executed=fn()!==false}
  await action(SCORE.noteOn,'noteOn',()=>engine.noteOn('qa',1,69,100))
  await action(SCORE.noteOff,'noteOff',()=>{if(mode==='stuck')return false;engine.noteOff('qa',1,69)})
  await action(SCORE.panic,'panic',()=>{if(mode==='stuck')return false;engine.panic()})
  await wait(Math.max(0,wall+SCORE.seconds*1000-performance.now()));engine.output.disconnect(tap);await wait(100)
  const first=blocks[0]?.frame??0,n=Math.round(SCORE.seconds*context.sampleRate),pcm=new Float32Array(n);let expected=first,dropped=0
  for(const b of blocks){if(b.frame!==expected)dropped++;const offset=b.frame-first;if(offset<n&&offset>=0)pcm.set(b.pcm.subarray(0,Math.min(b.pcm.length,n-offset)),offset);expected=b.frame+b.pcm.length}
  if(expected-first<n-context.sampleRate*.1)dropped++
  const analysis=analyze([pcm],context.sampleRate,{dropped,clocksValid:events.every(e=>Math.abs(e.actual-e.expected)<.25)&&context.state==='running'})
  const detected=mode==='mute'?analysis.reasons.includes('MISSING_SIGNAL'):mode==='stuck'?analysis.reasons.includes('STUCK_TAIL'):analysis.result==='PASS'
  return {report:{task:'audio-realtime',mode,result:analysis.result==='INCONCLUSIVE'?'INCONCLUSIVE':detected?'PASS':'FAIL',mutationExpected:mode!=='normal',analysis,events,sampleRate:context.sampleRate,firstBlockWaitWallMs,scoreWallMs:performance.now()-wall,contextState:context.state,baseLatency:context.baseLatency,outputLatency:context.outputLatency,scope:'Isolated QA bench using production engine; not the running Play UI or physical output'},wav:wav([pcm],context.sampleRate)}
 }finally{
  firstBlock=null
  tap?.disconnect();drain?.disconnect()
  if(tap){tap.port.onmessage=null;tap.port.close()}
  // Closing the context alone leaves WebRenderer's polling interval alive.
  // Use the production stop path, including its pending-request cleanup.
  try{await engine?.stop()}
  finally{try{if(context.state!=='closed')await context.close()}finally{if(url)URL.revokeObjectURL(url)}}
 }
}
