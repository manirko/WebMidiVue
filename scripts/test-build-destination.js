const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const {execFileSync} = require('node:child_process')

const root = path.resolve(__dirname, '..')
const output = process.env.BUILD_DESTINATION_EVIDENCE || `/private/tmp/biotron-build-destination-${Date.now()}`
fs.mkdirSync(output, {recursive: false})
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const tree = directory => {
  if (!fs.existsSync(directory)) return {}
  const files = {}
  const visit = current => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) visit(file)
      else files[path.relative(directory, file)] = digest(file)
    }
  }
  visit(directory)
  return files
}
const defaultDir = path.join(root, 'dist')
const before = tree(defaultDir)
fs.writeFileSync(path.join(output, 'before.json'), JSON.stringify(before, null, 2))
;(async () => { try {
  for (const mode of ['biotron-beta', 'biotron-firmware-beta']) {
    const destination = path.join(output, mode)
    let log = ''
    try {
      log = execFileSync('npm', ['run', `build:${mode}`, '--', '--dest', destination],
        {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})
    } catch (error) {
      log = `${error.stdout || ''}\n${error.stderr || ''}`
      throw error
    } finally {
      fs.writeFileSync(path.join(output, `${mode}.log`), log)
      fs.writeFileSync(path.join(output, `${mode}.json`), JSON.stringify(tree(destination), null, 2))
      fs.writeFileSync(path.join(output, 'after.json'), JSON.stringify(tree(defaultDir), null, 2))
    }
    for (const [name, source] of [['_headers', '_headers'], ['_worker.js', 'telemetry-worker.mjs'], ['telemetry.html', 'telemetry.html']]) {
      const target = path.join(destination, name)
      assert(fs.existsSync(target) && fs.statSync(target).isFile(), `${mode}: ${name} is not a file in chosen destination`)
      if (name !== '_worker.js') assert.equal(digest(target), digest(path.join(root, 'beta-assets', source)), `${name} content changed`)
    }
    // Webpack minifies the copied .mjs as _worker.js. Verify its actual routing
    // and fail-closed storage behavior rather than expecting source-byte identity.
    const {default: worker} = await import(`data:text/javascript;base64,${fs.readFileSync(path.join(destination, '_worker.js')).toString('base64')}`)
    const unavailable = await worker.fetch(new Request('https://test.local/api/telemetry'), {})
    assert.equal(unavailable.status, 503, 'built worker pretended event storage exists')
    const asset = await worker.fetch(new Request('https://test.local/telemetry.html'), {ASSETS: {fetch: () => new Response('asset control')}})
    assert.equal(await asset.text(), 'asset control', 'built worker did not forward ordinary assets')
    const uf2 = path.join(destination, 'firmware', 'biotron-1.10.10-internal.uf2')
    if (mode === 'biotron-firmware-beta') {
      assert.equal(digest(uf2), '598d5a084f1eb3274e7c62b7bbeec1701f49d28edad87662e19c084dfc75477d')
      assert(!fs.readFileSync(path.join(destination, 'service-worker.js'), 'utf8').includes('biotron-1.10.10-internal.uf2'), 'firmware was cached offline')
    } else assert(!fs.existsSync(path.join(destination, 'firmware')), 'plain beta received firmware files')
    assert.deepEqual(tree(defaultDir), before, `${mode} changed another build's dist`)
  }
  console.log('Custom build destination: beta assets and exact firmware stay in chosen output; default dist unchanged.')
} catch (error) {
  fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({error: error.message}, null, 2))
  console.error(error)
  process.exitCode = 1
} finally { console.log(`Build evidence: ${output}`) } })()
