// Shared across Settings and the persistent Play view. A hidden firmware modal
// still owns its operation; an app reload must not interrupt it.
const firmwareOperations = new Set()
export function setFirmwareUpdateBusy(owner, busy) {
  if (busy) firmwareOperations.add(owner)
  else firmwareOperations.delete(owner)
}
export const canReloadApp = () => firmwareOperations.size === 0
