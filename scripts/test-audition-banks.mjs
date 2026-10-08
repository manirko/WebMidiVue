import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {AUDITION_BANKS, auditionEvents, auditionDuration} from '../src/audio/auditionBanks.mjs'
import {SOUNDS, toSound} from '../src/audio/elementary/timbres.mjs'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
test('three independent ten-option banks with unique audible settings and a reference first', () => {
  assert.deepEqual(AUDITION_BANKS.map(bank => bank.variants.length), [10,10,10])
  const ids = AUDITION_BANKS.flatMap(bank => bank.variants.map(option => option.id))
  assert.equal(new Set(ids).size,30)
  for (const bank of AUDITION_BANKS) {
    assert.match(bank.variants[0].label,/reference/i)
    const settings = bank.variants.map(({preset,level}) => digest({timbre:preset.timbre,cv:preset.cv,fx:preset.fx,registers:preset.registers,level}))
    assert.equal(new Set(settings).size,10,`${bank.id} has duplicated settings`)
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
