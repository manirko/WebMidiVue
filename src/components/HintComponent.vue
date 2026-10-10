<script>
import infoIcon from '@fortawesome/fontawesome-free/svgs/solid/circle-info.svg'
export default {
  data: () => ({infoIcon}),
  props: {text: {type: String, default: 'Help is not available.'}}
}
</script>
<template>
  <details class="hint">
    <summary role="button" :aria-label="`Help: ${text}`">
      <img :src="infoIcon" alt="">
    </summary>
    <span class="hint-text">{{ text }}</span>
  </details>
</template>

<style scoped>
.hint { display: inline-block; max-width: 100%; vertical-align: middle; }
.hint[open] { display: block; width: min(28rem, 100%); }
summary { display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: 50%; cursor: pointer; }
summary::-webkit-details-marker { display: none; }
summary:hover, summary:focus-visible { background: #e9f0ff; outline: none; }
img { width: 1rem; height: 1rem; filter: invert(35%) sepia(95%) saturate(3300%) hue-rotate(210deg) brightness(96%); }
.hint-text { display: block; margin-top: .25rem; border-radius: .6rem; background: #20242b; color: white; padding: .6rem .75rem; font-size: .875rem; font-weight: 400; font-style: normal; line-height: 1.4; letter-spacing: normal; text-transform: none; text-align: left; white-space: pre-line; overflow-wrap: anywhere; }
</style>
