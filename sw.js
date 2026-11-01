// Service Worker (PWA): App-Shell, Lerndaten und Audio offline. Der Server (app/pwa.mjs → swScript) setzt
// VERSION und SHELL beim Ausliefern ein; ändert sich eine Datei in app/public, gibt es einen neuen Worker + Cache.
const VERSION = '1b461ff3cb64';
const SHELL = ["./","./404.html","./account.js","./admin.js","./app.js","./asr.js","./audio.js","./backend-local.js","./check.js","./checkbadge.js","./coach.js","./core/logstats.js","./core/model.js","./core/srsmerge.js","./courses.js","./courses.json","./ctx.js","./data.js","./extras.js","./flashread.js","./fonts/NotoSans-latin.woff2","./fonts/NotoSansGeorgian-georgian.woff2","./fonts/OFL.txt","./i18n/en.json","./i18n/ka.glossary.md","./i18n/ka.json","./i18n/ka.status.json","./i18n.js","./icons/apple-touch-icon.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon.svg","./icons/maskable-512.png","./index.html","./keyboard.js","./langmods.js","./lemma.js","./letters.js","./listencards.js","./login.html","./manifest.webmanifest","./mic.js","./mistakes.js","./numbers-de.js","./numbers-en.js","./numbers-sv.js","./numbers.js","./offline.js","./opts.js","./pages-start.js","./prefetch.js","./record.js","./reminder.js","./spectrogram.js","./spell.js","./srs.js","./stats.js","./style.css","./timer.js","./todaypending.js","./util.js","./views/about.js","./views/cloze.js","./views/courses.js","./views/dialog.js","./views/flashcards.js","./views/forms.js","./views/home.js","./views/install.js","./views/ipa.js","./views/lesson.js","./views/listen.js","./views/mistakes.js","./views/numbers.js","./views/offline-static.js","./views/offline.js","./views/quiz.js","./views/read.js","./views/review.js","./views/speak.js","./views/today.js","./views/typing.js","./views/weak.js","./week.js","./writing.js"];

const SHELL_CACHE = 'shell-' + VERSION;
const DATA_CACHE = 'data';       // GET /api/* (Netz zuerst, offline der letzte Stand)
const AUDIO_CACHE = 'audio';     // /audio/* (bleibt über Versionen erhalten, wird im Hintergrund aufgefrischt)
const COURSE_CACHE = 'courses';  // statische PWA: courses/<id>/*.json?v=<Version> (backend-local.js räumt alte Fassungen)
// nie cachen: Ausspracheprüfung, Aufnahmen, Erreichbarkeitstest
const NETWORK_ONLY = /^\/api\/(asr|score|recording|record|ping)\b/;
const PRECACHE_API = [];
// Pfad relativ zum Scope: eigener Server = /, GitHub Pages = /<repo>/ → rel('/<repo>/api/x') = '/api/x'
const BASE = new URL(self.registration.scope).pathname;
const rel = p => p.startsWith(BASE) ? '/' + p.slice(BASE.length) : p;

// Server antwortet nicht (z. B. WLAN ohne Weg zum Heimnetz, DNS hängt): nach so vielen ms den Cache nehmen;
// die Anfrage läuft weiter und frischt den Cache auf, falls sie doch noch ankommt
const NET_TIMEOUT = 6000;
const timed = p => new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error('keine Antwort in ' + NET_TIMEOUT / 1000 + ' s')), NET_TIMEOUT);
  p.then(r => (clearTimeout(t), ok(r)), e => (clearTimeout(t), fail(e)));
});

// nur echte Erfolge cachen – 401 (Login), Weiterleitungen, Fehlerseiten nie
const cacheable = r => r && r.ok && r.status === 200 && !r.redirected && r.type === 'basic';

self.addEventListener('install', e => e.waitUntil((async () => {
  const shell = await caches.open(SHELL_CACHE), data = await caches.open(DATA_CACHE);
  // einzeln statt addAll: eine fehlende/geschützte Datei darf die Installation nicht scheitern lassen
  await Promise.all([
    ...SHELL.map(u => fetch(u, { cache: 'no-cache' }).then(r => cacheable(r) && shell.put(u, r)).catch(() => {})),
    ...PRECACHE_API.map(u => fetch(u).then(r => cacheable(r) && data.put(u, r)).catch(() => {})),
  ]);
  // kein skipWaiting: die Seite fragt den Nutzer („Neue Version – neu laden“) und schickt dann SKIP_WAITING
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if ((k.startsWith('shell-') && k !== SHELL_CACHE) || k === 'fonts') await caches.delete(k);   // fonts = früher Google Fonts
  await self.clients.claim();
})()));

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'VERSION') e.ports[0]?.postMessage(VERSION);
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url), path = rel(url.pathname);
  if (req.method !== 'GET') return;                                   // Schreiben geht immer ans Netz (Puffer: offline.js)
  if (url.origin !== location.origin) return;                         // Schriften liegen in der Shell (fonts/)
  if (NETWORK_ONLY.test(path) || path === '/sw.js') return;
  if (req.mode === 'navigate') return e.respondWith(navigate(req));
  if (path.startsWith('/api/')) return e.respondWith(networkFirst(req, DATA_CACHE));
  if (path.startsWith('/audio/')) return e.respondWith(audio(req));
  if (path.startsWith('/courses/')) return e.respondWith(cacheFirst(req, COURSE_CACHE));
  e.respondWith(shellFile(req));
});

// Seitenaufruf: Netz zuerst, damit eine Login-Seite oder Weiterleitung (Benutzerkonten) unverändert durchkommt;
// nur ohne Verbindung die gecachte index.html.
async function navigate(req) {
  const p = fetch(req).then(async r => {
    if (cacheable(r) && rel(new URL(req.url).pathname) === '/') await (await caches.open(SHELL_CACHE)).put('./', r.clone());
    return r;
  });
  try { return await timed(p); }
  catch (e) { p.catch(() => {}); return (await caches.match('./')) ?? offlineResponse(false, e); }
}

async function networkFirst(req, cacheName) {
  const p = fetch(req).then(async r => {
    if (cacheable(r)) await (await caches.open(cacheName)).put(req, r.clone());
    else if (r.status === 401 || r.status === 403) await (await caches.open(cacheName)).delete(req);   // abgemeldet: alten Stand nicht weiter zeigen
    return r;
  });
  try { return await timed(p); }
  catch (e) { p.catch(() => {}); return (await caches.match(req, { cacheName })) ?? offlineResponse(true, e); }
}

// App-Dateien: aus dem Cache der aktuellen Version, sonst Netz (neue Dateien anderer Module werden nachgecacht)
async function shellFile(req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const r = await fetch(req);
    if (cacheable(r)) cache.put(req, r.clone());
    return r;
  } catch { return offlineResponse(); }
}

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req, { cacheName });
  if (hit) return hit;
  try {
    const r = await fetch(req);
    if (cacheable(r)) (await caches.open(cacheName)).put(req, r.clone());
    return r;
  } catch { return offlineResponse(); }
}

// Audio: aus dem Cache (sofort, offline), im Hintergrund auffrischen (TTS kann durch echte Aufnahme ersetzt werden).
// Range-Anfragen (Safari/iOS verlangt 206) werden aus der vollständigen Datei bedient.
async function audio(req) {
  const key = new URL(req.url).pathname;
  const cache = await caches.open(AUDIO_CACHE);
  const refresh = () => fetch(key).then(r => { if (cacheable(r)) cache.put(key, r.clone()); return r; });
  let full = await cache.match(key);
  if (full) { if (Date.now() - Date.parse(full.headers.get('date') ?? 0) > 3 * 864e5) refresh().catch(() => {}); }
  else {
    try { full = (await timed(refresh())).clone(); } catch (e) { return offlineResponse(false, e); }
    if (!full.ok) return full;
  }
  return withRange(req, full);
}

async function withRange(req, full) {
  const range = req.headers.get('range');
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return full;
  const buf = await full.arrayBuffer(), size = buf.byteLength;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), { status: 206, headers: {
    'Content-Type': full.headers.get('Content-Type') ?? 'audio/mpeg',
    'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
}

// X-Offline-Reason: warum das Netz nicht ging (offline.js → #/offline); Header nur ASCII
const offlineResponse = (json = false, err = null) => {
  const headers = { 'X-Offline': '1', 'X-Offline-Reason': String(err?.message ?? err ?? 'offline').replace(/[^ -~]/g, '?').slice(0, 120) };
  return json
    ? new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { ...headers, 'Content-Type': 'application/json' } })
    : new Response('Offline – noch nicht im Cache.', { status: 503, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
};

// Tägliche Erinnerung (app/push.mjs): Nachricht anzeigen, Klick öffnet „Heute“ (vorhandenes Fenster bevorzugt).
// lang (nur bei mehreren Kursen): vorher auf den Kurs der Erinnerung umschalten (Cookie per POST /api/lang; Wert = Kurs-Schlüssel,
// von Deutsch aus die Zielsprache, sonst die Kurs-ID wie ka-de – server.mjs, P7 C5)
self.addEventListener('push', e => {
  let m = {};
  try { m = e.data?.json() ?? {}; } catch { m = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || 'ქართული', {
    body: m.body || 'Zeit für Georgisch', tag: m.tag || 'daily', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    data: { url: m.url || './#/today', lang: m.lang } }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './#/today', self.registration.scope).href;
  e.waitUntil((async () => {
    const lang = e.notification.data?.lang;
    if (lang) await fetch('api/lang', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }) }).catch(() => {});
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find(c => new URL(c.url).origin === location.origin);
    if (w) { await w.focus(); return w.navigate(url).catch(() => w.postMessage({ type: 'NAVIGATE', url })); }
    return self.clients.openWindow(url);
  })());
});
