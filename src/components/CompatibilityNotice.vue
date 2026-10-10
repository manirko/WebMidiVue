<template>
  <section
    class="compatibility-notice"
    :class="{'compatibility-notice--advisory': advisory}"
    :role="advisory ? 'status' : 'alert'"
    :aria-label="issue.title"
  >
    <div class="compatibility-notice__mark" aria-hidden="true">!</div>
    <div class="compatibility-notice__content">
      <small>{{ advisory ? 'Connection help' : 'Browser help' }}</small>
      <component :is="advisory ? 'h2' : 'h1'">{{ issue.title }}</component>
      <p>{{ issue.summary }}</p>
      <ol v-if="issue.steps.length">
        <li v-for="step in issue.steps" :key="step">{{ step }}</li>
      </ol>
      <div v-if="issue.action || issue.copyLink || feedbackUrl" class="compatibility-notice__actions">
        <button v-if="issue.copyLink" type="button" class="btn btn-dark" @click="copyPageLink">
          {{ copied ? 'Link copied' : 'Copy page link' }}
        </button>
        <a
          v-if="issue.action"
          :href="issue.action.href"
          class="btn btn-outline-secondary"
          target="_blank"
          rel="noopener"
        >{{ issue.action.label }}</a>
        <a v-if="feedbackUrl" :href="feedbackUrl" class="btn btn-outline-dark" target="_blank" rel="noopener">Tell Andrey where it stopped</a>
      </div>
      <small v-if="issue.action && issue.action.note" class="compatibility-notice__action-note">{{ issue.action.note }}</small>
      <small v-if="feedbackUrl" class="compatibility-notice__action-note">WhatsApp opens with the version date and stopped stage. Nothing is sent until you press Send.</small>
      <input v-if="copyStatus && !copied" class="form-control mt-2" aria-label="Page link" :value="pageLink" readonly @focus="$event.target.select()">
      <span v-if="copyStatus" class="compatibility-notice__copy-status" role="status">{{ copyStatus }}</span>
    </div>
  </section>
</template>

<script>
export default {
  name: 'CompatibilityNotice',
  props: {issue: {type: Object, required: true}, advisory: {type: Boolean, default: false}, feedbackUrl: {type: String, default: ''}},
  data() {
    return {copied: false, copyStatus: '', pageLink: ''}
  },
  methods: {
    async copyPageLink() {
      this.copied = false
      this.copyStatus = ''
      this.pageLink = window.location.href
      try {
        await navigator.clipboard.writeText(this.pageLink)
        this.copied = true
        this.copyStatus = 'Page link copied.'
      } catch (error) {
        this.copyStatus = 'Copy was blocked. Select the link below and copy it.'
      }
    }
  }
}
</script>

<style scoped>
.compatibility-notice {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  width: min(720px, 100%);
  margin: clamp(1.5rem, 6vw, 4rem) auto;
  padding: clamp(1.25rem, 4vw, 2.25rem);
  gap: 1.1rem;
  border: 1px solid #e3b8ad;
  border-radius: 1.5rem;
  background: #fff8f5;
  color: #241a17;
  text-align: left;
}

.compatibility-notice--advisory {
  margin: 0 0 1.5rem;
  border-color: #c9c1ee;
  background: #f7f5ff;
}

.compatibility-notice__mark {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #b6472d;
  font-size: 1.5rem;
  font-weight: 800;
}

.compatibility-notice--advisory .compatibility-notice__mark {
  color: #372d67;
  background: #dfd9ff;
}

.compatibility-notice small {
  color: #7a4e43;
  font-size: var(--ui-text-small, .875rem);
  font-weight: 700;
}

.compatibility-notice--advisory small { color: #5d518f; }
.compatibility-notice h1,
.compatibility-notice h2 { margin: .25rem 0 .45rem; letter-spacing: -.025em; }
.compatibility-notice h1 { font-size: var(--ui-text-hero, 2.25rem); }
.compatibility-notice h2 { font-size: var(--ui-text-section, 1.25rem); }
.compatibility-notice p { margin: 0; color: #66534d; line-height: 1.55; }
.compatibility-notice ol { margin: 1rem 0 1.25rem; padding-left: 1.25rem; }
.compatibility-notice li + li { margin-top: .4rem; }
.compatibility-notice__actions .btn { min-height:44px; display:inline-flex; align-items:center; }
.compatibility-notice__actions { display:flex; flex-wrap:wrap; gap:.65rem; margin-top:1rem; }
.compatibility-notice__action-note,.compatibility-notice__copy-status { display:block; margin-top:.6rem; color:#66534d; font-size:var(--ui-text-small, .875rem); }

@media (max-width: 520px) {
  .compatibility-notice { grid-template-columns: 1fr; }
  .compatibility-notice__mark { width: 46px; height: 46px; }
}
</style>
