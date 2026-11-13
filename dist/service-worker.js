self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).map(name => caches.delete(name)));
    await self.registration.unregister();
    await self.clients.claim();
    const windows = await self.clients.matchAll({type: 'window'});
    await Promise.all(windows.map(client => client.navigate(client.url)));
  })());
});
