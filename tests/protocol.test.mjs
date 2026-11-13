import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMANDS, commandFrame, settingValue, createCommands} from '../dist/biotron/protocol.mjs';
import {buildSettingsQuery, parseSettingsResponse, applySettingsVector, settingsVectorFromCommands, settingsVectorsEqual} from '../dist/biotron/readback.mjs';
import {builtinPresets} from '../dist/biotron/factory-presets.mjs';
import {response, values} from './fixtures.mjs';
// Independent fixture: every command ID/range, including both subcommands.
const table = {
 plantBpm:[0,1,1000], lightBpm:[9,0,30], noteOffPercent:[12,0,100], noteDistance:[1,0,100], firstValue:[2,0,100], smoothness:[3,0,99], scale:[4,0,127],
 minPlantVelocity:[15,0,127],maxPlantVelocity:[5,0,127],minLightVelocity:[17,0,127],maxLightVelocity:[6,0,127],randomness:[10,0,127],same_note_plant:[11,0,10],same_note_light:[24,0,10],
 range_light_note:[13,0,36],light_pitch_mode:[19,0,127],plant_no_velocity:[22,0,127],light_no_velocity:[23,0,127],randomPlantVelocity:[16,0,127],randomLightVelocity:[18,0,127],performance:[21,0,127],
 middle_plant_note:[25,60,72],plant_midi_channel:[[127,0],1,16],light_midi_channel:[[127,1],1,16],swing_first_note_percent:[26,1,100],button_mode_state:[27,0,127]
};
test('protocol frames: exact bytes, all 26 commands and channel endpoints', () => {
  assert.deepEqual(Object.keys(COMMANDS), Object.keys(table));
  for (const [name,[command,min,max]] of Object.entries(table)) {
    assert.deepEqual(COMMANDS[name],{command,min,max});
    for (const value of new Set([min,max])) {
      const payload = name === 'plantBpm' ? (value === 1000 ? [127,127,127,127,127,127,127,111] : [1]) : Array.isArray(command) ? [value-1] : [value];
      assert.deepEqual(commandFrame(name,value),[240,20,13,...[command].flat(),...payload,247],name);
    }
    // Negative controls must fail before a port could receive anything.
    for (const bad of [min-1,max+1,NaN,Infinity,null,'',{},[],1.5]) assert.throws(() => commandFrame(name,bad),undefined,`${name}/${bad}`);
  }
  for (const name of ['unknown','constructor','toString','__proto__','hasOwnProperty']) assert.throws(() => commandFrame(name,1));
  assert.throws(()=>settingValue('scale',' '));
  assert.deepEqual(commandFrame('maxPlantVelocity',127),[240,20,13,5,127,247]);
  for (const [bpm,wire] of [[126,[126]],[127,[127,0]],[128,[127,1]],[254,[127,127,0]]]) assert.deepEqual(commandFrame('plantBpm',bpm),[240,20,13,0,...wire,247]);
});
test('33687 / readback validation: 47 bytes, 108 round trips, 128 nonce pairs, malformed bytes', () => {
  assert.equal(response().length,47);
  assert.deepEqual(buildSettingsQuery(42),[240,20,13,123,1,42,247]);
  const parsed = parseSettingsResponse(response(),42);
  assert.equal(parsed.valid,true); assert.equal(parsed.dirty,false);
  assert.equal(parsed.dirtyGeneration,7); assert.equal(parsed.persistedGeneration,7); assert.deepEqual(parsed.values,values);
  assert.equal(parseSettingsResponse(response(),41),null);
  assert.equal(parseSettingsResponse(response().slice(0,-1),42),null);
  for (const flags of [4,5,7,8,127]) assert.equal(parseSettingsResponse(response(42,values,flags),42),null);
  const commands = createCommands();
  applySettingsVector(commands,values);
  assert.equal(commands.plantBpm.value,462); assert.equal(commands.plant_midi_channel.value,2); assert.equal(commands.light_midi_channel.value,3);
  assert(settingsVectorsEqual(settingsVectorFromCommands(commands),values));
  assert(!settingsVectorsEqual(values,[...values.slice(0,-1),1]));
  assert.equal(settingsVectorFromCommands({...commands,maxPlantVelocity:{value:127}})[9],127);
  for (let index=0;index<27;index++) for (const value of [0,1,126,127]) {
    const vector = [...values]; vector[index]=value;
    const frame=response(42,vector), before=[...frame];
    const answer=parseSettingsResponse(frame,42); assert.deepEqual(answer.values,vector);
    applySettingsVector(commands,answer.values); assert.deepEqual(settingsVectorFromCommands(commands),vector); assert.deepEqual(frame,before);
  }
  for (let nonce=0;nonce<128;nonce++) {assert.deepEqual(parseSettingsResponse(response(nonce),nonce).values,values); assert.equal(parseSettingsResponse(response(nonce),(nonce+1)%128),null);}
  for (let index=1;index<46;index++) for (const bad of [-1,128,.5,NaN,Infinity]) {const frame=response(); frame[index]=bad; assert.equal(parseSettingsResponse(frame,42),null);}
  for (const index of [0,4,5,6,46]) {const frame=response(); frame[index]^=1; assert.equal(parseSettingsResponse(frame,42),null);}
  for (const bpm of [0,127,128,16383]) {const vector=settingsVectorFromCommands({...commands,plantBpm:{value:bpm}}); assert.equal(vector[0],bpm&127); assert.equal(vector[1],bpm>>7&127);}
  assert.throws(() => applySettingsVector(commands,values.slice(1)));
});
test('Sergey 33687: fresh web presets 1/2, wire bytes 0/1; saved channels 2/3 preserved', () => {
  for (const preset of builtinPresets) {
    assert.equal(preset.data.plant_midi_channel,1,preset.name); assert.equal(preset.data.light_midi_channel,2,preset.name);
    assert.deepEqual([commandFrame('plant_midi_channel',1),commandFrame('light_midi_channel',2)],[[240,20,13,127,0,0,247],[240,20,13,127,1,1,247]]);
    const commands=createCommands(), vector=[...values]; vector[23]=1; vector[24]=2;
    applySettingsVector(commands,vector); assert.equal(commands.plant_midi_channel.value,1); assert.equal(commands.light_midi_channel.value,2);
    applySettingsVector(commands,values); assert.equal(commands.plant_midi_channel.value,2); assert.equal(commands.light_midi_channel.value,3);
  }
});
