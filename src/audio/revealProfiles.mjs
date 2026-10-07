const requiredCopy = [
  'id', 'productName', 'eyebrow', 'title', 'promise', 'introHeading', 'introInstruction',
  'startLabel', 'settlingHeading', 'settlingInstruction', 'settlingStatus',
  'calibratingHeading', 'calibratingInstruction', 'calibratingStatus',
  'readyHeading', 'readyInstruction', 'revealedHeading', 'explanation',
  'readyStatus', 'settingsRoute'
]

export function validateRevealProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new TypeError('Reveal profile is required.')
  for (const field of requiredCopy) {
    if (typeof profile[field] !== 'string' || !profile[field].trim()) {
      throw new TypeError(`Reveal profile ${profile.id || '<unknown>'}.${field} is required.`)
    }
  }
  if (!Array.isArray(profile.inputNameTokens) || !profile.inputNameTokens.length) {
    throw new TypeError(`Reveal profile ${profile.id || '<unknown>'}.inputNameTokens is required.`)
  }
  if (!Array.isArray(profile.preferredInputTokens)) {
    throw new TypeError(`Reveal profile ${profile.id || '<unknown>'}.preferredInputTokens must be an array.`)
  }
  return profile
}

const biotron = validateRevealProfile(Object.freeze({
  id: 'biotron',
  productName: 'Biotron',
  inputNameTokens: Object.freeze(['biotron']),
  preferredInputTokens: Object.freeze(['port 1', 'midi 1']),
  secondaryInputTokens: Object.freeze(['midiin', 'port 2', 'midi 2']),
  eyebrow: 'Play · beta',
  title: 'Plant music',
  promise: 'It turns tiny electrical changes through a plant into music.',
  introHeading: 'Connect a plant',
  introInstruction: 'Clip both contacts to separate points on the same plant and connect the device by USB.',
  startLabel: 'Start listening',
  settlingHeading: 'Waiting for the device',
  settlingInstruction: 'Step away from the computer, device and plant. Keep them still during calibration.',
  settlingStatus: 'Waiting for the plant signal — keep still',
  calibratingHeading: 'Calibrating',
  calibratingInstruction: 'Keep the plant, cables and device still. Wait for the device to confirm it is ready.',
  calibratingStatus: 'Calibrating — keep the plant, cables and device still',
  readyHeading: 'Ready to play',
  readyInstruction: 'Touch a leaf. Listen for a note and watch the colours change.',
  revealedHeading: 'Notes are arriving',
  explanation: 'Touch the plant and listen for a change. The colours follow the pitch of incoming notes.',
  readyStatus: 'Waiting for a note',
  settingsRoute: '/biotron'
}))

export const REVEAL_PROFILES = Object.freeze({biotron})

export function getRevealProfile(id) {
  const profile = REVEAL_PROFILES[id]
  if (!profile) throw new Error(`Unknown reveal profile: ${id || '<empty>'}`)
  return profile
}

const inputText = input => [input?.manufacturer, input?.name]
  .filter(Boolean).join(' ').toLowerCase()

export function selectRevealInput(inputs, profile) {
  validateRevealProfile(profile)
  const hasToken = (input, tokens) => tokens.some(token => inputText(input).includes(token.toLowerCase()))
  const candidates = inputs.filter(input => hasToken(input, profile.inputNameTokens))
  if (candidates.length === 1) return candidates[0]
  const preferred = candidates.filter(input => hasToken(input, profile.preferredInputTokens))
  if (preferred.length === 1) return preferred[0]
  // One unit's second cable (Windows: 'MIDIIN2 (Biotron)'; Mac: 'Port 2') is not a second unit.
  const primary = candidates.filter(input => !hasToken(input, profile.secondaryInputTokens || []))
  if (candidates.length > 1 && primary.length === 1) return primary[0]
  // Android names both cables of one unit alike ('Biotron', 'Biotron'): the first port is cable 0, the plant music.
  if (candidates.length === 2 && !preferred.length && inputText(candidates[0]) === inputText(candidates[1])) return candidates[0]
  if (!candidates.length) {
    throw new Error(`${profile.productName} was not found. Check the USB data cable, then try again.`)
  }
  throw new Error(`More than one ${profile.productName} music input was found. Connect one ${profile.productName}, then try again.`)
}
