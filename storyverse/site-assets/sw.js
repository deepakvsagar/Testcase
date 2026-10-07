// StoryVerse service worker: lets the installed app open offline with its drafts.
// Pages are network-first so a redeploy shows up on the next launch; static files
// are served from cache and refreshed in the background. Paid generation endpoints
// and sign-in are never cached or intercepted.
const CACHE = 'storyverse-v27-1';
const SHELL = [
  '/', '/create.html', '/studio.html', '/offline.html',
  '/style.css', '/canvas.css', '/create.css', '/studio.css',
  '/app.js', '/create.js', '/studio.js', '/video-renderer.js', '/pwa.js',
  '/manifest.webmanifest', '/icons/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png',
  '/assets/brand-sheet.webp', '/assets/story-world.webp',
];
// Read-only settings the studio needs to open a draft offline.
const CACHED_API = ['/api/paths', '/api/models', '/api/video-models'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallback) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true })) || (fallback && (await cache.match(fallback))) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  });
  if (cached) { refresh.catch(() => {}); return cached; }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (CACHED_API.includes(url.pathname)) event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith('/signin')) return;
  if (request.mode === 'navigate') { event.respondWith(networkFirst(request, '/offline.html')); return; }
  event.respondWith(cacheFirst(request));
});
