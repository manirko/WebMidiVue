<template>
  <div class="diagnostic-copy-panel">
    <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="preparing" @click="copy">{{ label }}</button>
    <small>Includes browser, device port, firmware version and current workflow state. No preset values or plant readings. Copying does not send the report.</small>
    <details @toggle="togglePreview">
      <summary>Show what will be copied</summary>
      <textarea aria-label="Diagnostic report" :value="text" readonly rows="8" @focus="$event.target.select()"></textarea>
    </details>
    <small role="status" aria-live="polite">{{ message }}</small>
  </div>
</template>
<script>
import {formatBiotronDiagnostic} from '@/biotron/settingsReadback.mjs'
export default {
  name: 'DiagnosticCopy',
  props: {packet: {type: Function, required: true}, label: {type: String, default: 'Copy diagnostics'}},
  data() { return {text: '', message: '', previewOpen: false, preparing: false} },
  methods: {
    async prepare() {
      this.preparing = true
      try { this.text = formatBiotronDiagnostic(await this.packet()); return true }
      catch { this.message = 'The report could not load. Check the connection and try again.'; return false }
      finally { this.preparing = false }
    },
    async togglePreview(event) {
      this.previewOpen = event.target.open
      if (this.previewOpen) await this.prepare()
    },
    async copy() {
      if ((!this.previewOpen || !this.text) && !await this.prepare()) return
      try {
        await navigator.clipboard.writeText(this.text)
        this.message = 'Copied. Paste it into your message to support.'
      } catch { this.message = 'Copy was blocked. Open the preview, select the report and copy it.' }
    }
  }
}
</script>
<style scoped>
.diagnostic-copy-panel { display:flex; flex-direction:column; align-items:flex-start; gap:.5rem; }
.diagnostic-copy-panel small { color:#625e58; }
.diagnostic-copy-panel details { width:100%; }
.diagnostic-copy-panel summary { min-height:44px; padding:.5rem 0; cursor:pointer; }
.diagnostic-copy-panel textarea { width:100%; font-family:monospace; font-size:.8rem; }
</style>
