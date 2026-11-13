import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, stat, mkdir, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {testSoundPCM} from '../tests/sound-browser.mjs';
const root = fileURLToPath(new URL('../dist/',import.meta.url));
const artifacts = fileURLToPath(new URL('../.artifacts/browser/',import.meta.url));
const mime = {'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.txt':'text/plain'};
const server = createServer(async (req,res) => {
  try {
    const path = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + (root.endsWith(sep)?'':sep)) || !(await stat(file)).isFile()) throw Error('not found');
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}); res.end(await readFile(file));
  } catch {res.writeHead(404);res.end('Not found');}
});
function fakeMidi() {
  class Port extends EventTarget {
    constructor(id,name,type='input') {super();Object.assign(this,{id,name,type,manufacturer:'Playtronica',state:'connected',connection:'closed',opens:0,closes:0});}
    async open() {this.opens++;this.connection='open';return this;}
    async close() {this.closes++;this.connection='closed';return this;}
    send(data) {
      const bytes=Array.from(data); window.__midi.sent.push({id:this.id,bytes});
      if (!window.__midi.reply) return;
      if (bytes[3]===123) queueMicrotask(()=>input.receive([240,20,13,123,1,1,1,bytes[5],1,7,0,0,0,0,7,0,0,0,0,...window.__midi.values,247]));
      if (bytes[3]===126) queueMicrotask(()=>input.receive([240,11,126,bytes[4],...window.__midi.version,247]));
    }
    receive(data) {const e=new Event('midimessage');e.data=new Uint8Array(data);this.dispatchEvent(e);}
  }
  const input=new Port('input','Biotron'), second=new Port('input2','MIDIIN2 (Biotron)'), other=new Port('other','Keyboard');
  const output=new Port('output','Biotron','output'), secondaryOutput=new Port('output2','MIDIOUT2 (Biotron)','output'), foreignOutput=new Port('foreign-output','Keyboard','output');
  const access=new EventTarget(); access.inputs=new Map([input,second,other].map(p=>[p.id,p]));access.outputs=new Map([output,secondaryOutput,foreignOutput].map(p=>[p.id,p]));
  window.__midi={access,input,second,other,output,secondaryOutput,foreignOutput,sent:[],requests:[],reply:true,version:[1,8,2],values:[78,3,4,4,50,10,0,4,8,98,74,75,0,1,0,12,0,0,1,1,0,1,60,2,3,100,0],change(port){const e=new Event('statechange');e.port=port;access.dispatchEvent(e);}};
  Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async options=>{window.__midi.requests.push({options,active:navigator.userActivation.isActive});return access;}});
  const NativeAudioContext=window.AudioContext;
  window.__audioContexts=[];
  window.AudioContext=class extends NativeAudioContext {constructor(...args){super(...args);window.__audioContexts.push({context:this,active:navigator.userActivation.isActive});}};
}
// DOM fault controls run the same assertion against an intentionally damaged page, then restore it.
async function faultControl(assertion, damage, restore) {
  await assertion(); await damage();
  try {await assert.rejects(assertion, {name:'AssertionError'});}
  finally {await restore();}
}
async function runUI(browser, origin, viewport) {
  const context=await browser.newContext({viewport});
  await context.addInitScript(fakeMidi);
  const page=await context.newPage(), errors=[], network=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await context.route('https://**/*',route=>{network.push(route.request().url());return route.abort();});
  try {
    await page.goto(origin);await page.locator('#keyboard').waitFor();
    await page.waitForFunction(()=>document.querySelector('#sound').options.length>1);
    assert.equal(await page.evaluate(()=>__midi.requests.length),0,'load requested MIDI');
    assert.equal(await page.evaluate(()=>__midi.sent.length),0,'load sent MIDI');
    assert.equal(await page.evaluate(()=>__audioContexts.length),0,'load created audio');
    await faultControl(async()=>assert.deepEqual(await page.locator('.play-brand').evaluate(a=>[a.href,a.target,a.rel]),['https://shop.playtronica.com/','_blank','noopener']),
      ()=>page.locator('.play-brand').evaluate(a=>a.target='_self'),()=>page.locator('.play-brand').evaluate(a=>a.target='_blank'));
    assert.equal(await page.locator('#help').isVisible(),false);
    await page.locator('#help-open').click();
    await faultControl(async()=>assert.equal(await page.locator('#help').isVisible(),true),()=>page.locator('#help').evaluate(d=>d.close()),()=>page.locator('#help-open').click());
    assert.equal(await page.locator('#how-tab').textContent(),'How to play');assert.equal(await page.locator('#midi-tab').textContent(),'MIDI');
    assert.equal(await page.locator('#midi-panel').isVisible(),false);await page.locator('#midi-tab').click();assert.equal(await page.locator('#midi-panel').isVisible(),true);assert.equal(await page.locator('#how-panel').isVisible(),false);
    await page.locator('#help [data-close]').click();
    assert.equal(await page.locator('#feedback-card').isVisible(),false);await page.locator('#feedback-open').click();
    await faultControl(async()=>assert.equal(await page.locator('#feedback-card').isVisible(),true),()=>page.locator('#feedback-card').evaluate(d=>d.hidden=true),()=>page.locator('#feedback-card').evaluate(d=>d.hidden=false));
    assert.equal(await page.locator('#feedback-submit').isDisabled(),true);
    await page.locator('#feedback-comment').fill('Controlled browser test');await page.locator('#feedback-details').check();
    assert.equal(await page.locator('#feedback-submit').isEnabled(),true);
    await page.locator('#feedback-see').click();
    const payload=JSON.parse(await page.locator('#feedback-preview').inputValue());assert.equal(payload.product,'biotron');assert.equal(payload.technical.env.product,'biotron');
    await page.locator('#feedback-details').uncheck();assert.equal(await page.locator('#feedback-submit').isDisabled(),true);
    assert.deepEqual(network,[],'feedback opening/preview sent a network request');
    await page.locator('#feedback-card .play-card-close').click();
    assert.equal(await page.locator('#settings').isVisible(),false);await page.locator('#settings-open').click();
    await page.waitForFunction(()=>__midi.input.connection==='open'&&__midi.output.connection==='open');
    await faultControl(async()=>assert.equal(await page.locator('#settings').isVisible(),true),()=>page.locator('#settings').evaluate(d=>d.close()),()=>page.locator('#settings-open').click());
    assert.equal(await page.locator('[data-setting]').count(),26);
    assert.equal(await page.evaluate(()=>__midi.sent.length),0,'connect wrote bytes');
    assert.equal(await page.evaluate(()=>__midi.requests.every(r=>r.options.sysex===true&&r.active)),true,'permission was outside a gesture');
    assert.equal(await page.evaluate(()=>__midi.second.opens+__midi.secondaryOutput.opens+__midi.other.opens+__midi.foreignOutput.opens),0);
    assert.equal(await page.locator('#settings #sound').count(),0,'player appeared inside Settings');
    await page.locator('#preset-load').click();assert.equal(await page.evaluate(()=>__midi.sent.length),0,'preset load wrote bytes');
    // A fresh page read can replace the initial preset; a deliberate preset load stays local.
    await page.locator('#settings-check').click();await page.waitForFunction(()=>!document.querySelector('#settings-send').disabled);
    const queries=await page.evaluate(()=>__midi.sent.map(s=>s.bytes));
    assert.deepEqual(queries,[[240,20,13,123,1,1,247],[240,20,13,126,0,247]]);
    await page.evaluate(()=>{__midi.sent=[];__midi.input.receive([240,20,13,123,1,1,1,1,1,7,0,0,0,0,7,0,0,0,0,...__midi.values,247]);});
    assert.equal(await page.evaluate(()=>__midi.sent.length),0,'readback reply wrote bytes');
    assert.equal(await page.locator('#firmware-open').isVisible(),false,'1.8.2 offered Update');
    await page.locator('#setting-noteDistance').fill('51');await page.locator('#setting-noteDistance').press('Tab');
    await page.waitForFunction(()=>__midi.sent.length===1);
    assert.deepEqual(await page.evaluate(()=>__midi.sent.map(s=>s.bytes)),[[240,20,13,1,51,247]]);
    await page.locator('#setting-noteDistance').fill('');await page.locator('#setting-noteDistance').press('Tab');assert.equal(await page.evaluate(()=>__midi.sent.length),1,'blank input wrote zero');
    await page.locator('#preset-name').fill('Browser fixture');await page.locator('#preset-save').click();
    await page.locator('#preset-load').click();assert.equal(await page.evaluate(()=>__midi.sent.length),1,'save/load wrote MIDI');
    await page.evaluate(()=>{__midi.sent=[];__midi.version=[1,8,1];});
    await page.locator('#settings-check').click();await page.waitForFunction(()=>!document.querySelector('#firmware-open').hidden);
    await page.locator('#settings [data-close]').click();
    await faultControl(async()=>assert.deepEqual(await page.locator('#firmware-open').evaluate(a=>[!a.hidden,a.href,a.target]),[true,'https://settings.playtronica.com/#/biotron','_blank']),
      ()=>page.locator('#firmware-open').evaluate(a=>a.href='https://example.invalid'),()=>page.locator('#firmware-open').evaluate(a=>a.href='https://settings.playtronica.com/#/biotron'));
    await page.locator('#settings-open').click();await page.evaluate(()=>__midi.reply=false);await page.locator('#settings-check').click();
    assert.equal(await page.locator('#firmware-open').isVisible(),false,'pending version retained Update');
    await page.evaluate(()=>__midi.input.receive([240,11,126,1,1,8,1,247]));assert.equal(await page.locator('#firmware-open').isVisible(),false,'wrong output version offered Update');
    await page.waitForFunction(()=>!document.querySelector('#settings-check').disabled,{},{timeout:5000});
    assert.equal(await page.locator('#firmware-open').isVisible(),false,'33681: timeout left Update active');
    await page.locator('#settings [data-close]').click();
    await page.locator('#keyboard').click();await page.waitForFunction(()=>document.querySelector('#instrument').dataset.audio==='running');
    assert.equal(await page.evaluate(()=>__audioContexts.every(r=>r.active)),true,'audio context created outside gesture');
    await page.keyboard.down('a');await page.waitForFunction(()=>Number(document.querySelector('#instrument').dataset.activeVoices)>0);await page.keyboard.up('a');
    await page.waitForFunction(()=>document.querySelector('#instrument').dataset.activeVoices==='0');
    await page.evaluate(()=>__midi.other.receive([144,64,98]));assert.equal(await page.locator('#instrument').getAttribute('data-active-voices'),'0','unselected input played');
    for (const status of [144,145,146]) {
      await page.evaluate(status=>__midi.input.receive([status,64,68]),status);
      await page.waitForFunction(()=>Number(document.querySelector('#instrument').dataset.activeVoices)>0);
      await page.evaluate(status=>__midi.input.receive([status,64,0]),status);
      await page.waitForFunction(()=>document.querySelector('#instrument').dataset.activeVoices==='0');
    }
    await page.keyboard.down('a');await page.waitForFunction(()=>Number(document.querySelector('#instrument').dataset.activeVoices)>0);
    await page.locator('#limit-four').check();assert.equal(Number(await page.locator('#instrument').getAttribute('data-active-voices'))>0,true,'Limit 4 silenced held keyboard');await page.keyboard.up('a');
    await page.locator('#limit-four').focus();await page.keyboard.down('s');await page.waitForFunction(()=>Number(document.querySelector('#instrument').dataset.activeVoices)>0);await page.keyboard.up('s');
    await page.locator('#help-open').click();await page.keyboard.down('a');assert.equal(await page.locator('#instrument').getAttribute('data-active-voices'),'0','dialog accepted keyboard note');await page.keyboard.up('a');await page.locator('#help [data-close]').click();
    await page.locator('#garden').scrollIntoViewIfNeeded();const box=await page.locator('#garden').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.waitForFunction(()=>Number(document.querySelector('#instrument').dataset.activeVoices)>0);await page.mouse.up();await page.waitForFunction(()=>document.querySelector('#instrument').dataset.activeVoices==='0');
    await page.evaluate(()=>{__midi.input.state=__midi.output.state='disconnected';__midi.change(__midi.input);});
    await page.waitForFunction(()=>document.querySelector('#midi-input').value==='');
    await page.evaluate(()=>{__midi.input.state=__midi.output.state='connected';__midi.change(__midi.input);});
    await page.waitForFunction(()=>document.querySelector('#midi-input').value==='input');
    assert.equal(await page.locator('#firmware-open').isVisible(),false,'replug retained stale Update');
    await faultControl(async()=>assert.doesNotMatch(await page.locator('body').innerText(),/beta/i),()=>page.evaluate(()=>{const p=document.createElement('p');p.id='negative-label';p.textContent='beta';document.body.append(p);}),()=>page.locator('#negative-label').evaluate(p=>p.remove()));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal overflow');
    await page.screenshot({path:resolve(artifacts,`${viewport.width}x${viewport.height}.png`),fullPage:true});
    await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
    await page.waitForFunction(()=>__midi.input.connection==='closed'&&__midi.output.connection==='closed');
    assert.equal(await page.evaluate(()=>__midi.second.closes+__midi.other.closes+__midi.secondaryOutput.closes+__midi.foreignOutput.closes),0,'pagehide closed unowned ports');
    assert.deepEqual(errors,[],'browser errors');assert.deepEqual(network,[],'unexpected external request');
    console.log(`UI ${viewport.width}×${viewport.height}: PASS, including fault controls`);
  } finally {await context.close();}
}
let browser;
try {
  // EPERM is a handoff boundary: do not escalate or try another server/port.
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const executablePath=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean).find(existsSync);
  assert(executablePath,'Local Chrome was not found. Set CHROME_PATH.');
  await mkdir(artifacts,{recursive:true});
  browser=await chromium.launch({executablePath,headless:true});
  const origin=`http://127.0.0.1:${server.address().port}`;
  for (const viewport of [{width:1440,height:900},{width:390,height:844}]) await runUI(browser,origin,viewport);
  const page=await browser.newPage();await page.goto(origin);const metrics=await testSoundPCM(page);await writeFile(resolve(artifacts,'sound-metrics.json'),JSON.stringify(metrics,null,2)+'\n');await page.close();
  console.log('Browser and carried-over PCM gates: PASS');
} catch (error) {
  console.error(error.code==='EPERM' ? 'EPERM: local server bind denied; browser lane stopped and left for Claude.' : error);
  process.exitCode=1;
} finally {
  await browser?.close();
  if(server.listening) await new Promise(resolve=>server.close(resolve));
}
