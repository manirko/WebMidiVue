import { createApp } from 'vue'
import {createRouter, createWebHashHistory} from 'vue-router'
import App from './App.vue'
import "bootstrap/js/dist/collapse"
import "bootstrap/js/dist/modal"
import "bootstrap/dist/css/bootstrap.min.css"
import HomeComponent from "@/components/HomeComponent.vue";
import '@pwa-entry'
import {getSoundController, stopPersistentSound} from '@/audio/sessionState.mjs'

const betaBuild = process.env.VUE_APP_BIOTRON_PWA_BETA === 'true'
const ScalaPage = () => import(/* webpackChunkName: "scala" */ '@/components/ExtraPage/ScalaPage.vue')
const BiotronUpdatePage = () => import(/* webpackChunkName: "biotron" */ '@/components/BiotronPage/BiotronUpdatePage.vue')
const ScalesPage = () => import(/* webpackChunkName: "scales" */ '@/components/ScalesPage/ScalesPage.vue')
const BiotronPageUpdated = () => import(/* webpackChunkName: "biotron" */ '@/components/BiotronPage/BiotronPageUpdated.vue')
const TouchMePage = () => import(/* webpackChunkName: "touchme" */ '@/components/TouchMePage/TouchMePage.vue')
const TouchMePageStandalone = () => import(/* webpackChunkName: "touchme" */ '@/components/TouchMePage/TouchMePageStandalone.vue')
const PlaytronPage = () => import(/* webpackChunkName: "playtron" */ '@/components/PlaytronPage/PlaytronPage.vue')
const CirclePage = () => import(/* webpackChunkName: "circle" */ '@/components/CirclePage/CirclePage.vue')
const SoundLab = () => import(/* webpackChunkName: "sound-lab" */ '@sound-lab')
const deviceMeta = productName => ({
    requiresMidi: true,
    productName
})
const playMeta = productName => ({...deviceMeta(productName), requiresAudio: true})

const knownDirectRoutes = new Set([
    '/biotron', '/biotron/play', '/biotron/update', '/biotron/compare', '/touchme', '/touchme/test',
    '/touchme/standalone', '/playtron', '/playtron/test', '/scales',
    '/scales/test', '/scala', '/circle', '/sound'
])

// A cached navigation such as /biotron is served the app shell by Workbox.
// Normalize it to the hash URL used by this application before the router starts.
if (!window.location.hash && knownDirectRoutes.has(window.location.pathname)) {
    window.history.replaceState(null, '', `/#${window.location.pathname}${window.location.search}`)
}

const routes = [
    { path: '/', component: HomeComponent},
    { path: '/biotron', component: BiotronPageUpdated, props: {id: "BiotronWebMidiId_2" }, meta: deviceMeta('Biotron') },

    { path: '/touchme', component: TouchMePage, props: {id: "TouchmeWebMidiId_2", showPagedModes: false}, meta: deviceMeta('TouchMe') },
    { path: '/touchme/test', component: TouchMePage, props: {id: "TouchmeWebMidiId_2", showPagedModes: true}, meta: deviceMeta('TouchMe') },
    { path: '/touchme/standalone', component: TouchMePageStandalone, props: {id: "TouchmeWebMidiId_standalone"}, meta: deviceMeta('TouchMe') },

    { path: '/playtron', component: PlaytronPage, props: {id: "PlaytronWebMidiId", showChords: false}, meta: deviceMeta('Playtron') },
    { path: '/playtron/test', component: PlaytronPage, props: {id: "PlaytronWebMidiId", showChords: true}, meta: deviceMeta('Playtron') },

    { path: '/scales', component: ScalesPage, props: {id: "ScalesWebMidiId_1", showExtraControls: true}, meta: deviceMeta('Scales') },
    { path: '/scales/test', component: ScalesPage, props: {id: "ScalesWebMidiId_1", showExtraControls: false}, meta: deviceMeta('Scales') },

    { path: "/biotron/update", component: BiotronUpdatePage, meta: deviceMeta('Biotron')},

    { path: '/scala', component: ScalaPage, meta: deviceMeta('Playtronica device')},

    { path: '/circle', component: CirclePage, props: {id: "CircleWebMidiId"}, meta: deviceMeta('Circle') }
]

if (betaBuild) {
    routes.push({
        path: '/biotron/play',
        component: SoundLab,
        props: {mode: 'reveal', profileId: 'biotron'},
        meta: {...playMeta('Biotron'), firstPlay: true}
    })
    routes.push({path: '/sound', component: SoundLab, meta: {requiresAudio: true, productName: 'Playtronica Sound'}})
    routes.push({path: '/biotron/compare', component: () => import(/* webpackChunkName: "biotron-auditions" */ '@audio-compare'), meta: {requiresAudio: true, productName: 'Biotron sound comparison'}})
}

const router = createRouter({
    history: createWebHashHistory(),
    linkActiveClass: 'active',
    routes
})

if (betaBuild) {
    router.afterEach(to => {
        if (to.path.startsWith('/biotron')) void import(/* webpackChunkName: 'biotron-telemetry' */ '@/biotron/telemetry.mjs').then(module => module.recordBiotronEvent('session.started')).catch(() => {})
    })
    router.beforeEach(async (to, from) => {
        const player = getSoundController()
        const biotronRoutes = ['/biotron', '/biotron/play', '/biotron/compare']
        if (biotronRoutes.includes(from.path) && biotronRoutes.includes(to.path) &&
            !player?.examplePlaying && !player?.starting) {
            player?.releaseHeldKeyboard()
            return true
        }
        return await stopPersistentSound()
    })
}

createApp(App).use(router).mount('#app')
