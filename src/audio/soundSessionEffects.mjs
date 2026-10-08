import {markRaw} from 'vue'
// Sound-session effects used by the Play view. Vue owns rendering; this owns
// recovery and Biotron calibration timeouts for the live session.
export function createSoundSessionEffects({resumeAudioWithin, trace, updateSoundSession, parseBiotronCalibrationState,
  MIDI_PROMPT_HINT, selectRevealInput, recordBiotronEvent, soundCapabilityMessage}) {
  return {
    async connectMidi() {
      if (this.starting) return
      if (!this.capabilities.audio || !this.capabilities.midi) {
        this.status = soundCapabilityMessage(this.capabilities, {requiresMidi: true})
        return
      }
      const attemptId = ++this.permissionAttemptId
      this.starting = true
      try {
        if (!await this.acquireTabLease()) return
        if (attemptId !== this.permissionAttemptId) return
        await this.ensureEngine()
        if (attemptId !== this.permissionAttemptId) return
        if (!this.midiInputs.length) {
          const inputs = await this.requestMidiPermission()
          if (attemptId !== this.permissionAttemptId) return
          this.midiInputs = inputs
          this.selectedInput = inputs[0]?.id || ''
          if (!this.selectedInput) throw new Error('No MIDI inputs found.')
        }
        this.midiOpening = true
        await this.midi.connect(this.selectedInput)
      } catch (error) {
        if (attemptId === this.permissionAttemptId && error?.name !== 'AbortError') this.status = error.message
      } finally {
        if (attemptId === this.permissionAttemptId) {
          this.midiOpening = false
          this.starting = false
        }
      }
    },
    async startReveal() {
      if (this.examplePlaying) await this.stop()
      if (this.releaseBlocked) return
      if (this.starting) return
      recordBiotronEvent('play.attempted')
      if (!this.canStartReveal) {
        this.status = soundCapabilityMessage(this.capabilities, {requiresMidi: true})
        return
      }
      const attemptId = ++this.permissionAttemptId
      this.starting = true
      this.revealIssue = null
      this.firstSoundOutcome = ''
      this.resumeOutcome = 'not_attempted'
      let failure = ''
      try {
        if (!await this.acquireTabLease()) { Object.assign(this, {revealIssue: {title: 'Sound is open elsewhere', body: 'Close or stop sound in the other Settings window, then try again.'}, firstSoundOutcome: 'not_yet'}); return }
        if (attemptId !== this.permissionAttemptId) return
        await this.ensureEngine()
        if (attemptId !== this.permissionAttemptId) return
        this.status = MIDI_PROMPT_HINT
        const inputs = await this.requestMidiPermission()
        if (attemptId !== this.permissionAttemptId) return
        const input = selectRevealInput(inputs, this.revealProfile)
        this.midiInputs = [input]
        this.selectedInput = input.id
        this.midiOpening = true
        await this.midi.connect(input.id)
        if (attemptId !== this.permissionAttemptId) return
        this.recognizedInput = [input.manufacturer, input.name].filter(Boolean).join(' — ')
        this.resetCalibration()
        this.revealStage = 'settling'
        this.status = this.revealProfile.settlingStatus
        if (this.revealProfile.id === 'biotron') {
          const nonce = this.revealCalibrationNonce = this.revealCalibrationNonce % 127 + 1
          // A missing confirmation is not proof of absent plant signal; legacy cues cannot confirm readiness.
          window.clearTimeout(this.revealWatchdog)
          this.revealWatchdog = window.setTimeout(() => {
            if (this.revealCalibrationNonce === nonce && !this.explicitCalibration && ['settling', 'calibrating'].includes(this.revealStage)) Object.assign(this, {revealStage: 'intro', status: 'The device did not confirm calibration. Check the contacts and firmware version in Settings.',
              revealIssue: {title: 'Calibration not confirmed', body: 'Check both plant contacts. Open Settings to check the firmware, then try again.'}, firstSoundOutcome: 'not_yet'})
          }, 15000)
          await this.midi.sendToPairedOutput([0xf0, 0x14, 0x0d, 125, nonce, 0xf7])
          if (attemptId !== this.permissionAttemptId) return
        }
      } catch (error) {
        if (attemptId !== this.permissionAttemptId || error?.name === 'AbortError') return
        failure = error.message || `${this.revealProfile.productName} could not start.`
        const missingDevice = /was not found|No MIDI inputs found/i.test(failure)
        const denied = /permission was not allowed/i.test(failure)
        recordBiotronEvent('midi.connection_changed', {result: 'failed', error_type: denied ? 'permission_denied' : missingDevice ? 'device_missing' : 'connection_failed'})
        await this.stop()
        if (!this.releaseBlocked) {
          this.status = missingDevice ? 'Device not connected.' : 'Could not start listening.'
          this.revealIssue = missingDevice
            ? {title: 'Connect the device', body: 'Connect the device to this computer with a USB data cable, then press Start listening again.'}
            : {title: denied ? 'Allow access to Biotron' : 'Could not start listening', body: failure}
          this.firstSoundOutcome = 'not_yet'
        }
      } finally {
        if (attemptId === this.permissionAttemptId) {
          this.midiOpening = false
          this.starting = false
        }
      }
    },
    async requestMidiPermission() {
      const controller = markRaw(new AbortController())
      this.permissionAbort = controller
      this.permissionPending = true
      try { return await this.midi.requestAccess(undefined, controller.signal) }
      finally {
        if (this.permissionAbort === controller) {
          this.permissionAbort = null
          this.permissionPending = false
        }
      }
    },
    cancelMidiPermission({silent = false} = {}) {
      if (!this.permissionPending && !this.starting) return
      this.permissionAttemptId++
      this.permissionAbort?.abort()
      this.permissionAbort = null
      this.permissionPending = false
      this.starting = false
      if (!silent) this.status = 'MIDI request cancelled. The browser prompt may remain open; press Start again after answering it.'
    },
    resetVoiceUi() {
      this.heldCodes.clear()
      window.cancelAnimationFrame(this.voiceFrame)
      this.voiceFrame = null
      this.voiceCount = 0
    },
    panic() {
      this.engine?.panic()
      this.resetVoiceUi()
      this.status = 'All notes stopped'
    },
    async changeQuality(event) {
      if (this.starting || this.releaseBlocked) { event.target.checked = this.lowCpu; return }
      const previous = this.lowCpu, safe = event.target.checked
      this.lowCpu = safe
      if (this.engine) await this.stop()
      if (this.releaseBlocked) { this.lowCpu = previous; return }
      this.status = `${safe ? 'Low CPU: 4 voices' : 'Standard: 8 voices'}. Press Play to start again.`
    },
    applySelectedSound() {
      const engine = this.engine, sound = this.selectedSound
      this.presetTask = markRaw(this.presetTask.catch(() => {}).then(async () => {
        if (engine !== this.engine || !engine?.ready || engine.stopped || sound !== this.selectedSound) return
        await engine.applyPreset(sound)
        if (engine === this.engine && !engine.stopped) this.appliedSoundName = engine.sound.name
      }).catch(error => {
        if (engine === this.engine && !engine?.stopped) this.setAudioState('error', `Sound change failed: ${error.message}. Stop and restart.`)
      }))
      return this.presetTask
    },
    clearExample() {
      for (const timer of this.exampleTimers) window.clearTimeout(timer)
      this.exampleTimers.clear()
      this.examplePlaying = false
    },
    async toggleExample() {
      if (this.examplePlaying || this.audioStarting) { await this.stop(); return }
      await this.stop()
      if (this.releaseBlocked) return
      this.examplePlaying = true
      await this.start()
      if (!this.examplePlaying) return
      if (this.audioState !== 'running') {
        const message = this.status; await this.stop()
        if (!this.releaseBlocked) this.status = message
        return
      }
      const engine = this.engine, {variant, events, duration} = this.audition
      const schedule = (task, seconds) => {
        const timer = window.setTimeout(() => { this.exampleTimers.delete(timer); task() }, seconds * 1000)
        this.exampleTimers.add(timer)
      }
      this.status = `Example: ${variant.label}`
      for (const event of events) schedule(() => {
        if (engine !== this.engine || !this.examplePlaying) return
        if (event.type === 'on') engine.noteOn('audition', 0, event.note, event.velocity, engine.context.currentTime, this.audition.variant.level ?? 1)
        else engine.noteOff('audition', 0, event.note)
        this.voiceCount = engine.activeVoiceCount
      }, event.at)
      schedule(() => { void this.stop() }, duration)
    },
    async playDiagnosticPacket() {
      const {buildBiotronPlayDiagnosticPacket} = await import(/* webpackChunkName: "biotron-diagnostics" */ '@/biotron/settingsReadback.mjs')
      return buildBiotronPlayDiagnosticPacket({
        buildId: process.env.VUE_APP_BUILD_ID || 'local-build',
        route: this.$route?.path || '/biotron/play',
        device: this.midi?.input || null,
        firmwareVersion: null,
        revealStage: this.revealStage,
        stoppedStage: this.revealIssue?.title || (this.audioState === 'running' ? null : this.revealStage),
        audioState: this.audioState,
        midiLastMessageAt: this.midi?.lastMessageAt ?? null,
        resumeOutcome: this.resumeOutcome,
        trace: window.__biotronTrace || [],
      })
    },
    async resumeSound({automatic = false} = {}) {
      const engine = this.engine
      if (!engine || this.starting || this.releaseBlocked ||
          !['suspended', 'interrupted'].includes(engine.context?.state)) return
      if (this.audioState === 'running') this.setAudioState(engine.context.state, 'Audio paused — press Resume sound')
      const attemptId = ++this.resumeAttemptId
      this.starting = true
      this.resumeOutcome = automatic ? 'automatic_starting' : 'manual_starting'
      trace('resume', this.resumeOutcome)
      try {
        const state = await resumeAudioWithin(engine)
        if (this.engine !== engine || this.resumeAttemptId !== attemptId) return
        if (state !== 'running') throw new Error('Audio did not resume.')
        this.setAudioState('running', 'Sound ready — touch the plant to check it.')
        this.resumeOutcome = automatic ? 'automatic_running' : 'manual_running'
        trace('resume', this.resumeOutcome)
      } catch (error) {
        if (this.engine !== engine || this.resumeAttemptId !== attemptId) return
        this.resumeOutcome = /timed out/i.test(error.message) ? 'timed_out' : 'failed'
        trace('resume', this.resumeOutcome)
        this.status = 'Sound is still paused. Try Resume sound once, then copy diagnostics.'
      } finally {
        if (this.resumeAttemptId === attemptId) this.starting = false
      }
    },
    handleRevealMessage(message) {
      const calibration = parseBiotronCalibrationState(message)
      if (calibration) {
        if (calibration.nonce !== this.revealCalibrationNonce || !['settling', 'calibrating'].includes(this.revealStage)) return
        const active = calibration.state !== 'ready'
        if (active && !this.explicitCalibration) {
          const nonce = this.revealCalibrationNonce
          this.clearCalibrationTimers()
          this.explicitCalibration = true
          this.revealWatchdog = window.setTimeout(() => {
            if (!this.explicitCalibration || this.revealCalibrationNonce !== nonce) return
            this.resetCalibration()
            Object.assign(this, {revealStage: 'intro', status: 'Calibration did not finish. Check both plant clips, then try Start listening again.',
              revealIssue: {title: 'Calibration did not finish', body: 'Copy diagnostics before retrying if this happens again.'}, firstSoundOutcome: 'not_yet'})
          }, 25000)
        }
        updateSoundSession({calibrating: active})
        if (active) Object.assign(this, {revealStage: calibration.state === 'waiting' ? 'settling' : 'calibrating', status: calibration.state === 'waiting' ? 'Connected — waiting for calibration to begin' : this.revealProfile.calibratingStatus})
        else this.finishCalibration()
        return
      }
      if (this.revealStage === 'ready' && message?.type === 'note-on') {
        this.revealStage = 'revealed'
        this.status = 'If it is silent, check your volume and audio output.'
        this.firstSoundOutcome = 'awaiting_answer'
        return
      }
      if (this.explicitCalibration || !['settling', 'calibrating'].includes(this.revealStage)) return

      // Legacy note sequences are hints, never confirmation of readiness.
      const state = this.calibrationTracker.observe(message, performance.now())
      if (state === 'calibrating') {
        this.revealStage = 'calibrating'
        this.status = 'Waiting for calibration confirmation from the device'
      } else if (state === 'activity') {
        this.status = 'Notes received; waiting for the device to confirm readiness'
      }

    },
  }
}
