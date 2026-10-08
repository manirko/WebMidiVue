<template>
  <div :class="{'beta-shell': betaBuild}">
  <img src="/Logo-Black-280.webp" alt="Playtronica logo" width="280" height="199" loading="eager" decoding="async" class="small--hide image-element" itemprop="logo">

  <header v-if="!firstPlay && !betaBuild" class="d-flex justify-content-center">
    <nav aria-label="Devices">
      <ul class="nav nav-pills">
      <li class="nav-item">
        <router-link to="/biotron" class="nav-link">Biotron</router-link>
      </li>
      <li class="nav-item">
        <router-link to="/touchme" class="nav-link">TouchMe</router-link>
      </li>
      <li class="nav-item">
        <router-link to="/playtron" class="nav-link">Playtron</router-link>
      </li>
        <li class="nav-item">
          <router-link to="/scales" class="nav-link">Scales</router-link>
        </li>
      <li class="nav-item">
        <a href="https://playtronica.github.io/WebMidiOrbita/?nomidi=true" class="nav-link">Orbita</a>
      </li>
    </ul>
    </nav>
  </header>
  <div v-if="betaBuild" class="beta-meta">
    <small class="beta-build"><span>Biotron beta</span> · {{ versionLabel }}</small>
  </div>
  <div v-if="!firstPlay && offlineStatus.state !== 'update-pending'" class="offline-status-slot">
    <div
      v-if="offlineMessage"
      class="offline-status mx-auto mt-2 px-3 py-2"
      :class="offlineStatusClass"
      role="status"
      aria-live="polite"
  >
    <span>{{ offlineMessage }}</span>
    <span v-if="offlineStatus.ready && !installed" class="offline-actions">
      <button
          type="button"
          class="btn btn-outline-secondary offline-action"
          @click="installApp"
      >
        Install app
      </button>
    </span>
    <span v-if="installed" class="offline-installed">App installed</span>
    <button
        v-if="offlineStatus.state === 'error'"
        type="button"
        class="btn btn-outline-secondary offline-action offline-action--error"
        @click="retryOfflineSetup"
        :disabled="offlineRetrying"
    >
      {{ offlineRetrying ? "Retrying…" : "Retry" }}
    </button>
    <small v-if="showInstallHelp && offlineStatus.ready && !installed" class="offline-install-help">
      Android Chrome: menu ⋮ → Add to Home screen. Chrome: menu ⋮ → Cast, save and share → Install page as app. Edge: menu ⋯ → More tools → Apps → Install this site as an app.
    </small>
    </div>
  </div>
  <div v-if="betaBuild && appUpdate.available" class="offline-status-slot app-update-slot">
    <div class="offline-status mx-auto px-3 py-2" role="status" aria-live="polite">
      <span>{{ appUpdateMessage }}</span>
      <button ref="appUpdateAction" type="button" class="btn btn-outline-secondary offline-action" @click="updateApp"
              :disabled="appUpdate.updating || appUpdating">
        {{ appUpdate.updating || appUpdating ? 'Updating…' : 'Update app' }}
      </button>
    </div>
  </div>
  <div class="wrapper">
    <div class="m-2 content ">
      <main :class="{'route-stage': betaBuild && !firstPlay, 'route-stage--compact': betaBuild && firstPlay}">
        <CompatibilityGate :route="$route">
          <router-view v-slot="{ Component }">
            <!-- One Biotron player stays mounted while its settings change. -->
            <SoundLab v-if="betaBuild && biotronSoundRoute" mode="reveal" profile-id="biotron" :controls-visible="firstPlay" />
            <component v-if="!firstPlay" :is="Component" />
          </router-view>
        </CompatibilityGate>
      </main>

      <aside v-if="betaBuild && !firstPlay" class="beta-feedback mx-auto my-4 text-start" aria-labelledby="beta-feedback-title">
        <p id="beta-feedback-title" class="beta-feedback__title">What would make Biotron better?</p>
        <p class="text-secondary mb-3">Tell Andrey what worked, what felt confusing, or what you would like to hear.</p>
        <button ref="feedbackAction" type="button" class="btn btn-primary beta-feedback__action" :aria-expanded="feedbackOpen" aria-controls="feedback-editor" @click="openFeedback">Tell me what to change</button>
        <form v-if="feedbackOpen" id="feedback-editor" class="mt-3" @submit.prevent="copyFeedback">
          <label for="feedback-text">Your feedback</label>
          <textarea ref="feedbackText" id="feedback-text" class="form-control my-2" rows="4" maxlength="2000" v-model="feedbackText"></textarea>
          <div class="feedback-actions">
            <button type="submit" class="btn btn-outline-primary" :disabled="!feedbackText.trim()">Copy feedback</button>
            <a :href="feedbackMailto" class="btn btn-outline-secondary">Open email</a>
            <button type="button" class="btn btn-outline-secondary" @click="closeFeedback">Close</button>
          </div>
          <p role="status" class="mt-2 mb-0">{{ feedbackMessage || 'Your text stays on this page. Copy it to send wherever you prefer.' }}</p>
        </form>
        <details class="beta-compatibility">
          <summary>Browser &amp; phone compatibility</summary>
          <ul>
            <li><strong>Computer:</strong> current Chrome or Edge is the primary beta path.</li>
            <li><strong>Android:</strong> current Chrome with USB host/OTG is experimental.</li>
            <li><strong>iPhone or iPad:</strong> standard browsers do not provide Web MIDI. On iOS/iPadOS 17.6 or later, try <a href="https://apps.apple.com/us/app/midiweb-browser/id6757226617" target="_blank" rel="noopener">MIDIWeb Browser</a>; Biotron support is experimental.</li>
          </ul>
          <small>Firmware updates still require a computer and internet.</small>
        </details>
      </aside>

    </div>
    <footer v-if="!firstPlay" class="bottom-panel">
      <SocialLinks/>
      <div v-if="betaBuild" class="beta-footer">
        <nav aria-label="Support and privacy">
          <a href="https://shop.playtronica.com/pages/privacy" target="_blank" rel="noopener">Privacy</a>
          <a href="https://shop.playtronica.com/pages/terms" target="_blank" rel="noopener">Company &amp; terms</a>
          <a href="mailto:support@playtronica.com">Contact support</a>
          <a href="/telemetry.html">What is collected</a>
        </nav>
        <small>Playtronica OÜ · Technical events are sent online. Feedback text and copied diagnostics are sent only when you share them.</small>
      </div>
    </footer>
  </div>
  </div>
</template>


<script>
import {defineAsyncComponent} from 'vue';
const SoundLab = defineAsyncComponent(() => import(/* webpackChunkName: "sound-lab" */ '@sound-lab'));
import SocialLinks from "@/components/SocialLinks.vue";
import CompatibilityGate from "@compatibility-gate";
import {
  getOfflineStatus,
  OFFLINE_STATUS_EVENT,
  prepareOfflineAccess,
  APP_UPDATE_EVENT,
  getAppUpdateStatus,
  requestAppUpdate
} from "@pwa-entry";
import {canReloadApp} from '@/appUpdateSafety.mjs';
import {stopPersistentSound} from '@/audio/sessionState.mjs';
import {
  clearInstallPrompt,
  getInstallPrompt,
  INSTALL_PROMPT_AVAILABLE_EVENT,
  takeInstallPrompt
} from "@/pwaInstallPrompt.mjs";

const runningStandalone = () => window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true


export default {
  name: 'App',
  components: {CompatibilityGate, SocialLinks, SoundLab},
  data() {
    return {
      offlineStatus: getOfflineStatus(),
      appUpdate: getAppUpdateStatus(),
      appUpdating: false,
      online: navigator.onLine,
      installPrompt: getInstallPrompt(),
      installed: runningStandalone(),
      showInstallHelp: false,
      offlineRetrying: false,
      feedbackOpen: false,
      feedbackText: '',
      feedbackMessage: '',
      betaBuild: process.env.VUE_APP_BIOTRON_PWA_BETA === 'true',
      versionLabel: process.env.VUE_APP_VERSION_LABEL || 'Local preview'
    }
  },
  computed: {
    biotronSoundRoute() { return ['/biotron', '/biotron/play', '/biotron/compare'].includes(this.$route.path) },
    appUpdateMessage() {
      if (this.appUpdate.error === 'SW_UPDATE_BLOCKED') return 'Finish the firmware update before reloading the app.'
      if (this.appUpdate.error === 'AUDIO_RELEASE_FAILED') return 'Sound could not stop. Press Stop & release, then retry the app update.'
      if (this.appUpdate.error) return 'The app update did not finish. Check the connection, then try again.'
      if (this.appUpdate.reloadRequired) return 'A new version is active. Update this tab before switching views. Updating stops sound.'
      if (this.offlineStatus.state === 'update-pending') return 'Update the app to finish offline setup. Updating stops sound and reloads this page.'
      return 'A new app version is ready. Updating stops sound and reloads this page.'
    },
    firstPlay() {
      return this.betaBuild && this.$route.meta.firstPlay === true
    },
    feedbackMailto() {
      const subject = `Biotron Settings beta feedback — ${this.versionLabel}`
      const body = this.feedbackReport
      return `mailto:manirko@playtronica.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    },
    feedbackReport() {
      return `Biotron feedback\nVersion: ${this.versionLabel}\nPage: ${this.$route.path}\n\n${this.feedbackText.trim()}`
    },
    offlineMessage() {
      if (this.offlineStatus.state === 'update-pending') return 'Update the app to reopen the current version offline.'
      if (this.offlineStatus.ready && !this.online) {
        return "Offline mode — Settings are working without internet. Firmware updates still need internet."
      }
      if (this.offlineStatus.ready) {
        return "Offline mode is ready — this browser can reopen Settings without internet."
      }
      if (this.offlineStatus.state === "installing") {
        return "Preparing offline access… Keep this window open until it is ready."
      }
      if (this.offlineStatus.state === "error") {
        const messages = {
          SW_FIRST_INSTALL_OFFLINE: "Connect once to install the offline copy, then press Retry.",
          SW_SETUP_TIMEOUT: "Offline setup timed out. Check the connection, then press Retry.",
          SW_CACHE_INCOMPLETE: "The offline copy is incomplete. Connect, then press Retry."
        }
        return messages[this.offlineStatus.code] || "Offline setup did not finish. Check the connection, then press Retry."
      }
      if (this.offlineStatus.state === "unsupported") {
        return "This browser cannot install Settings for offline use."
      }
      return ""
    },
    offlineStatusClass() {
      if (this.offlineStatus.ready) return "offline-status--ready"
      if (this.offlineStatus.state === "error" || this.offlineStatus.state === "unsupported") {
        return "offline-status--error"
      }
      return "offline-status--preparing"
    }
  },
  mounted() {
    if (this.betaBuild) document.title = 'Biotron Settings Beta — Playtronica'
    window.addEventListener(OFFLINE_STATUS_EVENT, this.handleOfflineStatus)
    window.addEventListener(APP_UPDATE_EVENT, this.handleAppUpdate)
    window.addEventListener("online", this.handleConnectionChange)
    window.addEventListener("offline", this.handleConnectionChange)
    window.addEventListener(INSTALL_PROMPT_AVAILABLE_EVENT, this.handleInstallPrompt)
    window.addEventListener("appinstalled", this.handleInstalled)
    if (this.betaBuild) this.removeUpdateGuard = this.$router.beforeEach(() => {
      if (!this.appUpdate.reloadRequired) return true
      this.$refs.appUpdateAction?.focus()
      return false
    })
  },
  beforeUnmount() {
    this.removeUpdateGuard?.()
    window.removeEventListener(OFFLINE_STATUS_EVENT, this.handleOfflineStatus)
    window.removeEventListener(APP_UPDATE_EVENT, this.handleAppUpdate)
    window.removeEventListener("online", this.handleConnectionChange)
    window.removeEventListener("offline", this.handleConnectionChange)
    window.removeEventListener(INSTALL_PROMPT_AVAILABLE_EVENT, this.handleInstallPrompt)
    window.removeEventListener("appinstalled", this.handleInstalled)
  },
  methods: {
    closeFeedback() { this.feedbackOpen = false; this.$refs.feedbackAction?.focus() },
    async openFeedback() {
      this.feedbackOpen = true
      await this.$nextTick()
      this.$refs.feedbackText?.focus()
    },
    async copyFeedback() {
      try {
        await navigator.clipboard.writeText(this.feedbackReport)
        this.feedbackMessage = 'Copied. Paste it into your message to Andrey.'
      } catch {
        this.feedbackMessage = 'Copy was blocked. Select your text and copy it, or use Open email.'
        this.$refs.feedbackText?.select()
      }
    },
    handleAppUpdate(event) { this.appUpdate = event.detail },
    async updateApp() {
      if (this.appUpdating || this.appUpdate.updating) return
      if (!canReloadApp()) {
        this.appUpdate = {...this.appUpdate, error: 'SW_UPDATE_BLOCKED'}
        return
      }
      this.appUpdating = true
      try {
        if (!await stopPersistentSound()) {
          this.appUpdate = {...this.appUpdate, error: 'AUDIO_RELEASE_FAILED'}
          return
        }
        this.appUpdate = await requestAppUpdate(canReloadApp)
      } catch {
        this.appUpdate = {...this.appUpdate, updating: false, error: 'AUDIO_RELEASE_FAILED'}
      } finally { this.appUpdating = false }
    },
    handleOfflineStatus(event) {
      this.offlineStatus = event.detail
    },
    handleConnectionChange() {
      this.online = navigator.onLine
    },
    handleInstallPrompt() {
      this.installPrompt = getInstallPrompt()
      this.showInstallHelp = false
    },
    handleInstalled() {
      clearInstallPrompt()
      this.installPrompt = null
      this.installed = true
      this.showInstallHelp = false
    },
    async installApp() {
      const prompt = takeInstallPrompt()
      if (!prompt) {
        this.showInstallHelp = !this.showInstallHelp
        return
      }
      this.installPrompt = null
      await prompt.prompt()
      const choice = await prompt.userChoice
      if (choice?.outcome !== 'accepted') this.showInstallHelp = true
    },
    async retryOfflineSetup() {
      this.offlineRetrying = true
      try {
        this.offlineStatus = await prepareOfflineAccess()
      } finally {
        this.offlineRetrying = false
      }
    }
  }
}
</script>

<style>
#app { --ui-text-small:.875rem; --ui-text-body:1rem; --ui-text-section:1.25rem; --ui-text-hero:2.25rem; --ui-radius:.75rem; --ui-ink:#16181d; --ui-accent:#315ee7; --ui-control-border:#b8c0cc; font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; text-align:center; color:var(--ui-ink); margin-top:1%; }
#app h1 { font-size:var(--ui-text-hero); }
#app h2 { font-size:var(--ui-text-section); }
#app .settings_elem h2 { font-size:var(--ui-text-body); }
#app .btn { --bs-btn-font-size:var(--ui-text-body); --bs-btn-font-weight:600; --bs-btn-line-height:1.25; --bs-btn-padding-x:1rem; --bs-btn-padding-y:.6rem; --bs-btn-border-radius:var(--ui-radius); min-height:44px; font-size:var(--ui-text-body); font-weight:600; line-height:1.25; border-radius:var(--ui-radius); }
#app .btn:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; box-shadow:none; }
.beta-shell { --beta-card-inset:24px; --beta-page-inset:24px; --beta-ink:var(--ui-ink); --beta-muted:#686b73; --beta-line:rgba(27,31,40,.11); --beta-surface:rgba(255,255,255,.88); --beta-accent:var(--ui-accent); --beta-text-small:var(--ui-text-small); --beta-text-body:var(--ui-text-body); --beta-text-section:var(--ui-text-section); --beta-text-hero:var(--ui-text-hero); min-height:100vh; padding:.75rem 0 2rem; color:var(--beta-ink); font-size:var(--beta-text-body); line-height:1.5; background:radial-gradient(circle at 8% 0%,rgba(119,218,178,.13),transparent 28rem),radial-gradient(circle at 96% 12%,rgba(49,94,231,.09),transparent 24rem),#f6f5f1; }
#app .btn-primary,#app .btn-dark { --bs-btn-color:#fff; --bs-btn-bg:var(--ui-accent); --bs-btn-border-color:var(--ui-accent); --bs-btn-hover-color:#fff; --bs-btn-hover-bg:#254dc8; --bs-btn-hover-border-color:#254dc8; --bs-btn-active-color:#fff; --bs-btn-active-bg:#2144b4; --bs-btn-active-border-color:#2144b4; }
#app .btn-outline-primary,#app .btn-outline-dark,#app .btn-outline-secondary,#app .btn-secondary { --bs-btn-color:var(--ui-ink); --bs-btn-bg:#fff; --bs-btn-border-color:var(--ui-control-border); --bs-btn-hover-color:var(--ui-ink); --bs-btn-hover-bg:#eef1f6; --bs-btn-hover-border-color:#8995a7; --bs-btn-active-color:var(--ui-ink); --bs-btn-active-bg:#e3e9f3; --bs-btn-active-border-color:#8995a7; }
.beta-shell .compatibility-notice small { font-size:var(--beta-text-small); letter-spacing:0; text-transform:none; }
.beta-shell .compatibility-notice h1 { font-size:var(--beta-text-hero); }
.beta-shell > .image-element { width:132px; height:auto; margin:.35rem auto .75rem; }
.offline-status { width:min(720px,calc(100% - 2rem)); border:1px solid; border-radius:1rem; font-size:var(--beta-text-body,1rem); }
.beta-meta { display:flex; flex-wrap:wrap; justify-content:center; gap:.25rem 1rem; margin:.45rem 1rem 0; }
.beta-build { color:var(--beta-muted,#6c757d); font-size:var(--beta-text-small,.875rem); }
.beta-build span { color:var(--beta-accent); font-weight:700; }
.offline-status-slot { min-height:58px; }
.beta-shell .app-update-slot .offline-status { width:min(760px,calc(100% - 2 * var(--beta-page-inset))); display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:.75rem; text-align:left; background:#fff; border-color:rgba(49,94,231,.25); }
.app-update-slot .offline-action { margin-left:0; flex-shrink:0; }
.offline-actions { display:inline-flex; align-items:center; gap:.5rem; margin-left:.75rem; }
.offline-action--error { margin-left:.75rem; }
.offline-installed { display:inline-block; margin-left:.75rem; font-weight:600; }
.offline-install-help { display:block; width:100%; margin-top:.5rem; }
.offline-status--ready { color:#0f5132; background:#d1e7dd; border-color:#badbcc; }
.offline-status--preparing { color:#664d03; background:#fff3cd; border-color:#ffecb5; }
.offline-status--error { color:#842029; background:#f8d7da; border-color:#f5c2c7; }
.beta-feedback { width:min(760px,100%); padding:clamp(1.2rem,4vw,2rem); border:1px solid rgba(49,94,231,.14); border-radius:1.35rem; background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(238,243,255,.9)); box-shadow:0 18px 50px rgba(30,37,55,.07); }
.beta-feedback__eyebrow { display:block; margin-bottom:.45rem; color:var(--beta-accent); font-size:var(--beta-text-small); font-weight:650; }
.beta-compatibility { margin-top:1rem; padding-top:1rem; border-top:1px solid var(--beta-line); color:var(--beta-muted); }
.beta-compatibility summary { min-height:44px; padding:.65rem 0; color:var(--beta-ink); font-weight:700; cursor:pointer; }
.beta-compatibility ul { margin:.4rem 0 .6rem; padding-left:1.25rem; }
.beta-compatibility li + li { margin-top:.4rem; }
.beta-feedback__title { margin-bottom:.45rem; font-size:var(--beta-text-section); font-weight:700; letter-spacing:-.02em; }
.switch { position:relative; display:inline-block; width:60px; height:34px; }
.switch input { opacity:0; width:0; height:0; }
.slider { position:absolute; cursor:pointer; inset:0; background-color:#ccc; transition:.4s; }
.slider:before { position:absolute; content:""; height:26px; width:26px; left:4px; bottom:4px; background-color:white; transition:.4s; }
input:checked + .slider { background-color:#2196F3; }
input:focus + .slider { box-shadow:0 0 1px #2196F3; }
input:checked + .slider:before { transform:translateX(26px); }
.slider.round { border-radius:34px; }
.slider.round:before { border-radius:50%; }
.beta-shell .content { width:min(808px,100%); padding-inline:var(--beta-page-inset); }
.beta-shell .beta-feedback { width:100%; padding:var(--beta-card-inset); }
@media(max-width:640px) { .beta-shell { --beta-card-inset:16px; --beta-page-inset:16px; } }
.content { flex:1; width:min(820px,100%); margin-inline:auto !important; padding:clamp(1rem,3vw,1.5rem); box-sizing:border-box; }
.wrapper { display:flex; flex-direction:column; min-height:100vh; }
.route-stage { min-height:100vh; }
.route-stage--compact { min-height:0; }
.bottom-panel { min-height:60px; display:flex; flex-wrap:wrap; justify-content:center; align-items:center; border-top:1px solid rgba(27,31,40,.1); }
.feedback-actions,.beta-footer nav { display:flex; flex-wrap:wrap; gap:.5rem 1rem; }
.beta-footer { width:100%; max-width:760px; padding:1rem; font-size:var(--ui-text-small); }
.beta-footer nav { justify-content:center; margin-bottom:.5rem; }
input::-webkit-outer-spin-button,input::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
input[type="number"] { -moz-appearance:textfield; }
@media (max-width:640px) { .offline-actions{display:flex;justify-content:center;margin:.5rem 0 0} }
@media (prefers-reduced-motion:no-preference) { .beta-shell .btn,.beta-shell .nav-link,.beta-shell .offline-action{transition:color .18s ease,background-color .18s ease,border-color .18s ease,box-shadow .18s ease,transform .18s ease}.beta-shell .btn:not(:disabled):active,.beta-shell .offline-action:not(:disabled):active{transform:translateY(1px)} }
</style>
