<script>
import {resolveFirmware} from "@/assets/js/LoadFirmware";
import {bootDevice} from "@/assets/js/SysExCommand";

export default {
  data() {
    return {
      isOnline: navigator.onLine,
      updateError: '',
      updateStatus: '',
      firmware: null,
      downloadStarted: false,
      downloadConfirmed: false,
      preparing: false,
      enteringBoot: false
    }
  },
  mounted() {
    window.addEventListener('online', this.syncOnlineStatus)
    window.addEventListener('offline', this.syncOnlineStatus)
  },
  beforeUnmount() {
    window.removeEventListener('online', this.syncOnlineStatus)
    window.removeEventListener('offline', this.syncOnlineStatus)
  },
  methods: {
    syncOnlineStatus() {
      this.isOnline = navigator.onLine
      if (this.isOnline) this.updateError = ''
    },
    async prepareFirmware() {
      this.updateError = ''
      this.updateStatus = ''
      this.firmware = null
      this.downloadStarted = false
      this.downloadConfirmed = false
      this.preparing = true
      try {
        this.firmware = await resolveFirmware(this.repo)
        this.updateStatus = `Firmware ${this.firmware.version} verified by GitHub SHA-256 metadata.`
      } catch (error) {
        this.updateError = error.message
      } finally {
        this.preparing = false
      }
    },
    markDownloadStarted() {
      this.downloadStarted = true
      this.downloadConfirmed = false
      this.updateStatus = 'Download started. Wait until the .uf2 file finishes downloading.'
    },
    async enterUpdateMode() {
      this.updateError = ''
      this.enteringBoot = true
      try {
        await bootDevice(this.device)
        this.updateStatus = 'Biotron entered update mode. Copy the downloaded .uf2 file to RPI-RP2.'
      } catch (error) {
        this.updateError = error.message
      } finally {
        this.enteringBoot = false
      }
    }
  },

  props: {
      repo: {
        type: String
      },
      text: {
        type: String,
        default: "Update Firmware",
      },
      device: Object
  }
}
</script>

<template>
  <button data-bs-toggle="modal" data-bs-target="#UpdateConf" class="btn btn-primary" :class="$attrs.class">{{text}}</button>

  <div class="modal fade" id="UpdateConf" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="exampleModalLabel">Update Firmware</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <ol class="text-start">
            <li>Prepare and download the checked <code>.uf2</code> file.</li>
            <li>Enter update mode. No BOOT contacts are needed.</li>
            <li>Copy the file to the new <strong>RPI-RP2</strong> drive.</li>
          </ol>
          <p v-if="!isOnline" class="alert alert-warning mb-0" role="status">
            Firmware updates require an internet connection. Device settings remain available offline.
          </p>
          <p v-if="updateStatus" class="alert alert-info mb-2" role="status">{{ updateStatus }}</p>
          <p v-if="updateError" class="alert alert-danger mb-0" role="alert">{{ updateError }}</p>
          <div v-if="firmware" class="text-start mt-3">
            <p class="small text-muted mb-2">
              {{ firmware.name }} · SHA-256 {{ firmware.sha256 }}
            </p>
            <a class="btn btn-outline-primary w-100" :href="firmware.url"
               :download="firmware.name" target="_blank" rel="noopener"
               @click="markDownloadStarted">
              1. Download firmware
            </a>
            <div v-if="downloadStarted" class="form-check mt-3">
              <input id="firmware-download-confirmed" v-model="downloadConfirmed"
                     class="form-check-input" type="checkbox">
              <label class="form-check-label" for="firmware-download-confirmed">
                The <code>.uf2</code> file has finished downloading
              </label>
            </div>
            <button type="button" class="btn btn-primary w-100 mt-2"
                    :disabled="!downloadConfirmed || enteringBoot"
                    @click="enterUpdateMode">
              {{ enteringBoot ? 'Entering update mode…' : '2. Enter update mode' }}
            </button>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          <button v-if="!firmware" type="button" class="btn btn-primary"
                  :disabled="!isOnline || preparing" @click="prepareFirmware">
            {{ preparing ? 'Checking…' : 'Prepare update' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>

</style>
