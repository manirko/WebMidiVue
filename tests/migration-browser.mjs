import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BUILD} from '../dist/version.mjs';

export async function testServiceWorkerMigration(browser) {
  const oldRoot = resolve(homedir(), 'ProjectData/Playtronica/biotron-web/rollback-e02b11e/dist');
  const newRoot = fileURLToPath(new URL('../dist', import.meta.url));
  const oldHTML = await readFile(resolve(oldRoot, 'index.html'), 'utf8');
  const mime = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json'};
  let mode = 'old', workerChecks = 0;
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      if (mode !== 'old' && path === '/service-worker.js') {
        workerChecks++;
        if (mode === 'without-worker') throw Error('kill switch omitted');
      }
      const root = mode === 'old' ? oldRoot : newRoot;
      const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
      if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw Error('not found');
      res.writeHead(200, {'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
      res.end(await readFile(file));
    } catch {res.writeHead(404, {'Cache-Control': 'no-store'}); res.end('Not found');}
  });
  try {
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const killSwitch of [false, true]) {
      mode = 'old'; workerChecks = 0;
      const context = await browser.newContext();
      // The real old app registers its own worker; new pages never do.
      await context.route('https://**/*', route => route.abort());
      try {
        const pages = [await context.newPage(), await context.newPage()];
        for (const [index, page] of pages.entries()) {
          await page.goto(`${origin}/?migration=${index}#/biotron/play`);
          await page.waitForFunction(async () => navigator.serviceWorker.controller &&
            (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated' && (await caches.keys()).length > 0);
        }
        const urls = pages.map(page => page.url());
        await pages[0].evaluate(async () => {
          const cache = await caches.open('unrelated-migration-control');
          await cache.put('/migration-control', new Response('must be deleted'));
        });
        mode = killSwitch ? 'new' : 'without-worker';
        await pages[0].reload();
        if (!killSwitch) {
          // Wait for an actual update attempt, rather than merely checking too early.
          await pages[0].evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            await registration.update().catch(() => {});
          });
          assert(workerChecks > 0, 'negative control never requested the missing worker');
          const state = await pages[0].evaluate(async () => ({
            controlled: !!navigator.serviceWorker.controller,
            active: (await navigator.serviceWorker.getRegistration())?.active?.state,
            caches: await caches.keys(),
            html: document.documentElement.outerHTML,
          }));
          assert.equal(state.controlled, true);
          assert.equal(state.active, 'activated');
          assert(state.caches.includes('unrelated-migration-control'));
          assert(state.html.includes('/js/app.e0be9122.js') && oldHTML.includes('/js/app.e0be9122.js'), 'old cached app was not retained');
          assert.equal(await pages[0].locator('#settings-open').count(), 0);
          console.log('Migration negative control: old worker and cached app persist without kill switch: PASS');
        } else {
          for (const [index, page] of pages.entries()) {
            await page.locator('#settings-open').waitFor();
            await page.waitForFunction(async () => !navigator.serviceWorker.controller &&
              (await navigator.serviceWorker.getRegistrations()).length === 0 && (await caches.keys()).length === 0);
            assert.equal(page.url(), urls[index], 'migration changed a window URL');
            assert.equal(await page.evaluate(async () => (await import('/version.mjs')).BUILD), BUILD);
            await page.locator('#feedback-open').click();
            await page.locator('#feedback-see').click();
            assert.equal(JSON.parse(await page.locator('#feedback-preview').inputValue()).build, BUILD, 'app did not load the new BUILD');
          }
          assert(workerChecks > 0, 'kill switch was never requested');
          console.log(`Migration: both windows load BUILD ${BUILD}, keep their URLs, unregister and empty all caches: PASS`);
        }
      } finally {await context.close();}
    }
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}
