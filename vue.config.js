const {execFileSync} = require('child_process')
const path = require('path')

const biotronBeta = process.env.VUE_APP_BIOTRON_PWA_BETA === 'true'
const biotronFirmwareBeta = process.env.VUE_APP_BIOTRON_FIRMWARE_TEST_ENABLED === 'true'
let sourceRevision = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || ''
if (!sourceRevision) {
  try {
    sourceRevision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {encoding: 'utf8'}).trim()
  } catch (error) {
    sourceRevision = 'local-build'
  }
}
process.env.VUE_APP_BUILD_ID = sourceRevision.slice(0, 12)
let versionDate
try {
  versionDate = execFileSync('git', ['show', '-s', '--format=%cs', 'HEAD'], {encoding: 'utf8'}).trim()
} catch (error) {
  versionDate = new Date().toISOString().slice(0, 10)
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(versionDate)) versionDate = new Date().toISOString().slice(0, 10)
process.env.VUE_APP_VERSION_LABEL = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
}).format(new Date(`${versionDate}T12:00:00Z`))

module.exports = {
  publicPath: '/',
  configureWebpack: {
    optimization: {splitChunks: {cacheGroups: {
      soundSession: {test: /[\\/]src[\\/]audio[\\/]soundSessionEffects\.mjs$/, name: 'sound-session', chunks: 'all', enforce: true}
    }}}
  },
  chainWebpack: config => {
    config.resolve.alias.set(
      '@pwa-entry',
      path.resolve(__dirname, biotronBeta ? 'src/registerServiceWorker.js' : 'src/noopServiceWorker.js')
    )
    config.resolve.alias.set(
      '@biotron-device-selector',
      path.resolve(__dirname, biotronBeta
        ? 'src/components/MidiComponents/BiotronDeviceSelector.vue'
        : 'src/components/MidiComponents/DeviceSelector.vue')
    )
    config.resolve.alias.set(
      '@sound-lab',
      path.resolve(__dirname, biotronBeta
        ? 'src/components/SoundLab/SoundLab.vue'
        : 'src/components/SoundLab/DisabledSoundLab.vue')
    )
    config.resolve.alias.set(
      '@audio-compare',
      path.resolve(__dirname, biotronBeta
        ? 'src/components/SoundLab/AudioCompare.vue'
        : 'src/components/SoundLab/DisabledSoundLab.vue')
    )
    config.resolve.alias.set(
      '@compatibility-gate',
      path.resolve(__dirname, biotronBeta
        ? 'src/components/CompatibilityGate.vue'
        : 'src/components/DisabledCompatibilityGate.vue')
    )
    if (!biotronBeta) {
      config.plugins.delete('pwa')
      config.plugins.delete('workbox')
    } else {
      config.plugin('copy').tap(args => {
        if (biotronFirmwareBeta) {
          args[0].patterns.push({
            from: path.resolve(__dirname, 'beta-assets/firmware'),
            to: 'firmware'
          })
        }
        args[0].patterns.push({
          from: path.resolve(__dirname, 'beta-assets/_headers'),
          to: '.'
        })
        args[0].patterns.push({
          from: path.resolve(__dirname, 'beta-assets/telemetry-worker.mjs'),
          to: '_worker.js'
        })
        args[0].patterns.push({
          from: path.resolve(__dirname, 'beta-assets/telemetry.html'),
          to: 'telemetry.html'
        })
        return args
      })
    }
  },
  pwa: {
    name: biotronBeta ? 'Biotron Settings Offline Beta' : 'Playtronica Settings',
    themeColor: '#ffffff',
    msTileColor: '#ffffff',
    appleMobileWebAppCapable: 'yes',
    appleMobileWebAppStatusBarStyle: 'default',
    manifestOptions: {
      id: biotronBeta ? './biotron-settings-offline-beta' : './playtronica-settings',
      short_name: biotronBeta ? 'Biotron Beta' : 'Settings',
      description: 'Configure Playtronica instruments over Web MIDI.',
      start_url: biotronBeta ? './#/biotron/play' : './#/',
      scope: './',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#ffffff',
      icons: [
        { src: './img/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: './img/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' }
      ]
    },
    iconPaths: {
      faviconSVG: null,
      favicon32: null,
      favicon16: null,
      appleTouchIcon: 'img/icons/icon-192x192.png',
      maskIcon: null,
      msTileImage: 'img/icons/icon-192x192.png'
    },
    workboxPluginMode: 'GenerateSW',
    workboxOptions: {
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: false,
      navigateFallback: 'index.html',
      // Vue CLI excludes install icons by default; cache them explicitly so the
      // installed app remains complete when the first offline launch occurs.
      exclude: [/\.map$/, /favicon\.ico$/, /^manifest.*\.js?$/, /^firmware\//, /^_headers$/, /^_worker\.js$/,
        /^js\/(?:touchme|playtron|scales|scala|circle)\./]
    }
  }
}
