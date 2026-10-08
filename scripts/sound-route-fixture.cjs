const {readFileSync} = require('node:fs')
const vm = require('node:vm')
// Exercise the real shared guard; no component-owned duplicate release hook.
const body = readFileSync('src/main.js', 'utf8').match(/router.beforeEach\((async[\s\S]*?)\n    \}\)/)[1] + '\n}'
module.exports = (player, to, from = {path: '/biotron/play'}) => {
  const guard = vm.runInNewContext(`(${body})`, {
    getSoundController: () => player,
    stopPersistentSound: async () => { await player.stop(); return !player.releaseBlocked }
  })
  return guard(to, from)
}
