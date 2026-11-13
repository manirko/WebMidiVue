import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundPlayer} from '../dist/biotron/sound/player.mjs';
import {ElementarySynthEngine} from '../dist/biotron/sound/elementary/engine.mjs';
import {mountKeyboard} from '../dist/biotron/keyboard-ui.mjs';
import {deferred, turn} from './fixtures.mjs';
import {installDOM, fire} from './dom-fixture.mjs';

const KEYS = ['A','W','S','E','D','F','T','G','Y','H','U','J','K'];
const event = (code, target = {}, extra = {}) => ({code, target, preventDefault() {this.prevented=true;}, ...extra});
const field = (tagName, type = '', playable = false) => ({closest: selector => selector === 'input,select,textarea'
  ? {tagName,type,getAttribute: () => playable ? 'true' : null} : null});
function player(t, onState = () => {}, ready = async () => {}) {
  const engines=[];
  const sound=new SoundPlayer({onState,createEngine: () => {
    const engine=new ElementarySynthEngine({currentTime:0,state:'running'});
    engine.ensureReady=ready; engines.push(engine); return engine;
  }});
  t.after(()=>sound.stop()); return {sound,engines};
}
function keyboard(t, ready) {
  const restore=installDOM(), errors=[]; let ui;
  const {sound,engines}=player(t,state=>ui?.render(state.notes),ready);
  const root=document.createElement('div'); ui=mountKeyboard(root,sound,message=>errors.push(message));
  t.after(()=>{sound.onState=()=>{};restore();});
  return {sound,engines,root,ui,errors};
}
test('K2: every physical key plays its existing note from cold start, without a toggle', async t => {
  const states=[], {sound,engines}=player(t,state=>states.push(state));
  assert.equal(engines.length,0);
  for (const [index,key] of KEYS.entries()) {
    const down=event('Key'+key); await sound.keyDown(down);
    assert.equal(down.prevented,true); assert.equal(sound.engine.activeVoiceCount,1);
    assert.equal(sound.held.get('Key'+key).note,60+index);
    assert.deepEqual(states.at(-1).notes,[60+index]);
    await sound.keyDown(event('Key'+key,{}, {repeat:true})); assert.equal(sound.engine.activeVoiceCount,1);
    sound.keyUp(event('Key'+key)); assert.equal(sound.engine.activeVoiceCount,0); assert.deepEqual(states.at(-1).notes,[]);
  }
  assert.equal(engines.length,1); await sound.keyDown(event('KeyZ')); assert.equal(sound.engine.activeVoiceCount,0);
  await sound.stop(); await sound.keyDown(event('KeyA')); assert.equal(engines.length,2); assert.equal(sound.engine.activeVoiceCount,1);
});
test('K2: fields, selects, editable content, modifiers and dialogs block notes; Limit 4 stays playable', async t => {
  const {sound,engines}=player(t);
  const blocked=[field('INPUT','text'),field('INPUT','number'),field('TEXTAREA'),field('SELECT'),field('SELECT','',true),
    {isContentEditable:true}, {closest: selector => selector.startsWith('[role="textbox"]') ? {} : null}];
  for (const target of blocked) {const down=event('KeyA',target); await sound.keyDown(down); assert.equal(down.prevented,undefined);}
  for (const key of ['repeat','isComposing','ctrlKey','metaKey','altKey','shiftKey','defaultPrevented']) await sound.keyDown(event('KeyA',{}, {[key]:true}));
  assert.equal(engines.length,0,'negative controls must not even create audio');
  await sound.keyDown(event('KeyA',field('INPUT','checkbox',true))); assert.equal(sound.engine.activeVoiceCount,1);
  // Keyup still releases a note if focus moved into a field after keydown.
  sound.keyUp(event('KeyA',field('INPUT','text'))); assert.equal(sound.engine.activeVoiceCount,0);
  await sound.keyDown(event('KeyA',field('INPUT','checkbox'))); assert.equal(sound.engine.activeVoiceCount,0);
});
test('K2: every key cap sounds its note and highlights only while an actual voice is active', async t => {
  const {sound,root,ui,errors}=keyboard(t);
  assert.equal(root.children.length,13);
  for (const [index,cap] of root.children.entries()) {
    assert.equal(cap.children[0].textContent,KEYS[index]);
    fire(cap,'pointerdown',{button:2,pointerId:1}); await turn(); assert.equal(sound.engine?.activeVoiceCount||0,0);
    fire(cap,'pointerdown',{button:0,pointerId:1}); await turn();
    assert.equal(sound.held.get('cap:1').note,60+index); assert.equal(sound.engine.activeVoiceCount,1);
    assert.equal(cap.getAttribute('aria-pressed'),'true');
    const release=['pointerup','pointercancel','lostpointercapture'][index%3]; fire(cap,release,{pointerId:1});
    assert.equal(sound.engine.activeVoiceCount,0); assert.equal(cap.getAttribute('aria-pressed'),'false');
    fire(cap,'click',{detail:1}); await turn(); assert.equal(sound.engine.activeVoiceCount,0,'pointer click must not duplicate a held note');
  }
  const cap=root.children[0];
  fire(cap,'pointerdown',{button:0,pointerId:1}); fire(cap,'pointerdown',{button:0,pointerId:2}); await turn();
  assert.equal(sound.engine.activeVoiceCount,2); fire(cap,'pointerup',{pointerId:1}); assert.equal(cap.getAttribute('aria-pressed'),'true');
  ui.release(); assert.equal(cap.getAttribute('aria-pressed'),'false'); assert.equal(sound.engine.activeVoiceCount,0);
  for (const key of KEYS.slice(0,6)) await sound.keyDown(event('Key'+key));
  await sound.engine.setQuality('safe'); sound.emit();
  assert.deepEqual(root.children.filter(cap=>cap.getAttribute('aria-pressed')==='true').map(cap=>cap.children[0].textContent),KEYS.slice(2,6));
  sound.releaseKeyboard(); assert(root.children.every(cap=>cap.getAttribute('aria-pressed')==='false'));
  assert.deepEqual(errors,[]);
});
test('K2: quick cold clicks and accessible clicks sound, then release; cancelled gestures stay silent', async t => {
  t.mock.timers.enable({apis:['setTimeout']}); const ready=deferred();
  const {sound,root,errors}=keyboard(t,()=>ready.promise), [a,w]=root.children;
  fire(a,'pointerdown',{button:0,pointerId:1}); fire(a,'pointerup',{pointerId:1});
  assert.equal(sound.engine.activeVoiceCount,0); ready.resolve(); await turn();
  assert.equal(sound.engine.activeVoiceCount,1); assert.equal(a.getAttribute('aria-pressed'),'true');
  fire(w,'click',{detail:0}); await turn(); assert.equal(sound.engine.activeVoiceCount,2); assert.equal(w.getAttribute('aria-pressed'),'true');
  t.mock.timers.tick(270); assert.equal(sound.engine.activeVoiceCount,0); assert.equal(a.getAttribute('aria-pressed'),'false');
  fire(a,'pointerdown',{button:0,pointerId:2}); fire(a,'pointercancel',{pointerId:2}); await turn();
  assert.equal(sound.engine.activeVoiceCount,0); assert.deepEqual(errors,[]);
});
test('K2: blur/stop releases pending notes, and failed audio startup can retry the same key', async t => {
  const ready=deferred(), {sound}=player(t,()=>{},()=>ready.promise);
  const pending=sound.keyDown(event('KeyA')); sound.releaseKeyboard(); ready.resolve(); await pending;
  assert.equal(sound.engine.activeVoiceCount,0); assert.equal(sound.held.size,0);
  await sound.keyDown(event('KeyA')); assert.equal(sound.engine.activeVoiceCount,1);
  await sound.stop(); assert.equal(sound.engine,null); assert.equal(sound.held.size,0);
  let fail=true;
  const {sound:retry}=player(t,()=>{},async()=>{if(fail)throw Error('audio blocked');});
  await assert.rejects(retry.keyDown(event('KeyA')),/audio blocked/); assert.equal(retry.held.size,0);
  fail=false; await retry.keyDown(event('KeyA')); assert.equal(retry.engine.activeVoiceCount,1);
  retry.releaseKeyboard(); assert.equal(retry.engine.activeVoiceCount,0);
});
