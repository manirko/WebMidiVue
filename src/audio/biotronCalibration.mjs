const CUE = Object.freeze([64, 65, 67, 72, 71, 67, 62, 60])
const VELOCITIES = Object.freeze([
  Object.freeze([24, 24, 24, 24, 24, 24, 24, 24]),
  Object.freeze([64, 64, 64, 64, 64, 64, 64, 64]),
  Object.freeze([22, 24, 26, 28, 26, 24, 22, 18])
])
export const BIOTRON_CALIBRATION = Object.freeze({
  cue: CUE, cueVelocityProfiles: VELOCITIES,
  legacyNotes: Object.freeze([91, 92]), legacyVelocity: 90,
  detectionNotes: 4, maxAlternationGapMs: 700, quietCompletionMs: 1100,
  localLevel: 0.14, lightChannel: 2, lightLevel: 0.08
})

const matchesCue = (message, index, contract, profiles = contract.cueVelocityProfiles) =>
  contract.cue[index] === message.note && profiles.some(profile => profile[index] === message.velocity)

export function parseBiotronCalibrationState(message) {
  const data = message?.type === 'system-exclusive' ? message.data : null
  if (!Array.isArray(data) || data.length !== 6 || data[0] !== 0xf0 || data[1] !== 0x0b ||
      data[2] !== 125 || data[5] !== 0xf7 || data[4] < 1 || data[4] > 3) return null
  return {nonce: data[3] & 0x7f, state: ['waiting', 'measuring', 'ready'][data[4] - 1]}
}

// Only the firmware's explicit calibration state (125) makes notes quiet. Guessing the cue
// by pitch and velocity muted real plant notes (64 @ velocity 64 matched a profile, 2026-09-03).
export function biotronVoiceLevel(message, contract = BIOTRON_CALIBRATION, calibrating = false) {
  if (message?.type !== 'note-on') return 1
  if (calibrating) return contract.localLevel
  return message.channel === contract.lightChannel ? contract.lightLevel : 1
}

export class BiotronCalibrationTracker {
  constructor(contract = BIOTRON_CALIBRATION) { this.contract = contract; this.reset() }
  reset() {
    this.lastNote = this.lastAt = null
    this.alternations = this.cueIndex = 0
    this.cueProfiles = this.contract.cueVelocityProfiles.slice()
    this.calibrating = false
  }
  observe(message, at = 0) {
    if (message?.type === 'controller' && message.controller === 90) { this.reset(); return 'activity' }
    if (message?.type !== 'note-on') return 'ignored'
    const cue = matchesCue(message, this.cueIndex, this.contract, this.cueProfiles)
    const legacy = this.contract.legacyNotes.includes(message.note) && message.velocity === this.contract.legacyVelocity
    if (!cue && !legacy) { this.reset(); return 'activity' }
    const timestamp = Number.isFinite(Number(at)) ? Number(at) : 0
    const follows = this.lastAt !== null && timestamp >= this.lastAt &&
      timestamp - this.lastAt <= this.contract.maxAlternationGapMs
    if (cue) {
      this.cueProfiles = this.cueProfiles.filter(profile => profile[this.cueIndex] === message.velocity)
      this.alternations = follows ? ++this.cueIndex : (this.cueIndex = 1)
    } else {
      this.cueIndex = 0
      this.alternations = this.lastNote !== null && message.note !== this.lastNote && follows ?
        this.alternations + 1 : 1
    }
    this.lastNote = message.note; this.lastAt = timestamp
    this.calibrating = this.alternations >= this.contract.detectionNotes
    return this.calibrating ? 'calibrating' : 'candidate'
  }
}
