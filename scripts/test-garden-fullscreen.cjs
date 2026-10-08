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
const scene=fs.readFileSync('public/garden/scene.html','utf8');
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
