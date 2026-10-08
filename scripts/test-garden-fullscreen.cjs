const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('src/components/SoundLab/GardenVisual.vue','utf8').split('<script>')[1].split('</script>')[0].replace('export default','module.exports=');
const document={body:{style:{overflow:'auto'}},addEventListener(){},removeEventListener(){},exitFullscreen(){throw Error('Native fullscreen must not be invoked')}};
const context={module:{exports:{}},document,window:{addEventListener(){},removeEventListener(){}}};vm.runInNewContext(source,context);const component=context.module.exports;
function fixture(){const target={...component.data(),$refs:{visual:{requestFullscreen(){throw Error('Native fullscreen must not be invoked')}},expand:{focus(){}}},$nextTick:fn=>fn()};for(const [key,fn] of Object.entries(component.methods))target[key]=fn.bind(target);return target}
let t=fixture();for(let i=0;i<10;i++){t.toggleFullscreen();assert.equal(t.expanded,true);assert.equal(document.body.style.overflow,'hidden');t.closeFullscreen();assert.equal(t.expanded,false);assert.equal(document.body.style.overflow,'auto')}
t=fixture();component.mounted.call(t);t.toggleFullscreen();let prevented=false;t.keyListener({key:'Escape',preventDefault(){prevented=true}});assert(prevented);assert.equal(t.expanded,false);
t.toggleFullscreen();component.beforeUnmount.call(t);assert.equal(t.expanded,false);assert.equal(document.body.style.overflow,'auto');
console.log('PASS: immediate close, repeated open/close, Escape, unmount and scroll restoration without native fullscreen promises');

// Run the actual scene's MIDI handler: repeated notes must not push all cells
// toward one hemisphere. The original uniform velocity/bulge code fails this.
const scene=fs.readFileSync('public/garden/scene.html','utf8');
const start=scene.lastIndexOf("addEventListener('message', e => {");
assert(start>=0);
const end=scene.indexOf('\n});',start)+4;
let receive,bulges=0,colours=0;
const velocity=new Float32Array(12);
const sceneContext={parent:{},location:{origin:'https://fixture'},demoState:'ready',motionPaused:false,motionQuery:{matches:false},V:velocity,N_BLOBS:4,firstFrame:false,activityUntil:0,
  performance:{now:()=>100},setPitchColour(){colours++},updateCellColours(){},spawnBulge(){bulges++},renderFrame(){},addEventListener(type,handler){receive=handler}};
vm.runInNewContext(scene.slice(start,end),sceneContext);
for(let i=0;i<100;i++)receive({source:sceneContext.parent,origin:sceneContext.location.origin,data:{type:'biotron-preview',noteOn:true,pitch:48+i%36}});
assert.equal(colours,100);assert.equal(bulges,0);assert.deepEqual([...velocity],Array(12).fill(0));
receive({source:{},origin:sceneContext.location.origin,data:{type:'biotron-preview',noteOn:true,pitch:60}});
assert.equal(colours,100,'untrusted sender animated the scene');
console.log('PASS: repeated MIDI notes update the palette without a directional push; sender guard retained');
