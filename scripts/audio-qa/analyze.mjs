export const SCORE={id:'biotron-round-v2',seconds:7,noteOn:1,noteOff:2.5,panic:4,signal:[1.4,2.3],release:[3.4,3.9],tail:[5.8,6.8]}
export function analyze(channels,sampleRate,{dropped=0,clocksValid=true}={}){
 if(!channels.length||!Number.isFinite(sampleRate)||sampleRate<=0)throw Error('Invalid PCM format')
 const metrics=channels.map(samples=>{
  let peak=0,nonFinite=0,clipped=0,sum=0,squares=0
  for(const x of samples){if(!Number.isFinite(x)){nonFinite++;continue}peak=Math.max(peak,Math.abs(x));clipped+=Math.abs(x)>=.999;sum+=x;squares+=x*x}
  const rmsWindow=([a,b])=>{let n=0,s=0;for(let i=Math.floor(a*sampleRate);i<Math.min(samples.length,Math.floor(b*sampleRate));i++){s+=samples[i]*samples[i];n++}return n?Math.sqrt(s/n):null}
  return {samples:samples.length,seconds:samples.length/sampleRate,peak,nonFinite,clipped,dc:sum/samples.length,rms:Math.sqrt(squares/samples.length),signalRms:rmsWindow(SCORE.signal),releaseRms:rmsWindow(SCORE.release),tailRms:rmsWindow(SCORE.tail)}
 })
 // Fixture contract, not general musical quality thresholds. Round preset, volume 70.
 const reasons=[]
 if(metrics.some(m=>m.nonFinite))reasons.push('NON_FINITE')
 if(metrics.some(m=>m.clipped))reasons.push('CLIPPING')
 if(metrics.every(m=>m.signalRms===null||m.signalRms<.001))reasons.push('MISSING_SIGNAL')
 // Check Note Off before panic; a later panic must not hide a lost release.
 if(metrics.some(m=>m.releaseRms!==null&&m.releaseRms>.001))reasons.push('UNRELEASED_NOTE')
 if(metrics.some(m=>m.tailRms!==null&&m.tailRms>.001))reasons.push('STUCK_TAIL')
 const captureProblems=[]
 if(dropped>0)captureProblems.push('DROPPED_BLOCKS')
 if(!clocksValid)captureProblems.push('INVALID_CLOCKS')
 if(metrics.some(m=>m.seconds<SCORE.seconds-.1||m.releaseRms===null||m.tailRms===null))captureProblems.push('INCOMPLETE_PCM')
 return {result:captureProblems.length?'INCONCLUSIVE':reasons.length?'FAIL':'PASS',reasons,captureProblems,metrics,dropped,scope:'engine final gain PCM; no speaker or system-output claim',score:SCORE.id}
}
export function wav(channels,sampleRate){
 const count=channels.length,n=channels[0].length,b=new ArrayBuffer(44+n*count*4),v=new DataView(b)
 const str=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)))
 str(0,'RIFF');v.setUint32(4,b.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,3,true);v.setUint16(22,count,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*count*4,true);v.setUint16(32,count*4,true);v.setUint16(34,32,true);str(36,'data');v.setUint32(40,n*count*4,true)
 for(let i=0;i<n;i++)for(let c=0;c<count;c++)v.setFloat32(44+(i*count+c)*4,channels[c][i],true)
 return b
}
