import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';

test('migration: security headers are byte-identical to production e02b11e', async () => {
  const old = await readFile(resolve(homedir(), 'ProjectData/Playtronica/biotron-web/rollback-e02b11e/dist/_headers'));
  assert.deepEqual(await readFile(new URL('../dist/_headers', import.meta.url)), old);
});

test('migration: worker skips waiting, deletes every cache, unregisters, claims and navigates each window once', async () => {
  const source = await readFile(new URL('../dist/service-worker.js', import.meta.url), 'utf8');
  const handlers = new Map(), calls = [];
  const windows = ['https://example.test/?tab=1#/biotron/play', 'https://example.test/?tab=2#/biotron'].map(url => ({
    url, async navigate(target) {calls.push(['navigate', url, target]);},
  }));
  runInNewContext(source, {
    self: {
      addEventListener(type, handler) {assert(!handlers.has(type)); handlers.set(type, handler);},
      async skipWaiting() {calls.push('skipWaiting');},
      registration: {async unregister() {calls.push('unregister'); return true;}},
      clients: {
        async claim() {calls.push('claim');},
        async matchAll(options) {assert.equal(options.type, 'window'); assert(!options.includeUncontrolled); calls.push('windows'); return windows;},
      },
    },
    caches: {
      async keys() {calls.push('keys'); return ['web-midi-playtronica-precache-test', 'unrelated-cache'];},
      async delete(name) {calls.push(['delete', name]); return true;},
    },
  });
  assert.deepEqual([...handlers.keys()].sort(), ['activate', 'install'], 'no fetch handler or caching');
  for (const type of ['install', 'activate']) {
    let completion;
    handlers.get(type)({waitUntil(promise) {assert.equal(completion, undefined); completion = promise;}});
    assert(completion instanceof Promise || typeof completion?.then === 'function');
    await completion;
  }
  assert.deepEqual(calls, ['skipWaiting', 'keys', ['delete', 'web-midi-playtronica-precache-test'],
    ['delete', 'unrelated-cache'], 'unregister', 'claim', 'windows', ...windows.map(({url}) => ['navigate', url, url])]);
});

test('migration: the new page and its scripts never register a service worker', async () => {
  const dist = new URL('../dist/', import.meta.url);
  for (const entry of await readdir(dist, {recursive: true, withFileTypes: true})) {
    if (!entry.isFile() || !/\.(?:html|m?js)$/.test(entry.name) || entry.name === 'service-worker.js') continue;
    const path = resolve(entry.parentPath, entry.name);
    assert.doesNotMatch(await readFile(path, 'utf8'), /serviceWorker\s*(?:\?\.|\.)\s*register\s*\(/, path);
  }
});
