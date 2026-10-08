// Sound-session effects used by the Play view. Vue owns rendering; this owns
// recovery and Biotron calibration timeouts for the live session.
export function createSoundSessionEffects({resumeAudioWithin, trace, updateSoundSession,
  parseBiotronCalibrationState, BIOTRON_CALIBRATION}) {
  return {
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
