const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('src/components/SoundLab/GardenVisual.vue','utf8').split('<script>')[1].split('</script>')[0].replace('export default','module.exports=');
const document={body:{style:{overflow:'auto'}},addEventListener(){},removeEventListener(){},exitFullscreen(){throw Error('Native fullscreen must not be invoked')}};
const context={module:{exports:{}},document,window:{addEventListener(){},removeEventListener(){}}};vm.runInNewContext(source,context);const component=context.module.exports;
function fixture(){const target={...component.data(),$refs:{visual:{requestFullscreen(){throw Error('Native fullscreen must not be invoked')}},expand:{focus(){}}},$nextTick:fn=>fn()};for(const [key,fn] of Object.entries(component.methods))target[key]=fn.bind(target);return target}
let t=fixture();for(let i=0;i<10;i++){t.toggleFullscreen();assert.equal(t.expanded,true);assert.equal(document.body.style.overflow,'hidden');t.closeFullscreen();assert.equal(t.expanded,false);assert.equal(document.body.style.overflow,'auto')}
t=fixture();component.mounted.call(t);t.toggleFullscreen();let prevented=false;t.keyListener({key:'Escape',preventDefault(){prevented=true}});assert(prevented);assert.equal(t.expanded,false);
t.toggleFullscreen();component.beforeUnmount.call(t);assert.equal(t.expanded,false);assert.equal(document.body.style.overflow,'auto');
console.log('PASS: immediate close, repeated open/close, Escape, unmount and scroll restoration without native fullscreen promises');
