<template>
  <div>
    <div class=" m-0 w-100">
      <div class="d-flex ">
        <div class="form-floating flex-grow-1 me-2">
          <select id="patch-selector" v-model="this.id" class="form-control" @change="this.patchChanged">
            <option v-for="patch in patches" v-bind:key="patch.id" :value="patch.id">{{patch.name}}</option>
          </select>
          <label for="patch-selector">{{this.text_label}}</label>
        </div>
          <button class="btn"
                  :class="{ 'btn-outline-secondary': this.button_state === 'Save', 'btn-outline-danger': this.button_state === 'Delete'}"
                  type="button"  data-bs-toggle="modal" @click="this.modelOpen"
                  :data-bs-target="this.button_state === 'Save' ? '#saveModal' : '#deleteModel'"
                  :style="{display: active_button_enabled ? 'block' : 'none'}">
            {{ this.button_state === "Save" ? "Save in browser" : "Delete browser preset" }}</button>
      </div>
    </div>
    <p v-if="storageMessage" class="small mt-2" :class="storageError ? 'text-danger' : 'text-success'" role="status" aria-live="polite">{{ storageMessage }}</p>

    <div class="modal fade" id="saveModal" tabindex="-1" aria-labelledby="saveModalLabel" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="saveModalLabel">Save preset in this browser</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cancel"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label for="patchName" class="col-form-label">Preset name</label>
              <input type="text" class="form-control" id="patchName" v-model="this.patchName"
                     :key="this.forceRerender" autocomplete="off" data-autofocus>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" data-bs-dismiss="modal" @click="this.savePatch">Save in browser</button>
          </div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="deleteModel" tabindex="-1" aria-labelledby="deleteModalLabel" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="deleteModalLabel">Delete preset</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cancel"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              Do you really want to delete this patch?
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-danger" data-bs-dismiss="modal" @click="this.deletePatch">Delete</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
  import {createListenerScope} from "@/assets/js/ListenerScope.mjs";

  export default {
    props: {
      patches: {
        type: Array
      },
      page_id: {
        type: String,
        required: true
      },
      selected_id: {type: Number, default: null},
      text_label: {
        default: "Presets",
        type: String,
      },
    },
    name: "PatchSelector",
    data() {
      return {
        id: 0,
        active_button_enabled: true,
        button_state: "Save",
        patchName: "",
        forceRerender: 0,
        storageMessage: "",
        storageError: false,
      }
    },
    watch: {

    },
    methods: {
      patchChanged() {
        this.storageMessage = ""
        localStorage.setItem(this.page_id, this.id)

        const current_item = this.patches?.find(patch => patch.id === this.id)
        if (!current_item) return

        this.active_button_enabled = current_item.editable
        this.button_state = current_item.saved ? "Delete" : "Save"

        document.dispatchEvent(new CustomEvent('PatchChanged', {detail: {pageId: this.page_id, id: this.id}}));
      },
      savePatch() {
        this.storageMessage = "Saving in browser…"
        document.dispatchEvent(new CustomEvent('PatchSave', {detail: this.patchName}));
      },
      deletePatch() {
        this.storageMessage = "Deleting browser preset…"
        document.dispatchEvent(new CustomEvent('PatchDelete'));
      },
      modelOpen() {
        this.patchName = "";
      }
    },
    mounted() {
      this.listenerScope = createListenerScope()
      this.listenerScope.on(document, 'PresetStorageResult', event => {
        const {pageId, action, ok, message} = event.detail
        if (pageId !== this.page_id) return
        this.storageError = !ok
        this.storageMessage = ok
          ? action === 'save' ? 'Saved in this browser.'
            : action === 'delete' ? 'Deleted from this browser.' : ''
          : `Browser preset ${action} failed: ${message}`
        if (ok && action === 'save') this.button_state = 'Delete'
        if (ok && action === 'delete') {
          this.id = 1
          this.active_button_enabled = false
        }
      })
      this.id = this.selected_id ?? parseInt(localStorage.getItem(this.page_id))
      const current_item = this.patches?.find(patch => patch.id === this.id)
      if (!current_item) return

      this.active_button_enabled = current_item.editable
      this.button_state = current_item.saved ? "Delete" : "Save"

      this.listenerScope.on(document, "shown.bs.modal", () => {
        if (this.button_state === "Save") {
          document.getElementById("patchName").focus()
        }
      })
    },
    beforeUnmount() {
      this.listenerScope?.clear()
    }
  }
</script>

<style scoped>

</style>
