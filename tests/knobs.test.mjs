import test from 'node:test';
import assert from 'node:assert/strict';
import {toNormalized, fromNormalized, quantize, keyboardStep} from '../dist/core/knobs.mjs';
import {mountSettings} from '../dist/biotron/settings-ui.mjs';
import {SettingsSession} from '../dist/biotron/settings.mjs';
import {Port, memory, turn} from './fixtures.mjs';
import {installDOM, fire} from './dom-fixture.mjs';

// Independent v1 numeric field contract: name, min, max, step, default, command bytes.
const SETTINGS = [
  ['plantBpm',1,1000,1,462,[0]], ['plant_midi_channel',1,16,1,1,[127,0]],
  ['swing_first_note_percent',1,100,1,100,[26]], ['minPlantVelocity',0,127,1,8,[15]],
  ['maxPlantVelocity',0,127,1,98,[5]], ['same_note_plant',0,10,1,1,[11]],
  ['firstValue',0,100,1,10,[2]], ['noteDistance',0,100,1,50,[1]], ['smoothness',0,99,1,0,[3]],
  ['light_midi_channel',1,16,1,2,[127,1]], ['lightBpm',0,30,1,4,[9]],
  ['same_note_light',0,10,1,0,[24]], ['minLightVelocity',0,127,1,74,[17]],
  ['maxLightVelocity',0,127,1,75,[6]], ['range_light_note',0,36,1,12,[13]],
];
const frame = (name, command, value) => [240,20,13,...command,
  ...(name === 'plantBpm' ? [...Array(Math.floor(value/127)).fill(127),value%127] : command.length === 2 ? [value-1] : [value]),247];
function fixture(t, options) {
  const restore = installDOM();
  const session = new SettingsSession(options), output = new Port('out','Biotron','output');
  session.connectionChanged(new Port('in','Biotron'), output); session.snapshotKnown = true;
  const root = document.createElement('div'), ui = mountSettings(root, session, memory());
  session.onChange = ui.render; t.after(() => {session.cancel(); restore();});
  return {root, session, output, ui};
}
const dialFor = (root, name) => root.querySelector('#setting-' + name);
const editorFor = input => input.parentElement.parentElement.querySelector('.value-editor');
function expectFrames(actual, expected) {
  assert.deepEqual(actual, expected);
  if (expected.length) {
    assert.throws(() => assert.deepEqual([...actual, actual[0]], expected));
    const wrong = actual.map(bytes => [...bytes]); wrong[0][wrong[0].length-2] ^= 1;
    assert.throws(() => assert.deepEqual(wrong, expected));
  } else assert.throws(() => assert.deepEqual([[240,20,13,1,0,247]], expected));
}
test('K1: every v1 numeric range, integer step, default and normalized mapping survives the knob', t => {
  const {root, session} = fixture(t);
  assert.equal(root.querySelectorAll('[data-setting]').length,26);
  assert.equal(root.querySelectorAll('.knob').length,SETTINGS.length);
  for (const [name,min,max,step,initial] of SETTINGS) {
    const spec = {id:name,name,min,max,step};
    const control = dialFor(root,name);
    const verify = input => {
      assert.equal(input.type,'text'); assert.equal(input.getAttribute('role'),'slider');
      assert.equal(input.getAttribute('aria-valuemin'),String(min)); assert.equal(input.getAttribute('aria-valuemax'),String(max));
      assert.equal(input.getAttribute('aria-valuenow'),String(initial));
      assert.equal(Number(editorFor(input).step),step);
    };
    verify(control); const original = control.getAttribute('aria-valuenow');
    control.setAttribute('aria-valuenow',initial+step); assert.throws(() => verify(control)); control.setAttribute('aria-valuenow',original);
    for (let value = min; value <= max; value += step) {
      assert.equal(quantize(fromNormalized(toNormalized(value,spec),spec),spec),value,`${name}: ${value}`);
      assert.equal(quantize(fromNormalized(Math.round(toNormalized(value,spec)*1000)/1000,spec),spec),value,`${name}: native scale ${value}`);
    }
    assert.equal(quantize(min-1,spec),min); assert.equal(quantize(max+1,spec),max);
    assert.equal(keyboardStep(min,1,false,spec),min+step); assert.equal(keyboardStep(max,1,false,spec),max);
    assert.notEqual(quantize(min+step,spec),min,'negative control: one step must change the value');
    assert.equal(Number(session.values[name]),initial);
  }
});
test('K1: each settings drag commits exactly one original frame; arrows and reset commit once', async t => {
  const {root, output} = fixture(t);
  for (const [name,min,max,step,initial,command] of SETTINGS) {
    const input = dialFor(root,name), target = initial === max ? min : max;
    fire(input,'pointerdown',{button:0,pointerId:1,clientY:200});
    fire(input,'pointermove',{pointerId:1,clientY:200+(target === min ? 160 : -160)});
    expectFrames(output.sent,[]);
    fire(input,'pointerup',{pointerId:1}); fire(input,'change'); fire(input,'lostpointercapture'); await turn();
    expectFrames(output.sent,[frame(name,command,target)]); output.sent=[];
    fire(input,'dblclick'); fire(input,'change'); await turn();
    expectFrames(output.sent,[frame(name,command,initial)]); output.sent=[];
    fire(input,'dblclick'); await turn(); expectFrames(output.sent,[]);
    const key = initial === max ? 'ArrowDown' : 'ArrowUp', next = initial + (initial === max ? -step : step);
    fire(input,'keydown',{key}); expectFrames(output.sent,[]);
    fire(input,'keyup',{key}); fire(input,'keyup',{key}); await turn();
    expectFrames(output.sent,[frame(name,command,next)]); output.sent=[];
    fire(input,'dblclick'); await turn(); expectFrames(output.sent,[frame(name,command,initial)]); output.sent=[];
    // Cancellation and unrelated keys are negative controls for the same real event path.
    fire(input,'pointerdown',{button:0,pointerId:2,clientY:200});
    fire(input,'pointermove',{pointerId:2,clientY:120}); fire(input,'pointercancel'); fire(input,'change');
    fire(input,'keydown',{key:'a'}); fire(input,'keyup',{key:'a'}); await turn();
    expectFrames(output.sent,[]); assert.equal(input.getAttribute('aria-valuenow'),String(initial));
  }
});
test('K1: readback/render and preset load never send; unknown snapshots and failed saves stay local', async t => {
  const {root, session, output, ui} = fixture(t);
  session.load({...session.values,noteDistance:42}); ui.render(); expectFrames(output.sent,[]);
  const input = dialFor(root,'noteDistance'); assert.equal(input.getAttribute('aria-valuenow'),'42');
  session.snapshotKnown=false;
  fire(input,'keydown',{key:'ArrowUp'}); fire(input,'keyup',{key:'ArrowUp'}); await turn();
  assert.equal(session.values.noteDistance,43); expectFrames(output.sent,[]);
  session.snapshotKnown=true; session.persist=async()=>{throw Error('blocked save');};
  fire(input,'keydown',{key:'ArrowUp'}); fire(input,'keyup',{key:'ArrowUp'}); await turn();
  assert.equal(session.values.noteDistance,43); assert.equal(input.getAttribute('aria-valuenow'),'43'); expectFrames(output.sent,[]);
  session.persist=async()=>{};
  const editor = editorFor(input); editor.value=''; fire(editor,'change'); editor.blur(); await turn(); expectFrames(output.sent,[]);
  editor.value='51'; fire(editor,'change'); editor.blur(); await turn(); expectFrames(output.sent,[[240,20,13,1,51,247]]);
  output.sent=[]; fire(input,'dblclick'); await turn(); expectFrames(output.sent,[[240,20,13,1,50,247]]);
  session.sending=true; ui.render(); assert(root.querySelectorAll('.knob input,.knob button').every(control=>control.disabled));
  session.sending=false; ui.render(); assert(root.querySelectorAll('.knob input,.knob button').every(control=>!control.disabled));
});
