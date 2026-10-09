<script>
export default {
  name: "BootstrapCollapse",
  props: {
    name_of_collapse: {
      type: String,
      required: true,
    },
    open_by_default: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {visited: this.open_by_default}
  }
}
</script>

<template>
  <details class="settings-section" :open="open_by_default" @toggle="visited ||= $event.target.open">
    <summary class="toggle-label"><h2>{{ name_of_collapse }}</h2></summary>
    <div v-if="visited" class="mt-2"><slot name="objects"></slot></div>
  </details>
</template>

<style scoped>
.toggle-label { min-height:44px; cursor:pointer; align-content:center; }
.toggle-label:focus-visible { outline:3px solid #315ee7; outline-offset:3px; }
.toggle-label h2 { display:inline; margin:0; font-size:var(--ui-text-section,1.25rem); font-weight:700; }
</style>
