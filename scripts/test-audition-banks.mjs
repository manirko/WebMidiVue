import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {AUDITION_BANKS, auditionEvents, auditionDuration, resolveAudition} from '../src/audio/auditionBanks.mjs'
import {selectSoundExperiment, restoreSoundExperiment, soundSessionState} from '../src/audio/sessionState.mjs'
import {SOUNDS, toSound} from '../src/audio/elementary/timbres.mjs'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
test('three ten-option banks and six handpan options with unique audible settings and a reference first', () => {
  assert.deepEqual(AUDITION_BANKS.map(bank => bank.variants.length), [10,10,10,6])
  const ids = AUDITION_BANKS.flatMap(bank => bank.variants.map(option => option.id))
  assert.equal(new Set(ids).size,36)
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
test('calibration uses exact firmware cue and velocity; bank events pair every On with Off', () => {
  // Source-pinned firmware fixture: manirko/biotron-firmware@2ae1973 src/global.c:38–49.
  const firmwareCue=[[3,64,3],[8,65,3],[13,67,4],[18,72,4],[24,71,3],[29,67,3],[34,62,4],[40,60,9]]
  const velocity=24
  const cueOn=auditionEvents('calibration').filter(event=>event.type==='on')
  assert.deepEqual(cueOn.map(event=>[Math.round(event.at*10),event.note]),firmwareCue.map(([tick,note])=>[tick,note]))
  assert(cueOn.every(event=>event.velocity===velocity))
  for(const bank of AUDITION_BANKS){
    const events=auditionEvents(bank.id),active=new Set()
    for(const event of events){
      if(event.type==='on'){assert(!active.has(event.note));active.add(event.note)}else{assert(active.has(event.note));active.delete(event.note)}
    }
    assert.equal(active.size,0)
    assert(auditionDuration(bank.id)>events.at(-1).at)
  }
})
test('upper treatments start above the middle register; only declared three-register experiment changes bass', () => {
  const bank=AUDITION_BANKS[2]
  assert.equal(bank.variants[0].preset.registers,undefined)
  for(const option of bank.variants.slice(1)){
    assert.deepEqual(option.preset.cv,SOUNDS[0].cv)
    assert.deepEqual(option.preset.fx,SOUNDS[0].fx)
    assert.equal(option.preset.registers.upper.startNote,72)
    assert.equal(option.preset.registers.upper.endNote,84)
    assert.equal(Boolean(option.preset.registers.lower),option.id==='high-three')
  }
  for(const upper of [{startNote:84,endNote:72},{startNote:-1,endNote:84},{startNote:72,endNote:84,gain:2},{startNote:72,endNote:84,cutoff:Infinity}]){
    assert.throws(()=>toSound({...SOUNDS[0],registers:{upper}}),TypeError)
  }
  assert.throws(()=>toSound({...SOUNDS[0],registers:{upper:{startNote:72,endNote:84,voice:bank.variants[1].preset}}}),/Nested/)
})

test('six handpan roles use the native modal voice and a short plant gate; stock sounds stay unchanged', () => {
  const bank=AUDITION_BANKS.find(bank=>bank.id==='handpan')
  assert.deepEqual(bank.variants.map(option=>option.role),['01-clear','02-soft','03-breath','04-expressive','05-space','06-bold'])
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
