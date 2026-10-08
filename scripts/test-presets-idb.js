const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const {execFileSync} = require('child_process')
const {chromium} = require('playwright-core')

const root = path.resolve(__dirname, '..')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-idb-'))
const entry = path.join(scratch, 'entry.js')
const bundle = path.join(scratch, 'bundle.js')
fs.writeFileSync(entry,
  `export {Db, withPresetFeedback} from ${JSON.stringify(path.join(root, 'src/assets/js/PresetsIDB.js'))}\nexport {BiotronDb} from ${JSON.stringify(path.join(root, 'src/components/BiotronPage/BiotronIDB.js'))}\n`)
process.once('exit', () => fs.rmSync(scratch, {recursive: true, force: true}))
execFileSync('npx', ['--yes', 'esbuild@0.24.0', entry, '--bundle', '--format=iife',
  '--global-name=__Presets', `--alias:@=${path.join(root,'src')}`, `--outfile=${bundle}`, '--log-level=error'], {cwd: root})

const server = http.createServer((request, response) => {
  if (request.url === '/bundle.js') {
    response.writeHead(200, {'Content-Type': 'text/javascript'})
    response.end(fs.readFileSync(bundle))
  } else {
    response.writeHead(200, {'Content-Type': 'text/html'})
    response.end('<!doctype html><title>Preset storage regression</title>')
  }
})

;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true
  })
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.addScriptTag({url: '/bundle.js'})
    const result = await page.evaluate(async () => {
      const {Db} = window.__Presets
      const check = (value, message) => { if (!value) throw new Error(message) }
      const dbName = `td03-${Date.now()}-${Math.random()}`
      const storage = (name, version) => {
        const db = new Db([])
        db.DB_NAME = name
        db.VERSION = version
        db.STORE_NAME = 'Patches'
        return db
      }
      const openOld = (name, version, seed) => new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version)
        request.onupgradeneeded = () => request.result.createObjectStore('Patches', {keyPath: 'id', autoIncrement: true})
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          if (!seed) { resolve(db); return }
          const tx = db.transaction('Patches', 'readwrite')
          tx.objectStore('Patches').add({name: 'User fixture', saved: true, editable: true, data: {note: 42}})
          tx.oncomplete = () => { db.close(); resolve() }
          tx.onerror = () => reject(tx.error)
        }
      })

      await openOld(dbName, 9, true)
      const db = storage(dbName, 10)
      check(await db.openDB() === false, 'upgrade must preserve existing store')
      check((await db.getPatch()).length === 1, 'upgrade lost fixture')
      check((await db.getPatch(1)).data.note === 42, 'upgrade changed fixture')
      await db.initialize([{name: 'Default', data: {note: 0}}])
      check((await db.getPatch()).length === 1, 'seed overwrote user fixture')
      return {dbName}
    })
    // A fresh page load proves the record survived a real database close/reopen.
    await page.reload()
    await page.addScriptTag({url: '/bundle.js'})
    const cases = await page.evaluate(async ({dbName}) => {
      const {Db, withPresetFeedback} = window.__Presets
      const check = (value, message) => { if (!value) throw new Error(message) }
      const rejects = async (operation, label) => {
        const result = await Promise.race([
          Promise.resolve().then(operation).then(() => 'resolved', () => 'rejected'),
          new Promise(resolve => setTimeout(() => resolve('timed out'), 1000))
        ])
        check(result === 'rejected', `${label}: ${result}`)
      }
      const storage = (name, version) => {
        const db = new Db([])
        db.DB_NAME = name
        db.VERSION = version
        db.STORE_NAME = 'Patches'
        return db
      }
      const db = storage(dbName, 10)
      check((await db.getPatch(1)).data.note === 42, 'fixture missing after reload')
      const id = await db.createPatch({note: 60})
      check((await db.getPatch(id)).saved === false, 'new patch was not committed')
      await db.updatePatch(id, {note: 61})
      await db.savePatch(id, 'Stored in browser')
      check((await db.getPatch(id)).data.note === 61 && (await db.getPatch(id)).saved, 'update/save failed')
      const unsaved = await db.getUnsavedPatch()
      check((await db.getPatch(unsaved)).data.note === 61, 'unsaved copy not committed')
      await db.deletePatch(unsaved)
      check(!(await db.getPatch(unsaved)), 'delete not committed')

      await rejects(() => db._transaction('readwrite', (store, setResult) => {
        const request = store.add({name: 'Abort', data: {note: 99}})
        request.onsuccess = () => { setResult(request.result); store.transaction.abort() }
      }), 'request success followed by abort')
      check(!(await db.getPatch()).some(row => row.name === 'Abort'), 'aborted row persisted')

      const status = []
      document.addEventListener('PresetStorageResult', event => status.push(event.detail))
      const originalPut = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) {
        const request = originalPut.apply(this, args)
        request.addEventListener('success', () => this.transaction.abort())
        return request
      }
      try {
        await withPresetFeedback('page', 'save', () => db.savePatch(id, 'Must not appear'))
      } finally {
        IDBObjectStore.prototype.put = originalPut
      }
      check(status.length === 1 && !status[0].ok, 'put success then abort reported Saved')
      check((await db.getPatch(id)).name === 'Stored in browser', 'aborted save changed record')
      await rejects(() => db.updatePatch(999999, {}), 'missing update')
      await rejects(() => db.savePatch(999999, 'Missing'), 'missing save')
      await rejects(() => db.deletePatch(999999), 'missing delete')
      await rejects(() => storage(dbName, 9).getPatch(), 'open VersionError')
      check((await db.getPatch(1)).name === 'User fixture', 'retry after open error failed')

      const fresh = storage(`${dbName}-fresh`, 10)
      await fresh.initialize([{name: 'Default A', data: {note: 1}}, {name: 'Default B', data: {note: 2}}])
      await fresh.initialize([{name: 'Default A', data: {note: 1}}, {name: 'Default B', data: {note: 2}}])
      check((await fresh.getPatch()).length === 2, 'default seeding duplicated or failed')

      const originalAdd = IDBObjectStore.prototype.add
      IDBObjectStore.prototype.add = function () { throw new DOMException('quota', 'QuotaExceededError') }
      try { await rejects(() => db.createPatch({note: 1}), 'quota') }
      finally { IDBObjectStore.prototype.add = originalAdd }
      check(Boolean(await db.createPatch({note: 2})), 'retry after quota failed')

      const blockedName = `${dbName}-blocked`
      const old = await new Promise((resolve, reject) => {
        const request = indexedDB.open(blockedName, 1)
        request.onupgradeneeded = () => request.result.createObjectStore('Patches', {keyPath: 'id', autoIncrement: true})
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const newer = storage(blockedName, 2)
      await rejects(() => newer.openDB(), 'blocked upgrade')
      old.close()
      check((await newer.openDB()) === false, 'retry after unblock failed')

      let finish
      const pending = new Promise(resolve => { finish = resolve })
      const events = []
      document.addEventListener('PresetStorageResult', event => events.push(event.detail))
      const saving = withPresetFeedback('page', 'save', () => pending)
      check(events.length === 0, 'Saved reported before commit')
      finish()
      await saving
      check(events.length === 1 && events[0].ok, 'committed save not reported')
      await withPresetFeedback('page', 'save', () => Promise.reject(new Error('quota')))
      check(events.length === 2 && !events[1].ok, 'failed save reported as saved')
      return {upgrade: 'preserved', transactions: 'commit/abort', faults: 'open/blocked/quota/missing', feedback: 'after completion'}
    }, result)
    assert.equal(cases.upgrade, 'preserved')
    await page.evaluate(async () => {
      const {BiotronDb, Db} = window.__Presets
      const check = (value, message) => { if (!value) throw Error(message) }
      const db = new BiotronDb()
      await db.ready
      const fresh = await db.getPatch()
      check(fresh.length === 4, 'built-in Biotron preset count changed')
      check(fresh.every(patch => patch.data.minPlantVelocity >= 1 && patch.data.minLightVelocity >= 1), 'fresh Humanize starts at zero')
      const fast = fresh.find(patch => patch.name === 'Fast role')
      const oldData = {...fast.data, minPlantVelocity: 0, minLightVelocity: 0}
      await db.updatePatch(fast.id, oldData)
      const selected = await db.getPatch(fast.id)
      check(selected.data.minPlantVelocity === 1 && selected.data.minLightVelocity === 1, 'exact old built-in was not refreshed')
      const raw = await Db.prototype.getPatch.call(db, fast.id)
      check(raw.data.minPlantVelocity === 0, 'reading migrated the database silently')
      const user = await db.createPatch(oldData, 'Fast role')
      check((await db.getPatch(user)).data.minPlantVelocity === 0, 'user preset zero was changed')
      await db.updatePatch(fast.id, {...oldData, plantBpm: oldData.plantBpm + 1})
      check((await db.getPatch(fast.id)).data.minPlantVelocity === 0, 'edited locked preset was changed')
    })
    console.log('Preset IndexedDB regression passed:', JSON.stringify(cases))
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.close() })
