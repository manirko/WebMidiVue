// The ordinary production build must not install a service worker. The Biotron
// beta build aliases this module name to its PWA runtime.
export const OFFLINE_STATUS_EVENT = 'playtronica-offline-status-disabled'
export const APP_UPDATE_EVENT = 'playtronica-app-update-disabled'
export const getAppUpdateStatus = () => ({available: false, updating: false, reloadRequired: false, error: ''})
export const requestAppUpdate = async () => getAppUpdateStatus()
export const getOfflineStatus = () => ({state: 'disabled', code: 'PWA_DISABLED', ready: false})
export const prepareOfflineAccess = async () => getOfflineStatus()
