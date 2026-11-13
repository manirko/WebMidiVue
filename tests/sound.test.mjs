import test from 'node:test';
import assert from 'node:assert/strict';
import {ElementarySynthEngine} from '../dist/biotron/sound/elementary/engine.mjs';
import {blocksKeyboardNotes} from '../dist/biotron/sound/core.mjs';
test('Sergey 33686: live note-limit changes retain held voices and accept subsequent MIDI/keyboard notes', async () => {
  const engine = new ElementarySynthEngine({currentTime: 0, state: 'running'})
  for (let i = 0; i < 6; i++) engine.noteOn(i % 2 ? 'keyboard' : 'plant', i % 2, 60 + i, 90)
  const context = engine.context
  await engine.setQuality('safe')
  assert.equal(engine.context, context)
  assert.equal(engine.quality, 'safe')
  assert.equal(engine.poolSize, 4)
  assert.equal(engine.activeVoiceCount, 4)
  assert.deepEqual([...engine.pool.ledger.entries.keys()], ['plant:0:62', 'keyboard:1:63', 'plant:0:64', 'keyboard:1:65'])
  assert(engine.values.gate.every(value => value === 1))
  assert.equal(engine.noteOff('keyboard', 1, 65), true)
  engine.noteOn('plant', 0, 70, 90)
  assert.equal(engine.activeVoiceCount, 4)
  await engine.setQuality('standard')
  assert.equal(engine.poolSize, 8)
  engine.noteOn('keyboard', 1, 71, 90)
  assert.equal(engine.activeVoiceCount, 5)
  assert.equal(engine.state, 'running')
})

test('Sergey 33686: focus on Limit 4 keeps keyboard notes while text fields remain protected', () => {
  const event = (type, marked, disabled = false) => {
    const control = {tagName: 'INPUT', type, disabled, getAttribute: () => marked ? 'true' : null}
    return {target: {closest: selector => selector === 'input,select,textarea' ? control : null}}
  }
  for (const allowSelectors of [false, true]) {
    assert.equal(Boolean(blocksKeyboardNotes(event('checkbox', true), allowSelectors)), false,
      'focused Limit 4 blocked or released keyboard notes')
    assert.equal(Boolean(blocksKeyboardNotes(event('checkbox', false), allowSelectors)), true)
    assert.equal(Boolean(blocksKeyboardNotes(event('checkbox', true, true), allowSelectors)), true)
    assert.equal(Boolean(blocksKeyboardNotes(event('text', true), allowSelectors)), true)
  }
})

test('33686 negative control: voice cap steals old notes without muting future input', async () => {
  const engine=new ElementarySynthEngine({currentTime:0,state:'running'},{quality:'safe'});
  for (let note=60;note<68;note++) engine.noteOn('plant',0,note,98);
  assert.equal(engine.activeVoiceCount,4); assert.equal(engine.noteOff('plant',0,60),false);
  assert.equal(engine.noteOff('plant',0,67),true); engine.noteOn('keyboard',0,72,98); assert.equal(engine.activeVoiceCount,4);
  engine.panic(); assert.equal(engine.activeVoiceCount,0); assert(engine.values.gate.every(v=>v===0));
});

test('33688: raw Plant/Light channels 0x91 and 0x92 reach Elementary voices; panic is silent', async () => {
  const {MidiInputSession}=await import('../dist/biotron/sound/player.mjs');
  const {biotronVoiceLevel}=await import('../dist/biotron/sound/biotronCalibration.mjs');
  const engine=new ElementarySynthEngine({currentTime:0,state:'running'});
  const session=new MidiInputSession(engine,()=>{}, {voiceLevel:biotronVoiceLevel}); session.input={id:'light-fixture'};
  session.onMessage({data:[0x91,64,68]}); assert.equal(engine.activeVoiceCount,1); assert(engine.values.vel.some(v=>v>0));
  session.onMessage({data:[0x92,64,68]}); assert.equal(engine.activeVoiceCount,2);
  assert(engine.values.vel.some(v=>v===68/127*.08));
  session.onMessage({data:[0x91,64,0]}); assert.equal(engine.activeVoiceCount,1);
  session.onMessage({data:[0xb0,123,0]}); assert.equal(engine.activeVoiceCount,0); assert(engine.values.gate.every(v=>v===0));
  session.onMessage({data:[0xf8]}); assert.equal(engine.activeVoiceCount,0);
});
