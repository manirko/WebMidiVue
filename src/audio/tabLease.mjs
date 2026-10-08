export class ExclusiveTabLease {
  constructor(locks, name = 'playtronica-sound-lab') {
    this.locks = locks
    this.name = name
    this.held = false
    this.protected = Boolean(locks?.request)
    this.releaseHold = null
    this.acquirePromise = null
    this.task = null
    this.generation = 0
  }

  async acquire() {
    if (this.held) return true
    if (!this.protected) {
      this.held = true
      return true
    }
    if (this.acquirePromise) return this.acquirePromise

    const generation = this.generation
    this.acquirePromise = new Promise(resolve => {
      let settled = false
      const settle = value => {
        if (settled) return
        settled = true
        resolve(value)
      }

      try {
        this.task = Promise.resolve(this.locks.request(
          this.name,
          {mode: 'exclusive', ifAvailable: true},
          lock => {
            if (!lock || generation !== this.generation) {
              settle(false)
              return false
            }
            this.held = true
            return new Promise(release => {
              this.releaseHold = () => {
                this.held = false
                this.releaseHold = null
                release()
              }
              settle(true)
            })
          }
        )).catch(() => settle(false))
      } catch (error) {
        void error
        settle(false)
      }
    })

    const acquired = await this.acquirePromise
    this.acquirePromise = null
    return acquired
  }

  release() {
    this.generation++
    if (!this.held) return
    if (!this.protected) {
      this.held = false
      return
    }
    this.releaseHold?.()
  }
}

export const createExclusiveTabLease = (name, locks = globalThis.navigator?.locks) =>
  new ExclusiveTabLease(locks, name)
