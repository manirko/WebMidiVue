const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs')
const {chromium,devices}=require('playwright-core')
const {chromePath,createStaticServer}=require('./browser-test-harness')
const server=createStaticServer(path.resolve(__dirname,'..','dist'))
const artifacts=process.env.AUDITION_BROWSER_OUTPUT||`/private/tmp/biotron-audition-browser-${Date.now()}`
fs.mkdirSync(artifacts,{recursive:true})
let page,stage='launch',starts=0
const progress=[]
const mark=value=>{stage=value;progress.push({stage,starts,at:new Date().toISOString()});fs.writeFileSync(path.join(artifacts,'progress.json'),JSON.stringify(progress,null,2))}
const boundedCapture=task=>Promise.race([task,new Promise(resolve=>setTimeout(()=>resolve({unavailable:'page did not respond within 1500ms'}),1500))])
;(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const browser=await chromium.launch({executablePath:chromePath(),headless:true})
 try{
  const context=await browser.newContext({viewport:{width:1366,height:900}})
  await context.addInitScript(()=>{
   window.__comparisonContexts=[];window.__comparisonMidiRequests=0
   window.__comparisonIntervals=new Set();window.__comparisonBlobs=new Set()
   const interval=window.setInterval,clear=window.clearInterval,create=URL.createObjectURL,revoke=URL.revokeObjectURL
   window.setInterval=(...args)=>{const id=interval(...args);window.__comparisonIntervals.add(id);return id}
   window.clearInterval=id=>{window.__comparisonIntervals.delete(id);clear(id)}
   URL.createObjectURL=blob=>{const url=create(blob);window.__comparisonBlobs.add(url);return url}
   URL.revokeObjectURL=url=>{window.__comparisonBlobs.delete(url);revoke(url)}
   const Native=window.AudioContext
   window.AudioContext=class extends Native{
    constructor(...args){super(...args);window.__comparisonContexts.push(this)
     const addModule=this.audioWorklet.addModule.bind(this.audioWorklet)
     this.audioWorklet.addModule=(...args)=>window.__delayModule?new Promise((resolve,reject)=>{window.__releaseModule=()=>addModule(...args).then(resolve,reject)}):addModule(...args)
    }
    close(){if(window.__failClose){window.__failClose=false;return Promise.reject(new Error('Injected audio close failure'))}return super.close()}
   }
   Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:()=>{window.__comparisonMidiRequests++;throw new Error('comparison must not request MIDI')}})
  })
  page=await context.newPage();const errors=[];page.setDefaultTimeout(8000)
  await context.tracing.start({screenshots:true,snapshots:true})
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/#/biotron/compare`)
  await page.getByRole('heading',{name:'Compare sounds',exact:true}).waitFor()
  const stopped=async()=>{
   await page.locator('.audio-compare[data-phase="idle"][data-active-voices="0"][data-timers="0"][data-audio-state="closed"]').waitFor()
   assert(await page.evaluate(()=>window.__comparisonContexts.every(context=>context.state==='closed')),'Stop left an open AudioContext')
   assert.equal(await page.evaluate(()=>window.__comparisonIntervals.size),0,'Stop retained a poller')
   assert.equal(await page.evaluate(()=>window.__comparisonBlobs.size),0,'Stop retained a Blob URL')
   assert(!(await page.locator('.audio-compare [role=status]').innerText()).includes('[object'),'Status rendered a click event')
  }
  let cases=0
  for(const group of ['Timbres','Calibration sounds','High-note treatments']){
   await page.getByRole('button',{name:group,exact:true}).click()
   const options=await page.locator('#compare-variant option').evaluateAll(elements=>elements.map(element=>element.value))
   assert.equal(options.length,10)
   for(const id of options){
    mark(`option ${group}/${id}: click Play`)
    await page.getByLabel('Option',{exact:true}).selectOption(id)
    await page.getByRole('button',{name:'Play example',exact:true}).click()
    await page.locator('.audio-compare[data-phase="playing"][data-audio-state="running"]').waitFor()
    await page.waitForFunction(()=>Number(document.querySelector('.audio-compare')?.dataset.activeVoices)>0)
    await page.getByRole('button',{name:'Stop example',exact:true}).click();await stopped();cases++;starts++
    mark(`option ${id}: released`)
   }
  }
  // Same page, 100 actual starts/closes: a fresh offline page is not this oracle.
  for(let index=cases;index<100;index++){
   mark(`repeat ${index+1}: click Play`)
   await page.getByRole('button',{name:'Play example',exact:true}).click()
   mark(`repeat ${index+1}: waiting for audio`)
   await page.locator('.audio-compare[data-phase="playing"][data-audio-state="running"]').waitFor()
   await page.getByRole('button',{name:'Stop example',exact:true}).click();await stopped();starts++
   mark(`repeat ${index+1}: released`)
  }
  mark('startup and release fault controls')
  await page.evaluate(()=>window.__delayModule=true)
  await page.getByRole('button',{name:'Play example',exact:true}).click()
  await page.waitForFunction(()=>Boolean(window.__releaseModule))
  await page.getByRole('button',{name:'Stop example',exact:true}).click();await stopped()
  await page.evaluate(()=>{window.__delayModule=false;window.__releaseModule()})
  await page.waitForTimeout(150)
  await stopped()
  await page.getByRole('button',{name:'Play example',exact:true}).click()
  await page.locator('.audio-compare[data-phase="playing"]').waitFor()
  await page.evaluate(()=>window.__failClose=true)
  await page.getByRole('link',{name:'Back to settings',exact:true}).click()
  await page.locator('.audio-compare[data-phase="error"]').waitFor()
  assert(page.url().endsWith('/biotron/compare'),'failed close allowed navigation away')
  assert(await page.getByRole('button',{name:'Play example',exact:true}).isDisabled())
  await page.getByRole('button',{name:'Stop example',exact:true}).click();await stopped()
  await page.getByRole('button',{name:'Play example',exact:true}).click()
  await page.locator('.audio-compare[data-phase="playing"]').waitFor()
  await page.evaluate(()=>window.__comparisonContexts.at(-1).suspend());await stopped()
  await page.getByRole('button',{name:'Play example',exact:true}).click()
  await page.locator('.audio-compare[data-phase="playing"]').waitFor()
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))})
  await stopped()
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))})
  assert.equal(await page.evaluate(()=>window.__comparisonMidiRequests),0,'preview sent a MIDI request')
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('biotron-audition-feedback-')).length),0,'preview inferred a listening outcome')
  // Natural end of each distinct phrase, not just an early Stop.
  for(const group of ['Timbres','Calibration sounds','High-note treatments']){
   await page.getByRole('button',{name:group,exact:true}).click()
   await page.getByRole('button',{name:'Play example',exact:true}).click()
   await page.locator('.audio-compare[data-phase="playing"]').waitFor();await stopped()
  }
  await page.getByRole('button',{name:'Play example',exact:true}).click()
  await page.locator('.audio-compare[data-phase="playing"]').waitFor()
  await page.getByLabel('Option',{exact:true}).selectOption('high-soft');await stopped()
  await page.getByRole('button',{name:'Play reference',exact:true}).click()
  await page.locator('.audio-compare[data-phase="playing"][data-variant="high-reference"]').waitFor()
  await page.getByRole('link',{name:'Back to settings',exact:true}).click()
  await page.getByRole('heading',{name:'Settings',exact:true}).waitFor()
  assert(await page.evaluate(()=>window.__comparisonContexts.every(context=>context.state==='closed')),'route leave retained audio')
  await page.getByText('NEW — Experiments',{exact:true}).click()
  await page.getByRole('link',{name:'Compare sounds · 10 × 3',exact:true}).click()
  await page.getByRole('heading',{name:'Compare sounds',exact:true}).waitFor()
  await page.getByLabel('What sounds better or worse?',{exact:true}).fill('Automated rejection fixture, no favourite')
  await page.getByLabel('What sounds better or worse?',{exact:true}).dispatchEvent('change')
  const noVote=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key=>key.startsWith('biotron-audition-feedback-')))))
  assert.equal(noVote.timbres.variantId,null);assert.equal(noVote.timbres.commentForVariantId,'tone-reference')
  await page.getByRole('button',{name:'Prefer this option',exact:true}).click()
  await page.getByLabel('What sounds better or worse?',{exact:true}).fill('Automated fixture, not a human outcome')
  await page.getByLabel('What sounds better or worse?',{exact:true}).dispatchEvent('change')
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download listening choices',exact:true}).click()
  const file=await(await download).path(),feedback=JSON.parse(fs.readFileSync(file,'utf8'))
  assert(feedback.buildId);assert.equal(feedback.choices.timbres.variantId,'tone-reference')
  assert.equal(feedback.choices.timbres.settings.volume,70)
  assert(feedback.choices.timbres.comment.includes('Automated fixture'))
  await page.reload();await page.locator('.compare-feedback').getByText('Round — reference',{exact:true}).waitFor()
  for(const profile of [{viewport:{width:320,height:700}},{...devices['iPhone 15'],isMobile:false}]){
   const mobile=await browser.newContext(profile);await mobile.addInitScript(()=>Object.defineProperty(navigator,'requestMIDIAccess',{value:undefined,configurable:true}))
   const tab=await mobile.newPage();await tab.goto(`http://127.0.0.1:${server.address().port}/#/biotron/compare`)
   await tab.getByRole('heading',{name:'Compare sounds',exact:true}).waitFor()
   assert(await tab.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'comparison overflows mobile')
   await tab.getByRole('button',{name:'High-note treatments',exact:true}).click();assert.equal(await tab.locator('#compare-variant option').count(),10)
   await mobile.close()
  }
  assert.deepEqual(errors,[])
  mark('PASS')
  await context.tracing.stop({path:path.join(artifacts,'trace.zip')})
  console.log(`Comparison browser: ${cases}/30 real-engine option Play/Stop, 100 repeated starts/closes without timers/Blobs, cancelled module load, failed-close route protection/retry, suspend/background release, three natural completions, switch/route release, reference, no MIDI or inferred outcome, explicit local feedback/export and 320/iPhone layout passed.`)
 }catch(error){
  const state=await boundedCapture(page?.evaluate(()=>({url:location.href,phase:document.querySelector('.audio-compare')?.dataset,contexts:window.__comparisonContexts.map(context=>({state:context.state,time:context.currentTime})),intervals:window.__comparisonIntervals.size,blobs:window.__comparisonBlobs.size,heap:performance.memory?.usedJSHeapSize})).catch(cause=>({unavailable:cause.message})))
  fs.writeFileSync(path.join(artifacts,'failure.json'),JSON.stringify({stage,starts,error:error.message,state},null,2))
  await boundedCapture(page?.screenshot({path:path.join(artifacts,'failure.png'),timeout:1000}).catch(()=>{}))
  await boundedCapture(page?.context().tracing.stop({path:path.join(artifacts,'trace.zip')}).catch(()=>{}))
  throw error
 }finally{console.log(`Browser evidence: ${artifacts}`);await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1})
