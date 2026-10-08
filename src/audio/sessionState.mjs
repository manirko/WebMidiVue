import {reactive, shallowRef} from 'vue'
import {DEFAULT_VOLUME} from './core.mjs'
export const soundSessionState = reactive({running: false, volume: DEFAULT_VOLUME, calibrating: false, audition: null})
const controller = shallowRef(null)
const experimentKey = 'biotron-sound-experiment-v1'
export const getSoundController = () => controller.value
export function registerSoundController(nextController) {
  controller.value = nextController
}

export function unregisterSoundController(currentController) {
  if (controller.value === currentController) controller.value = null
}

export function selectSoundExperiment(selection, persist = true) {
  soundSessionState.audition = selection
  if (!persist) return true
  try {
    if (selection) localStorage.setItem(experimentKey, JSON.stringify({bankId: selection.bankId, variantId: selection.variant.id}))
    else localStorage.removeItem(experimentKey)
    return true
  } catch { return false }
}

export function restoreSoundExperiment(resolve) {
  if (soundSessionState.audition) return soundSessionState.audition
  try {
    const saved = JSON.parse(localStorage.getItem(experimentKey) || 'null')
    const selection = saved && resolve(saved.bankId, saved.variantId)
    if (selection) selectSoundExperiment(selection, false)
  } catch { /* A missing or invalid local choice leaves the ordinary sound. */ }
  return soundSessionState.audition
}

export function updateSoundSession(patch) {
  Object.assign(soundSessionState, patch)
}

export async function stopPersistentSound() {
  const current = controller.value
  if (!current) {
    updateSoundSession({running: false})
    return true
  }
  await current.stop()
  return !current.releaseBlocked
}
