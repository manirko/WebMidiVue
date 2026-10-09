const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('src/components/SoundLab/GardenVisual.vue','utf8').split('<script>')[1].split('</script>')[0].replace('export default','module.exports=');
const document={body:{style:{overflow:'auto'}},addEventListener(){},removeEventListener(){},exitFullscreen(){throw Error('Native fullscreen must not be invoked')}};
const context={module:{exports:{}},document,window:{addEventListener(){},removeEventListener(){}}};vm.runInNewContext(source,context);const component=context.module.exports;
function fixture(){const target={...component.data(),$refs:{visual:{requestFullscreen(){throw Error('Native fullscreen must not be invoked')}},expand:{focus(){}}},$nextTick:fn=>fn()};for(const [key,fn] of Object.entries(component.methods))target[key]=fn.bind(target);return target}
let t=fixture();for(let i=0;i<10;i++){t.toggleFullscreen();assert.equal(t.expanded,true);assert.equal(document.body.style.overflow,'hidden');t.closeFullscreen();assert.equal(t.expanded,false);assert.equal(document.body.style.overflow,'auto')}
t=fixture();component.mounted.call(t);t.toggleFullscreen();let prevented=false;t.keyListener({key:'Escape',preventDefault(){prevented=true}});assert(prevented);assert.equal(t.expanded,false);
t.toggleFullscreen();component.beforeUnmount.call(t);assert.equal(t.expanded,false);assert.equal(document.body.style.overflow,'auto');
console.log('PASS: immediate close, repeated open/close, Escape, unmount and scroll restoration without native fullscreen promises');

// Execute the actual scene handler and physics, without a GPU. This proves
// bounded energy and settling; visual acceptance remains a real-browser task.
const scene=fs.readFileSync(process.argv[2] || 'public/garden/scene.html','utf8');
const start=scene.lastIndexOf("addEventListener('message', e => {");
assert(start>=0);
const end=scene.indexOf('\n});',start)+4;
let receive,bulges=0,colours=0;
const velocity=new Float32Array(12);
const sceneContext={parent:{},location:{origin:'https://fixture'},demoState:'ready',motionPaused:false,motionQuery:{matches:false},V:velocity,N_BLOBS:4,firstFrame:false,activityUntil:0,
  performance:{now:()=>100},setPitchColour(){colours++},updateCellColours(){},spawnBulge(){bulges++},renderFrame(){},addEventListener(type,handler){receive=handler}};
vm.runInNewContext(scene.slice(start,end),sceneContext);
const note = pitch => receive({source:sceneContext.parent,origin:sceneContext.location.origin,data:{type:'biotron-preview',noteOn:true,pitch}});
for(let i=0;i<100;i++)note(48+i%36);
assert.equal(colours,100);assert.equal(bulges,0);
assert([...velocity].every((v,i)=>i%3===1 ? v>0 && v<=0.650001 : v===0), 'MIDI burst accumulated unbounded lift');
velocity.fill(0);sceneContext.motionPaused=true;note(60);
assert.deepEqual([...velocity],Array(12).fill(0),'reduced motion received a physical impulse');
receive({source:{},origin:sceneContext.location.origin,data:{type:'biotron-preview',noteOn:true,pitch:60}});
assert.equal(colours,101,'untrusted sender animated the scene');

const physicsStart=scene.indexOf('function step(dt) {');
const physicsEnd=scene.indexOf('\n}',physicsStart)+2;
const P=new Float32Array([-.4,-.6,0, .4,-.6,0, 0,-.6,.4, 0,-.6,-.4]);
Object.assign(sceneContext,{P,Pp:new Float32Array(12),R:new Float32Array(4).fill(.1),
  touch:new Uint8Array(4),wallPrev:new Uint8Array(4),rushCd:new Float32Array(4),rushPow:new Float32Array(4),
  SHELL_R:1.3,prm:{damp:.9,gravity:1.65,friction:3.91},playHit(){},
  _m:{makeScale(){},setPosition(){}},blobs:{setMatrixAt(){},instanceMatrix:{}}});
vm.runInNewContext(scene.slice(physicsStart,physicsEnd),sceneContext);
sceneContext.motionPaused=false;
const meanY=()=>[1,4,7,10].reduce((sum,i)=>sum+P[i],0)/4;
const initialY=meanY();
for(let frame=0;frame<600;frame++){
  if(frame%6===0)note(60);
  sceneContext.step(.37/60);
}
const playingY=meanY();
assert(playingY>initialY+.2,'cells no longer rise while playing');
for(let frame=0;frame<600;frame++)sceneContext.step(.37/60);
const restingY=meanY();
assert(restingY<playingY-.5,'idle cells did not settle back down');
assert([...P,...velocity].every(Number.isFinite),'non-finite physics');
console.log(`PASS: capped MIDI lift, reduced-motion/sender guards; mean Y ${initialY.toFixed(2)} -> playing ${playingY.toFixed(2)} -> resting ${restingY.toFixed(2)}; no idle up-blast`);

// Exercise actual contact detection and elastic envelopes: an old weak-contact
// scene must fail, while repeated music/strong pointer impacts stay bounded.
const parameters=scene.slice(scene.indexOf('const prm = {')+'const prm = '.length,scene.indexOf('\n};',scene.indexOf('const prm = {'))+2);
const pressureContext={...sceneContext,prm:vm.runInNewContext('('+parameters+')'),N_BLOBS:1,
 P:new Float32Array(3),Pp:new Float32Array(3),V:new Float32Array(3),R:new Float32Array([.2]),
 touch:new Uint8Array(1),wallPrev:new Uint8Array(1),rushCd:new Float32Array(1),rushPow:new Float32Array(1),
 N_BULGE:8,bulgeA:new Float32Array(8),bulgeAge:new Float32Array(8),
 bulgeVecs:Array.from({length:8},()=>({x:0,y:1,z:0,w:0,set(x,y,z,w){Object.assign(this,{x,y,z,w})}})),
 shell:{quaternion:{}},_bq:{copy(){return this},invert(){return this}},
 _bv:{set(x,y,z){Object.assign(this,{x,y,z});return this},applyQuaternion(){return this}}};
for(const name of ['spawnBulge','updateBulges','step']) {
 const begin=scene.indexOf('function '+name+'('),finish=scene.indexOf('\n}',begin)+2;
 vm.runInNewContext(scene.slice(begin,finish),pressureContext);
}
function pressureAt(speed) {
 pressureContext.P.set([0,1.3-.04-.2-.001,0]);pressureContext.V.set([0,speed,0]);
 pressureContext.wallPrev.fill(0);pressureContext.bulgeA.fill(0);pressureContext.bulgeAge.fill(0);
 pressureContext.step(.01);
 pressureContext.updateBulges(.15);
 return Math.max(...pressureContext.bulgeVecs.map(v=>v.w));
}
const gentlePressure=pressureAt(.3),playingPressure=pressureAt(.6),strongPressure=pressureAt(4.5);
assert(gentlePressure>.04,'gentle playing contact did not stretch the shell');
assert(playingPressure>.12,'normal playing pressure is still visually too weak');
assert(strongPressure<=.32,'strong contact escaped the deformation bound');
pressureContext.updateBulges(12);
assert(Math.max(...pressureContext.bulgeVecs.map(v=>Math.abs(v.w)))<1e-8,'shell did not return to its resting shape');
assert([...pressureContext.P,...pressureContext.V,...pressureContext.bulgeA,...pressureContext.bulgeAge].every(Number.isFinite));
console.log(`PASS: real contact/envelope pressure gentle=${gentlePressure.toFixed(4)}, playing=${playingPressure.toFixed(4)}, strong=${strongPressure.toFixed(4)}; bounded and relaxed to rest`);

// Run the actual draw function: connecting must rotate before any notes arrive,
// without running the music physics. Inactive/reduced-motion views must stop.
const drawStart=scene.indexOf('function renderFrame() {');
const drawEnd=scene.indexOf('\n}',drawStart)+2;
function drawFixture(state,paused=false) {
  const stats={steps:0,bulges:0,draws:0};
  const position={set(){return this},addScaledVector(){return this},copy(){return this},multiplyScalar(){return this}};
  const draw={document:{hidden:false,getElementById:()=>({hidden:false})},performance:{now:()=>100},
    demoState:state,motionPaused:paused,firstFrame:true,announced:true,activityUntil:0,manualUntil:0,manualDrag:false,
    calibrationMix:0,calibrationTime:0,timer:{update(){},getDelta:()=>1/30},prm:{simSpeed:.37,rotY:.7,scanSpeed:.1},
    step(){stats.steps++},updateBulges(){stats.bulges++},updateCellColours(){},shell:{rotation:{x:0,y:0}},
    window:{__scanU:{uScan:{value:0}}},camera:{getWorldDirection(){},quaternion:{},matrixWorld:{extractBasis(){}}},
    glow:{position,quaternion:{copy(){}}},shadow:{position,quaternion:{copy(){}}},
    controls:{update(){}},pipeline:{render(){stats.draws++}},_back:{},_bx:{},_by:{},_bz:{},
    N_BLOBS:0,blobs:{instanceMatrix:{}},parent:{postMessage(){}},location:{origin:'https://fixture'}};
  vm.runInNewContext(scene.slice(drawStart,drawEnd),draw);
  return {draw,stats};
}
let draw=drawFixture('connecting');draw.draw.renderFrame();
assert(draw.draw.shell.rotation.y>0,'connecting sphere stayed frozen');
assert.equal(draw.stats.steps,0,'connecting ran music physics');
assert.equal(draw.stats.bulges,0,'connecting pretended to receive notes');
for(const state of ['waiting','attention','paused']) {
  draw=drawFixture(state);draw.draw.renderFrame();draw.draw.renderFrame();
  assert.equal(draw.draw.shell.rotation.y,0,`${state} continued spinning`);
  assert.equal(draw.stats.steps,0,`${state} continued music physics`);
  assert.equal(draw.stats.draws,1,`${state} kept repainting without interaction`);
}
for(const state of ['connecting','calibrating','ready']) {
  draw=drawFixture(state,true);draw.draw.renderFrame();draw.draw.renderFrame();
  assert.equal(draw.draw.shell.rotation.y,0,`${state} ignored reduced motion`);
  assert.equal(draw.stats.steps,0,`${state} ran reduced-motion physics`);
}
draw=drawFixture('ready');draw.draw.renderFrame();assert.equal(draw.stats.steps,1,'ready lost music physics');
console.log('PASS: immediate connecting rotation without music physics; inactive/reduced-motion views remain still');

// Derive presentation from the existing live state; never mutate session data.
const labSource=fs.readFileSync('src/components/SoundLab/SoundLab.vue','utf8');
const stateMethod=labSource.match(/visualStage\(\) \{([\s\S]*?)\n    \},/);
assert(stateMethod,'Play is not wired to the visual state');
const visualStage=vm.runInNewContext('(function(){'+stateMethod[1]+'})');
const cases=[
  [{},'waiting'],[{starting:true},'connecting'],[{revealStage:'settling',engine:{},audioState:'running'},'connecting'],
  [{revealStage:'calibrating',engine:{},audioState:'running'},'calibrating'],
  [{revealStage:'revealed',engine:{},audioState:'running'},'ready'],
  [{keyboardOn:true,engine:{},audioState:'running'},'ready'],
  [{revealStage:'settling',engine:{},audioState:'suspended'},'paused'],
  [{revealStage:'revealed',starting:true,engine:{},audioState:'running'},'paused'],
  [{starting:true,revealIssue:{title:'Connection lost'}},'attention'],
  [{releaseBlocked:true},'attention'],[{audioState:'error'},'attention']
];
for(const [changes,expected] of cases) {
  const session=Object.freeze({revealStage:'intro',audioState:'closed',...changes});
  assert.equal(visualStage.call(session),expected);
  const delivered=[];
  component.methods.sync.call({stage:expected,send:value=>delivered.push(value)});
  assert.equal(delivered[0].state,expected,'scene received a different presentation state');
}
console.log('PASS:11 existing session-state combinations derive presentation only; scene receives the same state');
