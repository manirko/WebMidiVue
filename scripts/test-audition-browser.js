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
   window.__comparisonValues=[];window.__comparisonProperties=new Map();window.__keyboardRefsByGate=new Map()
   const post=MessagePort.prototype.postMessage
   MessagePort.prototype.postMessage=function(message,...args){
    if(message?.requestType==='renderInstructions')for(const instruction of message.payload.batch){
     if(instruction[0]===3 && instruction[2]==='value'){window.__comparisonProperties.set(instruction[1],instruction[3]);window.__comparisonValues.push(instruction[1]);if(window.__comparisonValues.length>200)window.__comparisonValues.shift()}
    }
    return post.call(this,message,...args)
   }
   window.__comparisonIntervals=new Set();window.__comparisonBlobs=new Set()
   const interval=window.setInterval,clear=window.clearInterval,create=URL.createObjectURL,revoke=URL.revokeObjectURL
   window.setInterval=(...args)=>{const id=interval(...args);window.__comparisonIntervals.add(id);return id}
   window.clearInterval=id=>{window.__comparisonIntervals.delete(id);clear(id)}
   URL.createObjectURL=blob=>{const url=create(blob);window.__comparisonBlobs.add(url);return url}
   URL.revokeObjectURL=url=>{window.__comparisonBlobs.delete(url);revoke(url)}
   const connect=AudioNode.prototype.connect
   AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination)window.__comparisonOutput=this
    return connect.call(this,destination,...args)
   }
   const Native=window.AudioContext
   window.AudioContext=class extends Native{
    constructor(...args){super(...args);window.__comparisonContexts.push(this)
     const addModule=this.audioWorklet.addModule.bind(this.audioWorklet)
     this.audioWorklet.addModule=(...args)=>window.__delayModule?new Promise((resolve,reject)=>{window.__releaseModule=()=>addModule(...args).then(resolve,reject)}):addModule(...args)
    }
    close(){if(window.__failClose){window.__failClose=false;return Promise.reject(new Error('Injected audio close failure'))}return super.close()}
   }
   const listeners=new Set()
   const input={id:'comparison-bioton',name:'Biotron Port 1',manufacturer:'Playtronica',state:'connected',connection:'closed',
    async open(){this.connection='open';return this},async close(){this.connection='closed';return this},
    addEventListener(type,fn){if(type==='midimessage')listeners.add(fn)},removeEventListener(type,fn){if(type==='midimessage')listeners.delete(fn)}}
   const output={...input,id:'comparison-output',send(data){window.__comparisonSent.push([...data])}}
   const access={inputs:new Map([[input.id,input]]),outputs:new Map([[output.id,output]]),addEventListener(){},removeEventListener(){}}
   window.__comparisonSent=[];window.__comparisonPorts=[input,output]
   window.__emitComparisonMidi=data=>{const event={data:Uint8Array.from(data)};for(const fn of listeners)fn(event);input.onmidimessage?.(event)}
   Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async()=>{window.__comparisonMidiRequests++;if(!window.__enableComparisonMidi)throw new Error('example must not request MIDI');return access}})
  })
  page=await context.newPage();const errors=[];page.setDefaultTimeout(8000)
  await context.tracing.start({screenshots:true,snapshots:true})
  page.on('pageerror',error=>errors.push(error.message))
  const palette=tab=>tab.locator('.sound-palette')
  const panel=(tab=page)=>tab.locator('.audio-compare:visible')
  const selection=(tab=page)=>panel(tab).locator('select')
  const enabledOptions=(tab=page)=>selection(tab).locator('option:not([disabled])')
  const details=(tab,name)=>name==='Sound'?palette(tab):tab.locator('details').filter({has:tab.locator('summary').filter({hasText:new RegExp('^'+name+'$')})})
  const openDetails=async(tab,name)=>{
   const section=details(tab,name)
   assert.equal(await section.count(),1,`${name} disclosure is missing or duplicated`)
   if(!await section.evaluate(element=>element.open))await section.locator('summary').click()
   await section.evaluate(element=>{if(!element.open)throw new Error('Disclosure did not open')})
   return section
  }
  const waitPlay=async(tab=page)=>{
   await tab.getByRole('heading',{name:'Plant music',exact:true}).waitFor()
   await openDetails(tab,'Sound');await selection(tab).waitFor()
  }
  const waitCompareAlias=async(tab=page)=>{
   await tab.getByRole('heading',{name:'Plant music',exact:true}).waitFor()
   assert(tab.url().endsWith('/biotron/play?sound=1'),'comparison alias did not open the Play sound palette')
   assert(await palette(tab).evaluate(element=>element.open),'sound query did not open the native palette')
   await selection(tab).waitFor()
   assert.equal(await panel(tab).getByRole('button',{name:'Play with Biotron',exact:true}).count(),0,'palette duplicated the primary connection action')
   assert.equal(await panel(tab).getByRole('button',{name:'Calibration sounds',exact:true}).count(),0,'calibration appeared in the musical palette')
  }
  const openCompareAlias=async()=>{await page.evaluate(()=>location.hash='/biotron/compare');await waitCompareAlias()}
  const taskLink=name=>page.getByRole('navigation',{name:'Biotron tasks'}).getByRole('link',{name,exact:true})
  let exampleMidiBaseline=null,settingsMidiRequests=0
  const assertExampleMidi=async()=>{
   if(exampleMidiBaseline!==null)assert.equal(await page.evaluate(()=>window.__comparisonMidiRequests),exampleMidiBaseline,'example requested MIDI')
  }
  const startExample=async()=>{
   exampleMidiBaseline=await page.evaluate(()=>window.__comparisonMidiRequests)
   await panel().getByRole('button',{name:'Listen to example',exact:true}).click()
  }
  const goSettings=async()=>{
   await assertExampleMidi()
   const before=await page.evaluate(()=>window.__comparisonMidiRequests)
   if(await taskLink('Settings').getAttribute('aria-current')!=='page')await taskLink('Settings').click()
   await page.getByRole('heading',{name:'Settings',exact:true}).waitFor()
   await openDetails(page,'Experiments');await selection().waitFor()
   settingsMidiRequests+=await page.evaluate(()=>window.__comparisonMidiRequests)-before
   exampleMidiBaseline=null
  }
  const goPlay=async()=>{
   await assertExampleMidi()
   const before=await page.evaluate(()=>window.__comparisonMidiRequests)
   if(await taskLink('Play').getAttribute('aria-current')!=='page')await taskLink('Play').click()
   await waitPlay()
   assert.equal(await page.evaluate(()=>window.__comparisonMidiRequests),before,'Play navigation requested MIDI')
   exampleMidiBaseline=null
  }
  const selectBank=async label=>{
   if(label==='Calibration sounds'){
    if(!/#\/biotron(?:\?|$)/.test(page.url()))await goSettings()
    else {await openDetails(page,'Experiments');await selection().waitFor()}
   }else if(/#\/biotron(?:\?|$)/.test(page.url()))await goPlay()
   else await openDetails(page,'Sound')
   await panel().getByRole('button',{name:label,exact:true}).click()
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/#/biotron/compare`)
  await waitCompareAlias()
  const stopped=async()=>{
   await page.locator('.sound-lab[data-example="idle"][data-active-voices="0"][data-example-timers="0"][data-audio-state="closed"]').waitFor({state:'attached'})
   assert(await page.evaluate(()=>window.__comparisonContexts.every(context=>context.state==='closed')),'Stop left an open AudioContext')
   assert.equal(await page.evaluate(()=>window.__comparisonIntervals.size),0,'Stop retained a poller')
   assert.equal(await page.evaluate(()=>window.__comparisonBlobs.size),0,'Stop retained a Blob URL')
   await assertExampleMidi();exampleMidiBaseline=null
   const status=panel().locator('[role=status]')
   if(await status.count())assert(!(await status.innerText()).includes('[object'),'Status rendered a click event')
  }
  let cases=0
  const keyboardOnly=process.argv.includes('--keyboard-only')
  if(!keyboardOnly){
  for(const group of ['Timbres','Calibration sounds','High-note treatments','Handpan']){
   await selectBank(group)
   const options=await enabledOptions().evaluateAll(elements=>elements.map(element=>element.value))
   assert.equal(options.length,group==='Handpan'?6:10)
   for(const id of options){
    mark(`option ${group}/${id}: click Play`)
    await selection().selectOption(id)
    await startExample()
    await page.locator('.sound-lab[data-example="playing"][data-audio-state="running"]').waitFor({state:'attached'})
    await page.waitForFunction(()=>Number(document.querySelector('.sound-lab')?.dataset.activeVoices)>0)
    await page.getByRole('button',{name:'Stop example',exact:true}).click();await stopped();cases++;starts++
    mark(`option ${id}: released`)
   }
  }
  // Same page, 100 actual starts/closes: a fresh offline page is not this oracle.
  for(let index=cases;index<100;index++){
   mark(`repeat ${index+1}: click Play`)
   await startExample()
   mark(`repeat ${index+1}: waiting for audio`)
   await page.locator('.sound-lab[data-example="playing"][data-audio-state="running"]').waitFor({state:'attached'})
   await page.getByRole('button',{name:'Stop example',exact:true}).click();await stopped();starts++
   mark(`repeat ${index+1}: released`)
  }
  mark('startup and release fault controls')
  await page.evaluate(()=>window.__delayModule=true)
  await startExample()
  await page.waitForFunction(()=>Boolean(window.__releaseModule))
  await page.getByRole('button',{name:'Stop example',exact:true}).click();await stopped()
  await page.evaluate(()=>{window.__delayModule=false;window.__releaseModule()})
  await page.waitForTimeout(150)
  await stopped()
  await startExample()
  await page.locator('.sound-lab[data-example="playing"][data-audio-state="running"]').waitFor({state:'attached'})
  await page.evaluate(()=>window.__failClose=true)
  const blockedRoute=page.url()
  await taskLink('Settings').click()
  await page.locator('.sound-lab[data-audio-state="error"]').waitFor({state:'attached'})
  assert.equal(page.url(),blockedRoute,'failed close allowed navigation away')
  assert(await page.getByRole('button',{name:'Listen to example',exact:true}).isDisabled())
  await page.getByRole('button',{name:'Retry release',exact:true}).click();await stopped()
  await startExample()
  await page.locator('.sound-lab[data-example="playing"][data-audio-state="running"]').waitFor({state:'attached'})
  await page.evaluate(()=>window.__comparisonContexts.at(-1).suspend());await stopped()
  await startExample()
  await page.locator('.sound-lab[data-example="playing"][data-audio-state="running"]').waitFor({state:'attached'})
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))})
  await stopped()
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))})
  await assertExampleMidi()
  assert.equal(await page.evaluate(()=>window.__comparisonMidiRequests),settingsMidiRequests,'preview requested MIDI outside Settings navigation')
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('biotron-audition-feedback-')).length),0,'preview inferred a listening outcome')
  // Natural end of each distinct phrase, not just an early Stop.
  for(const group of ['Timbres','Calibration sounds','Handpan','High-note treatments']){
   await selectBank(group)
   if(group==='Calibration sounds')await selection().selectOption('cue-reference')
   await startExample()
   await page.locator('.sound-lab[data-example="playing"][data-audio-state="running"]').waitFor({state:'attached'});await stopped()
  }
  await startExample()
  await page.locator('.sound-lab[data-example="playing"][data-audio-state="running"]').waitFor({state:'attached'})
  await selection().selectOption('high-soft')
  await page.locator('.sound-lab[data-example="playing"][data-sound="Gentler highs"]').waitFor({state:'attached'})
  await page.getByRole('button',{name:'Stop example',exact:true}).click();await stopped()
  await selection().selectOption('high-reference')
  assert.equal(await page.getByRole('button',{name:'Play reference',exact:true}).count(),0)
  await startExample()
  await page.locator('.sound-lab[data-example="playing"][data-audio-state="running"]').waitFor({state:'attached'})
  await goSettings()
  assert(await page.evaluate(()=>window.__comparisonContexts.every(context=>context.state==='closed')),'route leave retained audio')
  assert(await details(page,'Experiments').evaluate(element=>element.open))
  await openCompareAlias()
  }
  const actual=async(fundamental=164.81)=>page.evaluate(async fundamental=>{
   const node=window.__comparisonOutput
   if(!window.__comparisonAnalyser || window.__comparisonAnalyser.context!==node.context){
    window.__comparisonAnalyser=node.context.createAnalyser();window.__comparisonAnalyser.fftSize=8192;window.__comparisonAnalyser.smoothingTimeConstant=0;node.connect(window.__comparisonAnalyser)
    // A new analyser has an empty PCM buffer until audio has flowed through it.
    await new Promise(resolve=>setTimeout(resolve,220))
   }
   const samples=new Float32Array(window.__comparisonAnalyser.fftSize)
   window.__comparisonAnalyser.getFloatTimeDomainData(samples)
   const spectrum=new Float32Array(window.__comparisonAnalyser.frequencyBinCount)
   window.__comparisonAnalyser.getFloatFrequencyData(spectrum)
   const lowBand=Array.from(spectrum).reduce((sum,db,index)=>{
    const hz=index*node.context.sampleRate/window.__comparisonAnalyser.fftSize
    return sum+(hz>145&&hz<185 ? 10**(db/10) : 0)
   },0)
   const modes=[1,2,3].map(ratio=>Array.from(spectrum).reduce((sum,db,index)=>{
    const hz=index*node.context.sampleRate/window.__comparisonAnalyser.fftSize
    return sum+(Math.abs(hz-fundamental*ratio)<20 ? 10**(db/10) : 0)
   },0))
   return {lowBand,modes,sound:document.querySelector('.sound-lab').dataset.sound,
    count:Number(document.querySelector('.sound-lab').dataset.activeVoices),
    level:window.__biotronTrace.filter(event=>event.kind==='in'&&event.data?.level!==undefined).at(-1)?.data.level,
    rms:Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length)}
  },fundamental)
  mark('Low CPU can change safely; same-bank preview keeps the existing engine')
  const qualityMidiRequests=await page.evaluate(()=>window.__comparisonMidiRequests)
  await selectBank('Timbres')
  await startExample()
  await page.locator('.sound-lab[data-example="playing"][data-audio-state="running"]').waitFor({state:'attached'})
  const quality=page.getByLabel('Low CPU',{exact:true})
  assert(await quality.isEnabled(),'Low CPU is inaccessible while sound runs')
  const previewContexts=await page.evaluate(()=>window.__comparisonContexts.length)
  await selection().selectOption('tone-bass')
  await selectBank('Timbres')
  assert.equal(await selection().inputValue(),'tone-bass','active group reset the chosen sound')
  await page.locator('.sound-lab[data-example="playing"][data-sound="Deep bass"]').waitFor({state:'attached'})
  assert.equal(await page.evaluate(()=>window.__comparisonContexts.length),previewContexts,'preview switch created another renderer')
  await page.locator('.compare-current').filter({hasText:'Deep bass'}).waitFor()
  await page.waitForFunction(()=>Number(document.querySelector('.sound-lab').dataset.activeVoices)>0)
  assert((await actual()).rms>1e-8,'switched preview produced no PCM')
  await quality.uncheck();await stopped()
  assert.equal(await quality.isChecked(),false)
  assert.equal(await selection().inputValue(),'tone-bass')
  const chord=['KeyA','KeyS','KeyD','KeyF','KeyG','KeyH']
  for(const [safe,count] of [[false,6],[true,4]]){
   await quality.setChecked(safe)
   await page.getByRole('button',{name:'Play with keyboard',exact:true}).click()
   await page.locator('.sound-lab[data-audio-state="running"][data-keyboard="on"]').waitFor({state:'attached'})
   for(const code of chord)await page.dispatchEvent('body','keydown',{code,key:'a'})
   await page.locator(`.sound-lab[data-quality="${safe?'safe':'standard'}"][data-active-voices="${count}"]`).waitFor({state:'attached'})
   assert.equal(await page.evaluate(()=>window.__comparisonContexts.filter(context=>context.state!=='closed').length),1)
   if(!safe){await quality.check();await stopped()}
  }
  await page.evaluate(()=>window.__failClose=true)
  await quality.click()
  await page.locator('.sound-lab[data-audio-state="error"]').waitFor({state:'attached'})
  assert(await quality.isChecked(),'failed close changed quality before releasing the old engine')
  assert(await quality.isDisabled(),'failed close permits a second engine')
  await page.getByRole('button',{name:'Retry release',exact:true}).click();await stopped()
  await quality.uncheck();assert.equal(await quality.isChecked(),false)
  await quality.check();assert.equal(await quality.isChecked(),true)
  assert.equal(await page.evaluate(()=>window.__comparisonMidiRequests),qualityMidiRequests,'quality change requested MIDI')
  mark('changing the calibration option updates subsequent real cue velocities')
  await selectBank('Calibration sounds')
  await selection().selectOption('cue-current')
  await page.evaluate(()=>window.__comparisonValues=[])
  await startExample()
  const cueLevel=level=>page.waitForFunction(level=>window.__comparisonValues.some(id=>Math.abs(window.__comparisonProperties.get(id)-24/127*level)<1e-9),level)
  await cueLevel(.14)
  await page.evaluate(()=>window.__comparisonValues=[])
  await selection().selectOption('cue-present')
  await cueLevel(.22)
  assert.equal(await page.locator('.sound-lab').getAttribute('data-example'),'playing')
  await page.getByRole('button',{name:'Stop example',exact:true}).click();await stopped()
  mark('computer keyboard: all 36 variants without MIDI permission')
  const {AUDITION_BANKS}=await import('../src/audio/auditionBanks.mjs')
  const keyboardObservations=[]
  const down=async extra=>{await page.evaluate(()=>window.__comparisonValues=[]);await page.dispatchEvent('body','keydown',{code:'KeyA',key:'ф',...extra})}
  const up=extra=>page.dispatchEvent('body','keyup',{code:'KeyA',key:'a',...extra})
  const keyboardVoice=()=>page.evaluate(()=>{const changes=window.__comparisonValues;const gate=changes.findLast(id=>window.__comparisonProperties.get(id)===1);if(changes.length>=3)window.__keyboardRefsByGate.set(gate,changes.slice(-3));window.__keyboardRefIds=window.__keyboardRefsByGate.get(gate);const values=window.__keyboardRefIds.map(id=>window.__comparisonProperties.get(id));return {frequency:values[0],velocity:values[1],gate:values[2]}})
  const voices=count=>page.locator(`.sound-lab[data-active-voices="${count}"]`).waitFor({state:'attached'})
  await down();await voices(0)
  await goPlay()
  const keyboardMidiRequests=await page.evaluate(()=>window.__comparisonMidiRequests)
  const keyboardSettingsRequests=settingsMidiRequests
  await page.getByRole('button',{name:'Play with keyboard',exact:true}).click()
  await page.locator('.sound-lab[data-audio-state="running"][data-keyboard="on"]').waitFor({state:'attached'})
  await page.waitForFunction(()=>window.__comparisonContexts.at(-1).currentTime>.25,null,{timeout:5000})
  const keyboardContexts=await page.evaluate(()=>window.__comparisonContexts.length)
  for(const bank of AUDITION_BANKS){
   if(bank.id==='calibration'){await goPlay();await page.getByLabel('Keyboard octave',{exact:true}).selectOption('4')}
   await selectBank(bank.label)
   if(bank.id!=='calibration')await page.getByLabel('Keyboard octave',{exact:true}).selectOption(bank.id==='high-notes'?'7':'4')
   const bankMidiRequests=await page.evaluate(()=>window.__comparisonMidiRequests)
   for(const option of bank.variants){
    await selection().selectOption(option.id)
    await page.locator(`.sound-lab[data-sound="${option.preset.name}"]`).waitFor({state:'attached'})
    await down();await voices(1);await page.waitForTimeout(160)
    const observation=await actual(bank.id==='high-notes'?2093:261.63)
    assert(observation.rms>1e-8,`keyboard ${option.id} produced no PCM`)
    const voice=await keyboardVoice()
    assert.equal(voice.gate,1,'keyboard gate was not sent to the actual worklet')
    assert(Math.abs(voice.frequency-(bank.id==='high-notes'?2093.004522404789:261.6255653005986))<.001,'keyboard octave did not reach DSP')
    assert(Math.abs(voice.velocity-(bank.id==='calibration'?24/127*option.level:104/127))<1e-9,'keyboard cue velocity/level changed')
    keyboardObservations.push({id:option.id,octave:bank.id==='high-notes'?7:4,...observation,...voice})
    fs.writeFileSync(path.join(artifacts,'keyboard-observations.json'),JSON.stringify(keyboardObservations,null,2))
    await up({ctrlKey:true});await voices(0)
    assert.equal(await page.evaluate(()=>window.__comparisonMidiRequests),bankMidiRequests,'keyboard option requested MIDI')
   }
  }
  assert.equal(await page.evaluate(()=>window.__comparisonContexts.length),keyboardContexts,'keyboard selection made another renderer')
  assert.equal(await page.evaluate(()=>window.__comparisonMidiRequests),keyboardMidiRequests+settingsMidiRequests-keyboardSettingsRequests,'keyboard requested MIDI outside Settings navigation')
  await selectBank('Timbres')
  await page.getByLabel('Keyboard octave',{exact:true}).selectOption('4')
  for(const key of ['a','ф','q','ש']){await down({key});await voices(1);await up();await voices(0)}
  for(const octave of ['2','3','4','5','6','7']){
   await page.getByLabel('Keyboard octave',{exact:true}).selectOption(octave)
   await down();await voices(1)
   const frequency=(await keyboardVoice()).frequency
   assert(Math.abs(frequency-440*2**((60+12*(Number(octave)-4)-69)/12))<.001)
   await up();await voices(0)
  }
  for(const flag of ['ctrlKey','metaKey','altKey','shiftKey','isComposing','repeat']){await down({[flag]:true});await voices(0)}
  await page.evaluate(()=>{const event=new KeyboardEvent('keydown',{code:'KeyA',bubbles:true,cancelable:true});event.preventDefault();document.body.dispatchEvent(event)})
  await voices(0)
  await selection().dispatchEvent('keydown',{code:'KeyA',key:'a'});await voices(0)
  for(const tag of ['input','textarea','div']){
   await page.evaluate(tag=>{const element=document.createElement(tag);element.id='typing-probe';if(tag==='div')element.contentEditable='true';document.body.append(element)},tag)
   await page.locator('#typing-probe').dispatchEvent('keydown',{code:'KeyA',key:'a'});await voices(0)
   await down();await voices(1);await page.locator('#typing-probe').focus();await voices(0)
   await page.locator('#typing-probe').evaluate(element=>element.remove())
  }
  await page.evaluate(()=>{const host=document.createElement('div');host.id='shadow-probe';const input=document.createElement('input');host.attachShadow({mode:'open'}).append(input);document.body.append(host);input.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyA',bubbles:true,composed:true}))});await voices(0)
  await page.locator('#shadow-probe').evaluate(element=>element.remove())
  for(const attribute of ['role=dialog','role=textbox','inert']){
   await page.evaluate(attribute=>{const parent=document.createElement('div');parent.id='blocked-probe';const [key,value]=attribute.split('=');parent.setAttribute(key,value||'');const child=document.createElement('button');child.textContent='probe';parent.append(child);document.body.append(parent);child.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyA',bubbles:true}))},attribute);await voices(0)
   await page.locator('#blocked-probe').evaluate(element=>element.remove())
  }
  await down();await down();await down({repeat:true});await voices(1)
  await page.getByLabel('Keyboard octave',{exact:true}).selectOption('4');await voices(0);await up();await voices(0)
  await down();await voices(1)
  await page.evaluate(()=>document.dispatchEvent(new CompositionEvent('compositionstart')));await voices(0)
  for(const event of ['blur','pagehide']){await down();await voices(1);await page.evaluate(event=>window.dispatchEvent(new Event(event)),event);await voices(0)}
  await down();await voices(1)
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});await voices(0)
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))})
  assert.equal(await page.getByRole('region',{name:'One octave keyboard',exact:true}).count(),0,'Screen keyboard must stay hidden')
  assert.equal(await page.locator('.keys-notes').count(),0)
  await down();await voices(1)
  await goSettings();await voices(0)
  assert.equal(await page.evaluate(()=>window.__comparisonContexts.length),keyboardContexts,'Settings lost keyboard renderer ownership')
  await goPlay()
  await page.getByRole('button',{name:'Stop keyboard',exact:true}).click();await stopped()
  await down();await voices(0)
  await goSettings()
  await openCompareAlias()
  fs.writeFileSync(path.join(artifacts,'keyboard-observations.json'),JSON.stringify(keyboardObservations,null,2))
  mark('live Biotron choices through the existing SoundLab session')
  await selectBank('Timbres')
  await page.evaluate(()=>window.__enableComparisonMidi=true)
  await page.evaluate(()=>window.__delayModule=true)
  await page.getByRole('button',{name:'Start listening',exact:true}).click()
  await page.waitForFunction(()=>Boolean(window.__releaseModule))
  await selection().selectOption('tone-soft')
  await page.evaluate(()=>{window.__delayModule=false;window.__releaseModule()})
  await page.getByRole('button',{name:'Stop & release',exact:true}).waitFor()
  await page.locator('.sound-lab[data-sound="Soft round"]').waitFor({state:'attached'})
  const nonce=await page.evaluate(()=>window.__comparisonSent.at(-1)[4])
  await page.evaluate(nonce=>window.__emitComparisonMidi([0xf0,0x0b,125,nonce,3,0xf7]),nonce)
  await page.locator('.sound-lab[data-reveal-stage="ready"]').waitFor({state:'attached'})
  const liveContexts=await page.evaluate(()=>window.__comparisonContexts.length)
  await page.getByRole('button',{name:'Play with keyboard',exact:true}).click()
  await page.evaluate(()=>{window.__emitComparisonMidi([0x90,64,100]);document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',key:'в',bubbles:true,cancelable:true}))})
  await voices(2);await page.waitForTimeout(50);await voices(2)
  await page.dispatchEvent('body','keyup',{code:'KeyD',key:'d'});await voices(1)
  await page.evaluate(()=>window.__emitComparisonMidi([0x80,64,0]));await voices(0)
  await page.evaluate(()=>window.__emitComparisonMidi([0x90,64,100]));await voices(1)
  await page.dispatchEvent('body','keydown',{code:'KeyD',key:'в'});await voices(2)
  await page.dispatchEvent('body','keyup',{code:'KeyD',key:'d'});await voices(1)
  await page.getByRole('button',{name:'Stop keyboard',exact:true}).click();await voices(1)
  assert(await page.evaluate(()=>window.__comparisonPorts[0].connection==='open'),'keyboard Stop released unrelated MIDI')
  await page.evaluate(()=>window.__emitComparisonMidi([0x80,64,0]));await voices(0)
  const liveObservations=[]
  for(const bank of AUDITION_BANKS.filter(bank=>bank.id!=='calibration')){
   await selectBank(bank.label)
   await page.evaluate(()=>window.__emitComparisonMidi([0x90,96,100]))
   await page.waitForFunction(()=>Number(document.querySelector('.sound-lab').dataset.activeVoices)===1)
   for(const option of bank.variants){
    await selection().selectOption(option.id)
    await page.locator(`.sound-lab[data-sound="${option.preset.name}"]`).waitFor({state:'attached'})
    const state=await actual()
    assert.equal(state.sound,option.preset.name,`live option ${option.id} never reached the renderer`)
    liveObservations.push({id:option.id,...state})
    assert.equal(state.count,1,'changing a sound lost the held input note')
   }
   await page.evaluate(()=>window.__emitComparisonMidi([0x80,96,0]))
   await page.waitForFunction(()=>Number(document.querySelector('.sound-lab').dataset.activeVoices)===0)
  }
  // Hearable renderer output after a real 27ms MIDI gate, not only a new label
  // or a held voice. All three handpan modes must survive the Note Off.
  await selectBank('Handpan')
  const handpan=[]
  for(const option of AUDITION_BANKS.find(bank=>bank.id==='handpan').variants){
   await selection().selectOption(option.id)
   await page.locator(`.sound-lab[data-sound="${option.preset.name}"]`).waitFor({state:'attached'})
   await page.waitForTimeout(3100) // Previous modal release must not certify the next sound's spectrum.
   await page.evaluate(async()=>{window.__emitComparisonMidi([0x90,62,98]);await new Promise(resolve=>setTimeout(resolve,27));window.__emitComparisonMidi([0x80,62,0])})
   await page.waitForTimeout(80)
   const state=await actual(440*2**((62-69)/12+option.preset.cv.octave))
   handpan.push({id:option.id,...state})
   assert.equal(state.count,0,option.id+': short MIDI note remained held')
   assert(state.rms>.001&&state.modes.every(energy=>energy>1e-7),option.id+': short note did not leave three audible rings')
  }
  fs.writeFileSync(path.join(artifacts,'handpan-midi.json'),JSON.stringify(handpan,null,2))
  mark('chosen handpan survives Settings/Play and independent experiment disclosure')
  await selection().selectOption('pan-bold')
  await page.evaluate(()=>window.__emitComparisonMidi([0x90,62,98]))
  await page.waitForTimeout(80)
  const beforeRoute={contexts:await page.evaluate(()=>window.__comparisonContexts.length),...await actual()}
  const retainedPaletteSelect=await selection().elementHandle()
  await palette(page).locator('summary').click()
  assert.equal(await palette(page).evaluate(element=>element.open),false)
  assert(await retainedPaletteSelect.evaluate(element=>element.isConnected),'closing Sound unmounted its controls')
  assert.equal(await page.locator('.sound-lab').getAttribute('data-audio-state'),'running','Closing Sound stopped live sound')
  await openDetails(page,'Sound');assert.equal(await selection().inputValue(),'pan-bold')
  const beforeCalibrationOpen=await page.evaluate(()=>localStorage.getItem('biotron-sound-experiment-v1'))
  await goSettings()
  await page.getByRole('button',{name:'Stop & release',exact:true}).waitFor()
  assert.equal(await panel().getByRole('button',{name:'Handpan',exact:true}).count(),0,'musical banks remained in Settings')
  assert.equal(await selection().inputValue(),'','opening calibration implicitly chose a cue')
  assert.equal(await enabledOptions().count(),10)
  assert(await panel().getByRole('button',{name:'Listen to example',exact:true}).isDisabled(),'unselected calibration permits replacing the current sound')
  await panel().getByText('No experimental cue selected.',{exact:false}).waitFor()
  assert.equal(await page.evaluate(()=>localStorage.getItem('biotron-sound-experiment-v1')),beforeCalibrationOpen,'opening calibration changed the persisted Handpan')
  assert.equal(await page.evaluate(()=>window.__comparisonContexts.length),beforeRoute.contexts,'opening calibration replaced the existing renderer')
  assert.equal(await page.getByLabel('Low CPU',{exact:true}).count(),0,'Settings duplicated Play quality controls')
  assert.equal(await page.getByLabel('Keyboard octave',{exact:true}).count(),0,'Settings duplicated Play keyboard controls')
  await page.locator('.sound-lab[data-sound="Deep ding"][data-active-voices="1"][data-audio-state="running"]').waitFor({state:'attached'})
  const disclosure=details(page,'Experiments'),retainedCueSelect=await selection().elementHandle()
  await disclosure.locator('summary').click()
  assert.equal(await disclosure.evaluate(element=>element.open),false)
  assert(await retainedCueSelect.evaluate(element=>element.isConnected),'closing Experiments unmounted its controls')
  assert.equal(await page.locator('.sound-lab').getAttribute('data-audio-state'),'running','Closing Experiments stopped live sound')
  await goPlay()
  await page.locator('.sound-lab[data-sound="Deep ding"][data-active-voices="1"][data-audio-state="running"]').waitFor()
  assert.equal(await selection().inputValue(),'pan-bold')
  await goSettings()
  const afterRoute={contexts:await page.evaluate(()=>window.__comparisonContexts.length),...await actual()}
  assert.equal(afterRoute.contexts,beforeRoute.contexts,'Settings/Play created another AudioContext')
  assert.equal(afterRoute.count,1);assert(afterRoute.rms>.00001,'Settings/Play lost actual MIDI audio')
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('biotron-sound-experiment-v1')).variantId),'pan-bold')
  assert.equal(await page.locator('.compare-feedback').count(),0)
  assert.equal(await page.getByRole('button',{name:'Prefer this option',exact:true}).count(),0)
  fs.writeFileSync(path.join(artifacts,'route-persistence.json'),JSON.stringify({beforeRoute,afterRoute},null,2))
  await page.evaluate(()=>window.__emitComparisonMidi([0x80,62,0]))
  await openCompareAlias()
  // Same real MIDI E4 through one existing context: the octave-down option
  // must generate E3 energy (145–185Hz). A label-only switch fails this oracle.
  await selectBank('Timbres')
  await page.waitForTimeout(3100) // Settle the deliberate Deep ding ring before the octave-down control.
  const audible=[]
  for(const id of ['tone-reference','tone-bass']){
   await selection().selectOption(id)
   await page.locator(`.sound-lab[data-sound="${AUDITION_BANKS[0].variants.find(option=>option.id===id).preset.name}"]`).waitFor({state:'attached'})
   await page.evaluate(()=>{window.__emitComparisonMidi([0xb0,123,0]);window.__emitComparisonMidi([0x90,64,100])})
   await page.waitForTimeout(500)
   audible.push({id,...await actual()})
  }
  fs.writeFileSync(path.join(artifacts,'live-audible-switch.json'),JSON.stringify(audible,null,2))
  assert(audible.every(result=>result.rms>0.00001&&Number.isFinite(result.rms)))
  assert(audible[1].lowBand>audible[0].lowBand*3+0.000001,'preset labels changed but the live octave-down DSP did not')
  await page.evaluate(()=>window.__emitComparisonMidi([0xb0,123,0]))
  const calibration=AUDITION_BANKS.find(bank=>bank.id==='calibration')
  await selectBank(calibration.label)
  await selection().selectOption(calibration.variants[0].id)
  await page.getByRole('button',{name:'Stop & release',exact:true}).click();await stopped()
  await goPlay()
  await page.getByRole('button',{name:'Start listening',exact:true}).click()
  await page.getByRole('button',{name:'Stop & release',exact:true}).waitFor()
  const cueNonce=await page.evaluate(()=>window.__comparisonSent.filter(message=>message[3]===125).at(-1)[4])
  // A wrong nonce cannot turn an ordinary plant note into the quiet cue.
  await page.evaluate(n=>window.__emitComparisonMidi([0xf0,0x0b,125,n%127+1,2,0xf7]),cueNonce)
  await page.evaluate(()=>window.__emitComparisonMidi([0x90,64,100]))
  assert.equal((await actual()).level,1)
  await page.evaluate(()=>window.__emitComparisonMidi([0xb0,123,0]))
  await page.evaluate(n=>window.__emitComparisonMidi([0xf0,0x0b,125,n,2,0xf7]),cueNonce)
  await page.locator('.sound-lab[data-reveal-stage="calibrating"]').waitFor({state:'attached'})
  await goSettings()
  for(const option of calibration.variants){
   await selection().selectOption(option.id)
   await page.locator(`.sound-lab[data-sound="${option.preset.name}"]`).waitFor({state:'attached'})
   await page.evaluate(()=>window.__emitComparisonMidi([0x90,64,24]))
   assert.equal((await actual()).level,option.level,`cue level ${option.id} did not apply`)
   liveObservations.push({id:option.id,...await actual()})
   await page.evaluate(()=>window.__emitComparisonMidi([0xb0,123,0]))
  }
  await goSettings()
  await goPlay()
  await page.locator('.sound-lab[data-reveal-stage="calibrating"][data-sound="Dry short"]').waitFor()
  await goSettings()
  await openCompareAlias()
  await page.evaluate(n=>window.__emitComparisonMidi([0xf0,0x0b,125,n,3,0xf7]),cueNonce)
  await page.locator('.sound-lab[data-reveal-stage="ready"][data-sound="Round"]').waitFor({state:'attached'})
  await page.evaluate(()=>window.__emitComparisonMidi([0x90,64,100]))
  assert.equal((await actual()).level,1,'cue choice altered later plant velocity')
  assert.equal((await actual()).sound,'Round')
  await page.waitForTimeout(120)
  const plant=await actual()
  assert(plant.rms>0.00001&&Number.isFinite(plant.rms),'real live-MIDI PCM is absent')
  liveObservations.push({id:'plant-after-cue',...plant})
  fs.writeFileSync(path.join(artifacts,'live-observations.json'),JSON.stringify(liveObservations,null,2))
  const requests=await page.evaluate(()=>window.__comparisonSent)
  fs.writeFileSync(path.join(artifacts,'midi-requests.json'),JSON.stringify(requests,null,2))
  assert(requests.every(message=>message[0]===0xf0&&message[1]===20&&message[2]===13&&message.at(-1)===0xf7&&
   ((message.length===6&&[125,126].includes(message[3]))||(message.length===7&&message[3]===123&&message[4]===1))),
   'Sound selection wrote settings or firmware; only calibration and Settings read-only queries are allowed')
  assert.equal(await page.evaluate(()=>window.__comparisonContexts.length),liveContexts+1,'live option switching created a new audio context')
  // Stop disconnects the listener; another incoming note cannot restart sound.
  await page.getByRole('button',{name:'Stop & release',exact:true}).click();await stopped()
  await page.evaluate(()=>window.__emitComparisonMidi([0x90,96,127]));await stopped()
  assert(await page.evaluate(()=>window.__comparisonPorts.every(port=>port.connection==='closed')))
  await selectBank('Timbres')
  await selectBank('Handpan')
  await selection().selectOption('pan-bold')
  await page.reload();await waitPlay()
  assert.equal(await selection().inputValue(),'pan-bold','Reload discarded the chosen experiment')
  assert.equal(await page.evaluate(()=>window.__comparisonContexts.length),0,'Reload must not start sound without a gesture')
  await goPlay()
  await page.evaluate(()=>window.__enableComparisonMidi=true)
  await page.getByRole('button',{name:'Start listening',exact:true}).click()
  await page.locator('.sound-lab[data-reveal-stage="settling"]').waitFor()
  const restoreNonce=await page.evaluate(()=>window.__comparisonSent.filter(message=>message[3]===125).at(-1)[4])
  await page.evaluate(n=>{window.__emitComparisonMidi([0xf0,0x0b,125,n,3,0xf7]);window.__emitComparisonMidi([0x90,62,98])},restoreNonce)
  await page.locator('.sound-lab[data-reveal-stage="revealed"][data-sound="Deep ding"]').waitFor()
  await openDetails(page,'Sound')
  const classic=panel().getByRole('button',{name:'Classic',exact:true})
  assert.equal(await classic.getAttribute('aria-pressed'),'false','Classic appeared selected during an experiment')
  await classic.click();assert.equal(await selection().locator('option').count(),7)
  await selection().selectOption('0')
  assert.equal(await classic.getAttribute('aria-pressed'),'true')
  assert.equal(await page.evaluate(()=>localStorage.getItem('biotron-sound-experiment-v1')),null,'Stock selection did not clear the experiment')
  await page.getByRole('button',{name:'Stop & release',exact:true}).click()
  await goSettings();await goPlay()
  assert.equal(await selection().inputValue(),'0')
  assert.equal(await panel().getByRole('button',{name:'Classic',exact:true}).getAttribute('aria-pressed'),'true')
  // No device: all ordinary local-settings sections remain alongside Experiments.
  const offline=await browser.newContext()
  await offline.addInitScript(()=>Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async()=>({inputs:new Map(),outputs:new Map(),addEventListener(){},removeEventListener(){}})}))
  const settings=await offline.newPage()
  await settings.goto(`http://127.0.0.1:${server.address().port}/#/biotron?experiments=1`)
  await settings.getByText(/Local preset — changes stay/).waitFor()
  assert(await details(settings,'Experiments').evaluate(element=>element.open),'experiments query did not open its native section')
  await settings.getByRole('heading',{name:'Calibration cues',exact:true}).waitFor()
  assert.equal(await enabledOptions(settings).count(),10)
  assert(await panel(settings).getByRole('button',{name:'Listen to example',exact:true}).isDisabled())
  const plantToggle=details(settings,'Plant sensor'),funToggle=details(settings,'More fun'),experimentToggle=details(settings,'Experiments')
  await openDetails(settings,'More fun');await openDetails(settings,'Experiments');await selection(settings).waitFor()
  assert(await plantToggle.evaluate(element=>element.open))
  assert(await funToggle.evaluate(element=>element.open))
  await selection(settings).selectOption('cue-present')
  const retainedSelection=await selection(settings).elementHandle()
  await experimentToggle.locator('summary').click()
  assert(await plantToggle.evaluate(element=>element.open),'Experiments hid Plant sensor')
  assert(await funToggle.evaluate(element=>element.open),'Experiments hid More fun')
  assert(await retainedSelection.evaluate(element=>element.isConnected),'Closing the panel removed its selected cue')
  await openDetails(settings,'Experiments')
  assert.equal(await selection(settings).inputValue(),'cue-present','Closing the panel lost the selected cue')
  await offline.close()
  const cold=await browser.newContext()
  await cold.addInitScript(()=>{window.__keyboardMidi=0;Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async()=>{window.__keyboardMidi++;throw new Error('No device for keyboard test')}})})
  const keyboardPlay=await cold.newPage();await keyboardPlay.goto(`http://127.0.0.1:${server.address().port}/#/biotron/play`)
  await keyboardPlay.getByRole('heading',{name:'Plant music',exact:true}).waitFor()
  assert.equal(await palette(keyboardPlay).evaluate(element=>element.open),false,'cold Play opened Sound without a query')
  assert.equal(await keyboardPlay.locator('.audio-compare').count(),0,'cold Play mounted the unopened palette')
  await openDetails(keyboardPlay,'Sound');await selection(keyboardPlay).waitFor()
  assert.equal(await enabledOptions(keyboardPlay).count(),7,'Classic lost a shipping sound')
  const coldSelect=await selection(keyboardPlay).elementHandle()
  await palette(keyboardPlay).locator('summary').click()
  assert.equal(await palette(keyboardPlay).evaluate(element=>element.open),false)
  assert(await coldSelect.evaluate(element=>element.isConnected),'closing cold Sound discarded its mounted controls')
  await keyboardPlay.getByRole('button',{name:'Play with keyboard',exact:true}).click()
  await keyboardPlay.locator('.sound-lab[data-audio-state=running]').waitFor()
  await keyboardPlay.dispatchEvent('body','keydown',{code:'KeyA',key:'ф'})
  await keyboardPlay.locator('.sound-lab[data-active-voices="1"]').waitFor()
  assert.equal(await keyboardPlay.evaluate(()=>window.__keyboardMidi),0,'cold Play keyboard asked for a device')
  await keyboardPlay.getByRole('button',{name:'Stop keyboard',exact:true}).click();await cold.close()
  for(const profile of [{viewport:{width:320,height:700}},{...devices['iPhone 15'],isMobile:false}]){
   const mobile=await browser.newContext(profile);await mobile.addInitScript(()=>Object.defineProperty(navigator,'requestMIDIAccess',{value:undefined,configurable:true}))
   const tab=await mobile.newPage();await tab.goto(`http://127.0.0.1:${server.address().port}/#/biotron/compare`)
   await waitCompareAlias(tab)
   assert(await tab.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'comparison overflows mobile')
   await tab.getByRole('button',{name:'High-note treatments',exact:true}).click();assert.equal(await selection(tab).locator('option').count(),10)
   await tab.getByRole('button',{name:'Handpan',exact:true}).click();assert.equal(await selection(tab).locator('option').count(),6)
   await tab.getByRole('button',{name:'Play with keyboard',exact:true}).click()
   await tab.locator('.sound-lab[data-audio-state=running][data-keyboard=on]').waitFor({state:'attached'})
   await tab.dispatchEvent('body','keydown',{code:'KeyA',key:'ф'})
   await tab.locator('.sound-lab[data-active-voices="1"]').waitFor({state:'attached'})
   await tab.getByRole('button',{name:'Stop keyboard',exact:true}).click()
   await mobile.close()
  }
  assert.deepEqual(errors,[])
  mark(keyboardOnly?'PASS keyboard development subset':'PASS')
  await context.tracing.stop({path:path.join(artifacts,'trace.zip')})
  console.log(keyboardOnly ? 'Keyboard development subset:36 PCM/DSP choices, C2–C7, layout/edit/IME/release guards, live MIDI and cold device-free Play; full preview/startup gate not rerun.' : `Comparison browser: ${cases}/36 real-engine option Play/Stop, 100 repeated starts/closes without timers/Blobs, cancelled module load, failed-close route protection/retry, suspend/background release, four natural completions, switch/route release, reference, no preview MIDI or inferred outcome;36 live MIDI selections, six short-gate handpan modal rings and cue-only calibration changes, persistent selection through Settings/Play/reload, independent inline sections without voting, stock reset and 320/iPhone layout passed; 36 keyboard PCM/DSP choices, C2–C7, four key layouts, typing/shadow/IME/modifier guards, repeat/focus/blur/background/route/Stop, keyboard/MIDI identity isolation and no screen keys, cold audio-only Play without a MIDI request.`)
 }catch(error){
  const state=await boundedCapture(page?.evaluate(()=>({url:location.href,phase:document.querySelector('.audio-compare')?.dataset,player:document.querySelector('.sound-lab')?.dataset,contexts:window.__comparisonContexts.map(context=>({state:context.state,time:context.currentTime})),intervals:window.__comparisonIntervals.size,blobs:window.__comparisonBlobs.size,heap:performance.memory?.usedJSHeapSize})).catch(cause=>({unavailable:cause.message})))
  fs.writeFileSync(path.join(artifacts,'failure.json'),JSON.stringify({stage,starts,error:error.message,state},null,2))
  await boundedCapture(page?.screenshot({path:path.join(artifacts,'failure.png'),timeout:1000}).catch(()=>{}))
  await boundedCapture(page?.context().tracing.stop({path:path.join(artifacts,'trace.zip')}).catch(()=>{}))
  throw error
 }finally{console.log(`Browser evidence: ${artifacts}`);await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1})
