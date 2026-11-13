import test from 'node:test';
import assert from 'node:assert/strict';
import {SettingsSession} from '../dist/biotron/settings.mjs';
import {Presets} from '../dist/biotron/presets.mjs';
import {parsePreset} from '../dist/biotron/protocol.mjs';
import {BIOTRON_FIRMWARE, FIRMWARE_URL, needsFirmwareUpdate, parseVersionReply} from '../dist/biotron/firmware.mjs';
import {Port, response, values, memory, deferred, turn} from './fixtures.mjs';
const connected = options => {const session=new SettingsSession(options), input=new Port('i','Biotron'), output=new Port('o','Biotron','output'); session.connectionChanged(input,output,0); return {session,input,output};};
const read = async (session,version=[1,8,1],vector=values) => {const check=session.check(); session.receive(response(session.nonce,vector)); session.receive([240,11,126,0,...version,247]); return check;};
test('no write on connect, load or readback; one edit sends its committed value once', async () => {
  const {session,output}=connected(); assert.deepEqual(output.sent,[]);
  const before={...session.values}; session.load(before); assert.deepEqual(output.sent,[]);
  const check=session.check(); assert.deepEqual(output.sent,[[240,20,13,123,1,1,247],[240,20,13,126,0,247]]);
  output.sent=[]; session.receive(response(1)); await check; assert.deepEqual(output.sent,[]);
  await session.edit('scale',5); assert.deepEqual(output.sent,[[240,20,13,4,5,247]]);
  await session.edit('scale',5); assert.equal(output.sent.length,1);
  assert.equal(session.values.scale,5);
  assert.throws(() => session.load({scale:3,unknown:1})); assert.equal(session.values.scale,5); assert.equal(output.sent.length,1);
  await assert.rejects(session.edit('scale','')); assert.equal(output.sent.length,1);
  session.cancel();
});
test('33681: timeout invalidates a stale differing version for known and unknown snapshots', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  for (const known of [false,true]) {
    const {session,output}=connected(); session.version='1.7.4'; session.snapshotKnown=known;
    session.versionTimeout('another-output'); assert.equal(session.version,'1.7.4'); assert.equal(session.updateAvailable,true);
    session.versionTimeout(output.id); assert.equal(session.version,''); assert.equal(session.updateAvailable,false);
    const check=session.check(); session.receive(response(session.nonce));
    session.version='1.7.4'; t.mock.timers.tick(2500); assert.equal(session.updateAvailable,false);
    void check; session.cancel();
  }
});
test('version compare and reply validation: no reply, equal, differing, malformed, wrong port, stale', async () => {
  assert.equal(BIOTRON_FIRMWARE,'1.8.2'); assert.equal(FIRMWARE_URL,'https://settings.playtronica.com/#/biotron');
  for (const value of ['',null,undefined,'x','1.8','1.8.2','01.08.02','128.0.0']) assert.equal(needsFirmwareUpdate(value),false);
  for (const value of ['1.8.1','1.9.8','2.0.0']) assert.equal(needsFirmwareUpdate(value),true);
  const frame=[240,11,126,0,1,8,1,247]; assert.equal(parseVersionReply(frame,0),'1.8.1'); assert.equal(parseVersionReply(frame,1),null);
  for (let index=1;index<7;index++) {const bad=[...frame]; bad[index]=128; assert.equal(parseVersionReply(bad,0),null);}
  const {session}=connected(); session.receive(frame); assert.equal(session.updateAvailable,false);
  await read(session,[1,8,2]); assert.equal(session.updateAvailable,false);
  await read(session); assert.equal(session.updateAvailable,true);
  session.connectionChanged(new Port('other','Biotron'),new Port('out-other','Biotron','output'),0);
  session.receive(frame); assert.equal(session.updateAvailable,false); session.cancel();
});
test('bounded read failure, retry, later failure; no unknown-setting write, no local preset overwrite', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const {session,output}=connected(); const first=session.check(); const rejection=assert.rejects(first,/timed out/); t.mock.timers.tick(2500); await rejection;
  assert.equal(session.snapshotKnown,false); output.sent=[]; await session.edit('scale',6); assert.deepEqual(output.sent,[]);
  await read(session); assert.equal(session.snapshotKnown,true); assert.equal(session.values.scale,6); assert.equal(session.pendingPreset,true);
  assert.match(session.message,/local preset is unchanged/);
  const second=session.check(), failed=assert.rejects(second,/timed out/); t.mock.timers.tick(2500); await failed; assert.equal(session.snapshotKnown,true);
  session.cancel();
});
test('33681 stale edits and real persistence failures never write a replacement device', async () => {
  for (const change of ['A to B','disconnect','A to B to A','same-object reconnect','snapshot lost']) {
    const saving=deferred(), {session,input,output}=connected({persist:()=>saving.promise}); session.snapshotKnown=true;
    const edit=session.edit('firstValue',21);
    if (change==='snapshot lost') session.snapshotKnown=false;
    else if (change==='same-object reconnect') {session.connectionChanged(null,null,0); session.connectionChanged(input,output,0); session.snapshotKnown=true;}
    else {session.connectionChanged(null,null,0); if (change!=='disconnect') session.connectionChanged(new Port('b','Biotron'),new Port('bo','Biotron','output'),0); if (change==='A to B to A') {session.connectionChanged(input,output,0); session.snapshotKnown=true;}}
    saving.resolve(); await edit; assert.deepEqual(output.sent,[],change); session.cancel();
  }
  const {session,output}=connected({persist:async()=>{throw Error('save failed');}}); session.snapshotKnown=true;
  await assert.rejects(session.edit('scale',3),/save failed/); assert.deepEqual(output.sent,[]);
  session.persist=async()=>{}; await session.edit('scale',3); assert.deepEqual(output.sent,[[240,20,13,4,3,247]]);
  session.cancel();
});
test('independent edits on one connection retain both values and both writes', async () => {
  const a=deferred(), b=deferred(); let index=0;
  const {session,output}=connected({persist:()=>[a.promise,b.promise][index++]}); session.snapshotKnown=true;
  const first=session.edit('scale',5), second=session.edit('lightBpm',9); b.resolve(); await second; a.resolve(); await first;
  assert.deepEqual(output.sent,[[240,20,13,9,9,247],[240,20,13,4,5,247]]); assert.equal(session.values.lightBpm,9); assert.equal(session.values.scale,5); session.cancel();
});
test('presets: atomic validation, numeric strings, explicit zero, no corruption overwrite, storage errors', () => {
  const storage=memory(), presets=new Presets(storage);
  const factories=presets.list(); assert.equal(factories.length,4);
  for (const p of factories) {assert.equal(p.data.plant_midi_channel,1); assert.equal(p.data.light_midi_channel,2); assert(p.data.minPlantVelocity>=1); assert(p.data.minLightVelocity>=1);}
  const {session}=connected();
  const invalid=['{','{}','{"commands":[]}','{"commands":[{"name":"unknown","value":1}]}','{"commands":[{"name":"noteDistance","value":101}]}','{"commands":[{"name":"scale","value":3},{"name":"scale","value":4}]}','{"commands":[{"name":"noteDistance","value":null}]}','{"commands":[{"name":"noteDistance","value":""}]}'];
  const before={...session.values}; for (const input of invalid) {assert.throws(()=>session.load(input)); assert.deepEqual(session.values,before);}
  session.load('{"commands":[{"name":"minPlantVelocity","value":0},{"name":"noteDistance","value":"42"}]}');
  assert.equal(session.values.minPlantVelocity,0); assert.equal(session.values.noteDistance,42);
  presets.save('Custom',session.values); assert.equal(presets.list().length,5); assert.equal(presets.list()[4].data.minPlantVelocity,0);
  assert.throws(()=>presets.save(' ',session.values)); assert.equal(presets.list().length,5);
  for (const data of [null,[],{}, {noteDistance:101}, {noteDistance:''}, {noteDistance:21,unknown:1}]) {
    const key=[...storage.data.keys()][0], damaged=JSON.stringify([{name:'Broken',data}]); storage.setItem(key,damaged);
    assert.throws(()=>presets.list()); assert.equal(storage.getItem(key),damaged); assert.throws(()=>presets.save('New',before)); assert.equal(storage.getItem(key),damaged);
  }
  const blocked=new Presets({getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}); assert.throws(()=>blocked.list(),/blocked/); assert.throws(()=>blocked.save('New',before),/blocked/); session.cancel();
});

test('explicit Send writes the complete preset once, tempo last; overlap and reconnect cannot leak writes', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const {session,output}=connected();
  await assert.rejects(session.send(),/Check saved/);assert.deepEqual(output.sent,[]);
  const checking=session.check();await assert.rejects(session.send(),/check to finish/);session.receive(response(session.nonce));await checking;output.sent=[];session.load({...session.values,scale:5});assert.deepEqual(output.sent,[]);
  const sending=session.send();assert.equal(session.sending,true);
  await assert.rejects(session.send(),/Wait/);await assert.rejects(session.edit('scale',6),/Wait/);assert.throws(()=>session.load({scale:6}),/Wait/);
  for (let i=0;i<26;i++) {t.mock.timers.tick(100);await Promise.resolve();}
  await sending;assert.equal(output.sent.length,26);assert.equal(output.sent.at(-1)[3],0);assert.equal(output.sent.filter(frame=>frame[3]===4).length,1);assert.equal(session.sending,false);
  output.sent=[];const interrupted=session.send(), aborted=assert.rejects(interrupted,/changed/);
  const replacement=new Port('replacement','Biotron','output');session.connectionChanged(new Port('new-input','Biotron'),replacement,0);
  t.mock.timers.tick(100);await aborted;assert.equal(output.sent.length,1);assert.deepEqual(replacement.sent,[]);assert.equal(session.sending,false);session.cancel();
});
