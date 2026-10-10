<template>
  <CompatibilityNotice v-if="issue" :issue="issue" :feedback-url="feedbackUrl" :advisory="advisory" />
  <slot v-else />
</template>

<script>
import CompatibilityNotice from '@/components/CompatibilityNotice.vue'
import {buildCompatibilityIssue, buildMidiAdvisory, detectPlatformCapabilities, taskFeedbackUrl} from '@/compatibility.mjs'

export default {
  name: 'CompatibilityGate',
  components: {CompatibilityNotice},
  props: {route: {type: Object, required: true}, advisory: {type: Boolean, default: false}},
  data() {
    return {capabilities: detectPlatformCapabilities()}
  },
  computed: {
    issue() {
      return this.advisory ? buildMidiAdvisory(this.capabilities) : buildCompatibilityIssue(this.capabilities, this.route.meta || {})
    },
    feedbackUrl() { return this.issue && this.route.meta?.firstPlay ? taskFeedbackUrl('I could not start the Biotron first-sound test.', `Compatibility: ${this.issue.kind}`, process.env.VUE_APP_VERSION_LABEL || 'Local preview') : '' }
  }
}
</script>
