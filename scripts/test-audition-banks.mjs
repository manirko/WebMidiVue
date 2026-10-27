import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import fs from 'node:fs'
import vm from 'node:vm'
import {AUDITION_BANKS, auditionEvents, auditionDuration, resolveAudition} from '../src/audio/auditionBanks.mjs'
import {selectSoundExperiment, restoreSoundExperiment, soundSessionState} from '../src/audio/sessionState.mjs'
import {SOUNDS, toSound} from '../src/audio/elementary/timbres.mjs'

test('six quick choices and sphere effects reuse the session with bounded/resettable real presets', () => {
  const source=fs.readFileSync(new URL('../src/components/SoundLab/AudioCompare.vue',import.meta.url),'utf8').split('<script>')[1].split('</script>')[0]
  const context={AUDITION_BANKS,resolveAudition,soundSessionState,selectSoundExperiment,module:{exports:{}},getSoundController:()=>player}
  const player={variants:SOUNDS,currentVariant:0,chooseVariant(index){this.currentVariant=index;selectSoundExperiment(null,false)}}
  vm.runInNewContext(source.replace(/^import .*$/gm,'').replace('export default','module.exports ='),context)
  const component=context.module.exports, ui={calibrationOnly:false,...component.data()}
  for(const [key,get] of Object.entries(component.computed))Object.defineProperty(ui,key,{get:()=>get.call(ui)})
  for(const [key,fn] of Object.entries(component.methods))ui[key]=fn.bind(ui)
  const previous=soundSessionState.audition
  try {
    assert.equal(ui.palette.length,6)
    const families=new Set()
    for(const choice of ui.palette){
      ui.choose(choice.bankId,choice.id)
      const base=choice.bankId==='classic'?SOUNDS[0]:resolveAudition(choice.bankId,choice.id).variant.preset
      families.add(base.timbre+':'+base.cv.octave)
      ui.adjust(-1,1);const dark=soundSessionState.audition.variant.preset
      ui.adjust(1,1);const bright=soundSessionState.audition.variant.preset
      assert(bright.fx.cutoff>dark.fx.cutoff)
      for(const preset of [dark,bright]){
        assert(Object.values(preset.fx).every(Number.isFinite))
        assert(preset.fx.delayWet<=.35&&preset.fx.reverbWet<=.3&&preset.fx.delayFeedback<=.72)
        assert.deepEqual(preset.cv,base.cv,'effect changed excitation/voices')
      }
      const last=soundSessionState.audition;ui.adjust('not a number',0);assert.equal(soundSessionState.audition,last)
      ui.adjust(0,0);assert.deepEqual(JSON.parse(JSON.stringify(soundSessionState.audition.variant.preset)),JSON.parse(JSON.stringify(base)))
      assert(Array.isArray(soundSessionState.audition.events),'Classic effects lost example phrase')
    }
    assert.equal(families.size,6,'quick palette repeats the same excitation/register pair; listening remains separate')
  } finally { selectSoundExperiment(previous,false) }
})

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
test('native key guard still rejects missing/duplicate/untrusted/cancelled delivery', () => {
  const source=fs.readFileSync(new URL('./test-audition-browser.js',import.meta.url),'utf8')
  const guard=source.match(/  assert\.deepEqual\(controlKeys\.map[^\n]+\n  assert\(controlKeys\.every[^\n]+/)[0]
  const healthy=['ArrowDown','ArrowUp','Enter','Escape','Tab','Space'].map(code=>({code,trusted:true,prevented:false}))
  const replay=rows=>vm.runInNewContext('const controlKeys=JSON.parse('+JSON.stringify(JSON.stringify(rows))+');'+guard,{assert})
  replay(healthy)
  for(const rows of [healthy.slice(0,5),[...healthy.slice(0,5),healthy[0]],healthy.map((row,i)=>i===0?{...row,trusted:false}:row),healthy.map((row,i)=>i===0?{...row,prevented:true}:row)])assert.throws(()=>replay(rows))
  assert(source.indexOf("fs.writeFileSync(path.join(artifacts,'native-control-keys.json')")<source.indexOf(guard),'key evidence must precede the assertion')
})
test('adjusting Classic effects preserves its running example; bank changes still stop', () => {
  const line=fs.readFileSync(new URL('../src/components/SoundLab/SoundLab.vue',import.meta.url),'utf8').split('\n').find(line=>line.trim().startsWith('audition(next, previous)'))
  const watch=vm.runInNewContext('('+line.trim().replace(/^audition/,'function').replace(/,$/,'')+')')
  let stops=0;const player={examplePlaying:true,stop(){stops++}}
  watch.call(player,{bankId:'classic'},null);assert.equal(stops,0)
  watch.call(player,{bankId:'timbres'},{bankId:'classic'});assert.equal(stops,1)
  watch.call(player,{bankId:'timbres'},{bankId:'timbres'});assert.equal(stops,1)
})
test('six distinct timbres and two handpan options with unique audible settings and a reference first', () => {
  // Sergey 2026-10-12: near-identical timbres, all high-note treatments and handpan 2–5 removed.
  assert.deepEqual(AUDITION_BANKS.map(bank => bank.id), ['timbres','handpan'])
  assert.deepEqual(AUDITION_BANKS.map(bank => bank.variants.length), [6,2])
  const ids = AUDITION_BANKS.flatMap(bank => bank.variants.map(option => option.id))
  assert.equal(new Set(ids).size,8)
  for (const bank of AUDITION_BANKS) {
    assert.match(bank.variants[0].label,/reference/i)
    const settings = bank.variants.map(({preset,level}) => digest({timbre:preset.timbre,cv:preset.cv,fx:preset.fx,registers:preset.registers,level}))
    assert.equal(new Set(settings).size,bank.variants.length,`${bank.id} has duplicated settings`)
    for (const option of bank.variants) {
      const sounds=[option.preset,...Object.values(option.preset.registers || {}).map(register=>register.voice).filter(Boolean)]
      for (const sound of sounds) {
        assert(sound.cv.release<=3)
        assert(sound.fx.delayFeedback<=.72 && sound.fx.delayWet<=.35 && sound.fx.reverbWet<=.3)
        assert(Object.values(sound.cv).every(Number.isFinite))
      }
      if (option.level!==undefined) assert(option.level>0 && option.level<=1)
    }
  }
  assert.deepEqual(AUDITION_BANKS[0].variants[0].preset.cv,SOUNDS[0].cv)
})
test('bank events pair every On with Off', () => {
  for(const bank of AUDITION_BANKS){
    const events=auditionEvents(bank.id),active=new Set()
    for(const event of events){
      if(event.type==='on'){assert(!active.has(event.note));active.add(event.note)}else{assert(active.has(event.note));active.delete(event.note)}
    }
    assert.equal(active.size,0)
    assert(auditionDuration(bank.id)>events.at(-1).at)
  }
})
test('register treatments stay validated though no bank offers them now', () => {
  for(const upper of [{startNote:84,endNote:72},{startNote:-1,endNote:84},{startNote:72,endNote:84,gain:2},{startNote:72,endNote:84,cutoff:Infinity}]){
    assert.throws(()=>toSound({...SOUNDS[0],registers:{upper}}),TypeError)
  }
  const treated=toSound({...SOUNDS[0],registers:{upper:{startNote:72,endNote:84,gain:.75}}})
  assert.throws(()=>toSound({...SOUNDS[0],registers:{upper:{startNote:72,endNote:84,voice:treated}}}),/Nested/)
})

test('two handpan roles use the native modal voice and a short plant gate; stock sounds stay unchanged', () => {
  const bank=AUDITION_BANKS.find(bank=>bank.id==='handpan')
  assert.deepEqual(bank.variants.map(option=>option.role),['01-clear','06-bold'])
  assert.deepEqual(SOUNDS.map(sound=>sound.timbre),['round','round','fat','fat','string','string','noise'])
  for(const {preset} of bank.variants){
    assert.equal(preset.timbre,'pan')
    assert(preset.cv.attack>=.001&&preset.cv.attack<=.015)
    assert(preset.cv.decay>=.5&&preset.cv.decay<=3&&preset.cv.release>=.5&&preset.cv.release<=3)
    assert(preset.cv.strike>=0&&preset.cv.strike<=.2&&preset.cv.detune>=0&&preset.cv.detune<=4)
    assert(preset.cv.octaveLevel>=.1&&preset.cv.octaveLevel<=.7&&preset.cv.fifthLevel>=.05&&preset.cv.fifthLevel<=.55)
  }
  const events=auditionEvents('handpan')
  for(let i=0;i<events.length;i+=2)assert(Math.abs(events[i+1].at-events[i].at-.027)<1e-6)
})


test('a selected sound survives reopening; only known bank/variant IDs can restore a preset', () => {
  const storage = new Map()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const key = 'biotron-sound-experiment-v1'
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)
  }})
  try {
    assert(selectSoundExperiment(resolveAudition('handpan', 'pan-bold')))
    assert.deepEqual(JSON.parse(storage.get(key)), {bankId: 'handpan', variantId: 'pan-bold'})
    soundSessionState.audition = null // A fresh page, with browser storage retained.
    assert.equal(restoreSoundExperiment(resolveAudition).variant.preset.timbre, 'pan')
    for (const saved of ['broken JSON', '{"bankId":"unknown","variantId":"pan-bold"}', '{"bankId":"handpan","variantId":"tone-bass"}']) {
      soundSessionState.audition = null; storage.set(key, saved)
      assert.equal(restoreSoundExperiment(resolveAudition), null)
    }
    storage.set(key, JSON.stringify({bankId: 'handpan', variantId: 'pan-bold', preset: {cv: {release: Infinity}}}))
    assert.equal(restoreSoundExperiment(resolveAudition).variant.preset.cv.release, resolveAudition('handpan', 'pan-bold').variant.preset.cv.release)
    selectSoundExperiment(null)
    assert.equal(storage.has(key), false, 'Choosing a stock sound must clear the experiment')
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw new Error('Storage denied') }})
    assert.equal(selectSoundExperiment(resolveAudition('timbres', 'tone-bass')), false)
    assert.equal(soundSessionState.audition.variant.id, 'tone-bass', 'Storage denial must not discard the live sound')
  } finally {
    soundSessionState.audition = null
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  }
})
