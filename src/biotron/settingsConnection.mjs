// Owns the bounded Biotron settings read and the delayed saved-copy check.
export function createSettingsConnectionMethods({BiotronDb, settingsVectorFromCommands,
  settingsVectorsEqual, savedSettingsMessage}) {
  return {
    async initPresetStorage() {
      if (this.presetStoragePending || this.page_is_inited) return
      const initId = ++this.presetInitId
      this.presetStoragePending = true
      this.presetStorageError = ""
      try {
        const patchId = localStorage.getItem(this.id) || "1"
        if (!localStorage.getItem(this.id)) localStorage.setItem(this.id, patchId)
        const db = new BiotronDb()
        await this.settingsRequestWithin(async () => {
          await db.ready
          if (initId !== this.presetInitId) return
          const patches = await db.getPatch()
          if (initId !== this.presetInitId) return
          this.db = db
          this.patches = patches
          this.patch_id = parseInt(patchId)
          await this.loadData(initId)
          if (initId === this.presetInitId) this.page_is_inited = true
        }, 5000)
        if (initId === this.presetInitId && this.page_is_inited && this.betaBuild && this.device) await this.loadPersistedSettings(this.device)
      } catch {
        if (initId === this.presetInitId) this.presetStorageError = "Saved presets could not be opened. Retry; existing presets are kept."
      } finally {
        if (initId === this.presetInitId) {this.presetStoragePending = false; this.presetInitId++}
      }
    },
    markPresetPending() {
      if (!this.betaBuild) return
      this.clearLiveVerification()
      this.lastChangedSetting = "preset"
      this.presetPending = true
      this.settingsState = "changed"
      this.settingsMessage = "Preset loaded in browser. Apply preset to Biotron to hear and save it."
    },
    async readPersistedSettingsWithRetry(device, attempts = 3) {
      let lastError
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (this.device !== device) throw new Error("Biotron changed.")
        try {
          return await this.settingsRequestWithin(() => this.$refs.deviceSelector.requestPersistedSettings(), 3500)
        } catch (error) {
          lastError = error
          if (error?.name === "AbortError") throw error
          if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 450))
        }
      }
      throw lastError
    },
    async settingsRequestWithin(request, timeoutMs) {
      let timeout
      try {
        return await Promise.race([
          Promise.resolve().then(request),
          new Promise((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("Saved settings check timed out.")), timeoutMs)
          })
        ])
      } finally {
        clearTimeout(timeout)
      }
    },
    scheduleLiveVerification(device) {
      this.clearLiveVerification()
      const verifyId = this.liveVerifyId
      this.liveVerifyTimer = setTimeout(async () => {
        this.liveVerifyTimer = null
        if (this.device !== device || verifyId !== this.liveVerifyId) return
        try {
          const expected = settingsVectorFromCommands(this.commands_data)
          const snapshot = await this.readPersistedSettingsWithRetry(device, 2)
          if (this.device !== device || verifyId !== this.liveVerifyId) return
          if (snapshot.dirty || !settingsVectorsEqual(snapshot.values, expected)) {
            throw new Error("Saved settings did not match the controls.")
          }
          this.settingsState = "saved"
          this.settingsMessage = savedSettingsMessage(this.lastChangedSetting)
        } catch (error) {
          if (this.device !== device || verifyId !== this.liveVerifyId) return
          this.settingsState = "error"
          this.settingsMessage = "Changed live. Saved copy could not be confirmed — try Check saved settings."
        }
      }, 1500)
    },
  }
}
