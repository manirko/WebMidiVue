<template>
  <div class="device-task-nav">
    <strong class="device-task-nav__device">{{ deviceName }}</strong>
    <nav :aria-label="`${deviceName} tasks`">
      <router-link
        v-for="task in tasks"
        :key="task.id"
        :to="task.route"
        custom v-slot="{href, navigate}"
      ><a :href="href" @click="openTask($event, navigate, task)"
        class="device-task-nav__link"
        :class="{'device-task-nav__link--active': task.id === activeTask}"
        :aria-current="task.id === activeTask ? 'page' : null"
      >{{ task.label }}</a></router-link>
    </nav>
  </div>
</template>

<script>
export default {
  name: 'DeviceTaskNav',
  props: {
    deviceName: {type: String, required: true},
    activeTask: {type: String, required: true},
    playRoute: {type: String, required: true},
    settingsRoute: {type: String, required: true}
  },
  computed: {
    tasks() {
      return [
        {id: 'play', label: 'Play', route: this.playRoute},
        {id: 'settings', label: 'Settings', route: this.settingsRoute}
      ]
    }
  },
  methods: {
    async openTask(event, navigate, task) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return
      await navigate(event)
      if (this.$route.path !== task.route) return
      await this.$nextTick()
      const title = document.querySelector(task.id === 'settings' ? '.settings-hero h2' : '.sound-lab__intro h1')
      title?.focus({preventScroll: true}); title?.scrollIntoView({block: 'start'})
    }
  }
}
</script>

<style scoped>
.device-task-nav {
  display: flex;
  width: min(760px, 100%);
  min-height: 48px;
  margin: 0 auto 1.15rem;
  padding: .5rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--beta-line, #ddd);
  background: var(--beta-surface, #fff);
  text-align: left;
}

.device-task-nav__device {
  padding-left: calc(var(--beta-card-inset,24px) - 8px);
  color: #17171a;
  font-size: 1rem;
  letter-spacing: -.01em;
}

.device-task-nav nav {
  display: flex;
  gap: .2rem;
}

.device-task-nav__link {
  display: inline-grid;
  min-height: 44px;
  padding: 0 1rem;
  place-items: center;
  border-radius: .35rem;
  color: #4f4a45;
  text-decoration: none;
}

.device-task-nav__link:hover,
.device-task-nav__link:focus-visible {
  color: #17171a;
  background: #eeeae2;
}

.device-task-nav__link--active {
  color: #fff;
  background: #315ee7;
  font-weight: 700;
}

@media (max-width: 420px) {
  .device-task-nav { gap: .25rem; }
  .device-task-nav__device { padding-left: calc(var(--beta-card-inset,16px) - 8px); }
  .device-task-nav__link { padding: 0 .75rem; }
}
</style>
