import test from 'node:test';
import assert from 'node:assert/strict';
import {MidiSession, automaticInput, pairedOutput} from '../dist/biotron/midi.mjs';
import {Port, Access, deferred, turn} from './fixtures.mjs';
test('MIDI: gesture-only SysEx request; Biotron auto-selection ignores foreign and Windows second ports', async () => {
  const foreign=new Port('f','Keyboard'), second=new Port('s','MIDIIN2 (Biotron)'), primary=new Port('i','Biotron');
  const wrongOutput=new Port('wo','Keyboard','output'), secondaryOutput=new Port('so','MIDIOUT2 (Biotron)','output'), output=new Port('o','Biotron','output');
  const access=new Access([foreign,second,primary],[wrongOutput,secondaryOutput,output]); let requests=0; const received=[];
  const midi=new MidiSession({request: async options=>{assert.deepEqual(options,{sysex:true});requests++;return access;},onMessage:data=>received.push(data)});
  assert.equal(requests,0); assert.equal(automaticInput([foreign,second]),null);
  assert.equal(automaticInput([second,primary]),primary);
  assert.equal(automaticInput([primary,new Port('i2','Biotron v2')]),null);
  await midi.connect(); assert.equal(requests,1); assert.equal(midi.input,primary); assert.equal(midi.output,output);
  assert.equal(foreign.opens+second.opens+wrongOutput.opens+secondaryOutput.opens,0); assert.deepEqual(output.sent,[]);
  foreign.receive([144,60,98]); assert.equal(received.length,0); primary.receive([145,64,68]); assert.deepEqual(received,[[145,64,68]]);
  await midi.pause(); primary.receive([144,60,98]); assert.equal(received.length,1);
  assert.equal(primary.closes,1); assert.equal(output.closes,1); assert.equal(foreign.closes+second.closes+wrongOutput.closes+secondaryOutput.closes,0);
  access.change(primary); await turn(); assert.equal(primary.opens,1); await midi.dispose();
});
test('MIDI: ambiguous outputs need choice; Android duplicate cables pair by index', () => {
  const input=new Port('i','Biotron'), first=new Port('o','Biotron','output'), second=new Port('o2','Biotron','output');
  assert.equal(pairedOutput(input,[input],[first,second]),null);
  const cable=new Port('i2','Biotron'); assert.equal(automaticInput([input,cable]),input);
  assert.equal(pairedOutput(cable,[input,cable],[first,second]),second);
  assert.equal(pairedOutput(new Port('foreign','Keyboard'),[input],[first]),null);
});
test('MIDI: unplug/replug recovery, no reconnect after hide, borrowed ports stay open', async () => {
  const input=new Port('i','Biotron'), output=new Port('o','Biotron','output'), other=new Port('other','Other');
  const access=new Access([input,other],[output]);
  const midi=new MidiSession({request:async()=>access}); await midi.connect();
  input.state=output.state='disconnected'; access.change(input); await turn(); assert.equal(midi.input,null);
  input.state=output.state='connected'; access.change(input); await turn(); assert.equal(midi.input,input); assert.equal(midi.output,output);
  await midi.pause(); assert.equal(midi.input,null); const opens=input.opens; access.change(input); await turn(); assert.equal(input.opens,opens); assert.equal(other.closes,0);
  await midi.connect(); assert.equal(midi.input,input); await midi.dispose();
  const borrowed=new Port('borrowed','Biotron'), borrowedOut=new Port('borrowed-out','Biotron','output'); borrowed.connection=borrowedOut.connection='open';
  const session=new MidiSession({request:async()=>new Access([borrowed],[borrowedOut])}); await session.connect(); await session.dispose(); assert.equal(borrowed.closes,0); assert.equal(borrowedOut.closes,0);
});
test('MIDI: late permission/open completions cannot reclaim hidden-page ports', async () => {
  const permission=deferred(), access=new Access([new Port('i','Biotron')],[]);
  const midi=new MidiSession({request:()=>permission.promise}); const connecting=midi.connect(); await midi.pause(); permission.resolve(access); await connecting; assert.equal(midi.input,null); assert.equal(access.inputs.get('i').opens,0);
  const input=new Port('i','Biotron'), opening=deferred(); input.open=()=>{input.opens++;return opening.promise.then(()=>{input.connection='open';return input;});};
  const late=new MidiSession({request:async()=>new Access([input],[])}); const pending=late.connect(); await turn(); await late.pause(); opening.resolve(input); await pending; assert.equal(late.input,null); assert(input.closes>=1); assert.equal(input.connection,'closed'); await late.dispose();
});
test('MIDI: permission failure can retry; port close failure is visible and retryable', async () => {
  let attempts=0; const input=new Port('i','Biotron'), output=new Port('o','Biotron','output');
  const midi=new MidiSession({request:async()=>{if (++attempts===1) throw Error('denied'); return new Access([input],[output]);}});
  await assert.rejects(midi.connect(),/denied/); assert.equal(midi.input,null); await midi.connect(); assert.equal(midi.input,input);
  const close=output.close.bind(output); output.close=async()=>{throw Error('close failed');};
  await assert.rejects(midi.pause(),/close failed/); assert(midi.owned.has(output)); output.close=close; await midi.dispose(); assert.equal(midi.owned.size,0);
});

test('MIDI: a failing output open keeps the selected input visible; output can retry', async () => {
  const input=new Port('i','Biotron'), output=new Port('o','Biotron','output'), access=new Access([input],[output]);
  const original=output.open.bind(output); output.open=async()=>{throw Error('output open failed');};
  let state;const midi=new MidiSession({request:async()=>access,onState:s=>state=s});
  await assert.rejects(midi.connect(),/output open failed/);assert.equal(state.input,input);assert.equal(state.output,null);assert.equal(state.status,'error');
  output.open=original;await midi.selectOutput(output.id);assert.equal(midi.output,output);await midi.dispose();
});
