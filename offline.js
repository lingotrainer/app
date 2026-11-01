// Offline-Betrieb (PWA): Service Worker registrieren, Hinweis „Neue Version“, Verbindungsstatus in der Kopfzeile
// und Puffer für schreibende API-Aufrufe (IndexedDB) – wird beim nächsten Kontakt zum Server gesendet.
import { h, toast, apiFetch, STATIC } from './util.js';
import { t } from './i18n.js';

const DAY = 864e5, MIN = 60e3;
export { lastOf } from './core/srsmerge.js';

// net.online = Server erreichbar (nicht nur navigator.onLine: WLAN ohne VPN zählt als offline); auth=false nach 401
export const net = { online: navigator.onLine, auth: true, pending: 0, version: null, reason: null };
// Grund der letzten Offline-Erkennung + letzter erfolgreicher Kontakt (für #/offline: falsches WLAN, VPN aus, Server weg …)
const setReason = why => { net.reason = { why, at: Date.now() }; };
export const lastOk = () => { try { return Number(localStorage.getItem('net.lastOk')) || null; } catch { return null; } };
const markOk = () => { try { localStorage.setItem('net.lastOk', Date.now()); } catch {} };
const listeners = new Set();
export const onNet = fn => (listeners.add(fn), () => listeners.delete(fn));
function setNet(patch) {
  const before = JSON.stringify(net);
  Object.assign(net, patch);
  if (JSON.stringify(net) !== before) { listeners.forEach(fn => fn(net)); renderBadge(); }
}

// ---------- IndexedDB-Puffer: { k, path, method, body, t }; k = Zusammenfassungsschlüssel (z. B. 'progress') oder eindeutig ----------
let dbP = null, memQueue = new Map();   // Fallback ohne IndexedDB (z. B. privater Modus): nur im Speicher
function db() {
  dbP ??= new Promise((ok, fail) => {
    const r = indexedDB.open('georgisch-offline', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('outbox', { keyPath: 'k' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  }).catch(() => null);
  return dbP;
}
async function store(mode, fn) {
  const d = await db();
  if (!d) return fn(null)?.result;
  return new Promise((ok, fail) => {
    const tx = d.transaction('outbox', mode), req = fn(tx.objectStore('outbox'));
    tx.oncomplete = () => ok(req?.result);
    tx.onerror = () => fail(tx.error);
  });
}
const qPut = item => store('readwrite', s => s ? s.put(item) : memQueue.set(item.k, item));
const qDel = k => store('readwrite', s => s ? s.delete(k) : memQueue.delete(k));
const qAll = async () => (await store('readonly', s => s ? s.getAll() : { result: [...memQueue.values()] })) ?? [];
async function countPending() { setNet({ pending: (await qAll()).filter(mine).length }); }

// Schreibender Aufruf: sofort senden, bei fehlender Verbindung/Server-Ausfall/401 puffern.
// key: gleicher Schlüssel ersetzt einen älteren gepufferten Eintrag (SRS-Gesamtstand), sonst wird angehängt (Log).
// Puffer pro Benutzer: u = gewählter Benutzer (account.js); fremde Einträge bleiben liegen, bis derselbe wieder gewählt ist
// … und pro Kurs: l = Puffer-Schlüssel des gewählten Kurses (account.js: geo_course, P7 C5 – von Deutsch aus die Zielsprache wie
// vor C5, sonst die Kurs-ID; statisch geo_lang); Einträge ohne l stammen aus der Zeit vor der Sprachwahl (ka)
const curUser = () => { try { return localStorage.getItem('geo_user'); } catch { return null; } };
const curLang = () => { try { return localStorage.getItem('geo_course') ?? localStorage.getItem('geo_lang'); } catch { return null; } };
const mine = i => (!i.u || i.u === curUser()) && (i.l ?? 'ka') === (curLang() ?? 'ka');
export async function send(path, { method = 'POST', body } = {}, key = null) {
  // statische PWA: kein Server, nichts zu puffern – direkt in den lokalen Lernstand (backend-local.js)
  if (STATIC) return apiFetch(path, { method, body }).then(r => r.json()).then(res => {
    if (key === 'progress' && res.kept) dispatchEvent(new CustomEvent('srs-server-newer'));
    return res;
  }).catch(() => null);
  const u = curUser(), l = curLang();
  const item = { k: key ? (u ? `${u}:${l && l !== 'ka' ? l + ':' : ''}${key}` : key) : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, key, u, l, path, method, body, t: Date.now() };
  const r = net.online ? await trySend(item) : 'queue';
  if (r === 'queue') { await qPut(item); await countPending(); return null; }
  if (key) { await qDel(item.k); await countPending(); }    // neuerer Stand ist angekommen, älterer Puffer überflüssig
  if (net.pending) flush();
  return r;
}
// → Antwort-JSON bei Erfolg, 'queue' wenn später erneut versuchen, null wenn der Server den Eintrag ablehnt (400 …)
async function trySend(item) {
  let r;
  // X-Geo-Qid = Puffer-Schlüssel: Hat der Server schon geschrieben, aber die Antwort kam nicht an, erkennt er die
  // Wiederholung (server.mjs → /api/log) – keine doppelten Log-Einträge. body darf ein Blob sein (Aufnahmen, asr.js).
  try { r = await apiFetch(item.path, { method: item.method, body: item.body, headers: { 'X-Geo-Qid': item.k, ...(item.u ? { 'X-Geo-User': item.u } : {}), ...(item.l ? { 'X-Geo-Lang': item.l } : {}) } }); }
  catch (e) { setReason(t('Netzfehler: {msg}', { msg: e.message })); setNet({ online: false }); return 'queue'; }
  if (r.headers.get('X-Offline') || [502, 503, 504].includes(r.status)) { setReason(r.headers.get('X-Offline-Reason') ?? 'HTTP ' + r.status); setNet({ online: false }); return 'queue'; }
  markOk(); setNet({ online: true });
  if (r.status === 401) { setNet({ auth: false }); return 'queue'; }
  if (r.status === 409) return 'queue';    // anderer Benutzer bzw. andere Sprache gewählt als beim Puffern
  setNet({ auth: true });
  const res = await r.json().catch(() => ({}));
  if (!r.ok) { console.warn('verworfen', item.path, r.status, res); return null; }
  if (item.key === 'progress' && res.kept) dispatchEvent(new CustomEvent('srs-server-newer'));   // data.js lädt neu
  return res;
}

let flushing = null;
// mehrere Tabs/Fenster: nur einer sendet gleichzeitig (Web Locks, wo vorhanden), sonst doppelte Einträge
const locked = fn => navigator.locks?.request ? navigator.locks.request('georgisch-outbox', fn) : fn();
export function flush() {
  flushing ??= locked(async () => {
    try {
      for (const item of (await qAll()).filter(mine).sort((a, b) => a.t - b.t)) {
        const r = await trySend(item);
        if (r === 'queue') break;
        await qDel(item.k);
      }
      const n = net.pending;
      await countPending();
      if (n && !net.pending) toast(t('Offline-Puffer gesendet ({n} Einträge) ✓', { n }));
    } finally { flushing = null; }
  });
  return flushing;
}

// Pufferinhalt des aktuellen Benutzers für #/offline: [{ what, n, bytes, oldest }]
const KINDS = [[/^\/api\/progress/, t('Lernstand (Karteikarten)')], [/^\/api\/log/, t('Protokolleinträge')], [/^\/api\/recording/, t('Aufnahmen')], [/./, t('Sonstiges')]];
export async function queueInfo() {
  const groups = new Map();
  for (const i of (await qAll()).filter(mine)) {
    const what = KINDS.find(([re]) => re.test(i.path))[1], g = groups.get(what) ?? { what, n: 0, bytes: 0, oldest: i.t };
    g.n++; g.bytes += i.body?.size ?? i.body?.length ?? 0; g.oldest = Math.min(g.oldest, i.t);
    groups.set(what, g);
  }
  return [...groups.values()];
}

// gepufferter SRS-Stand (für data.js: nach dem Laden über den evtl. veralteten Cache-Stand legen)
export async function pendingProgress() {
  const p = (await qAll()).find(i => (i.key ?? i.k) === 'progress' && mine(i));
  try { return p ? JSON.parse(p.body) : null; } catch { return null; }
}

// gepufferte Log-Einträge des aktuellen Benutzers (für todaypending.js: offline bestandenes Quiz zählt schon vor dem Sync)
export async function pendingLog() {
  return (await qAll()).filter(i => i.path === '/api/log' && mine(i)).flatMap(i => { try { return [JSON.parse(i.body)]; } catch { return []; } });
}

// Erreichbarkeit prüfen (an der Service-Worker-Cache vorbei: /api/ping ist dort network-only)
export async function ping() {
  if (STATIC) { setNet({ online: navigator.onLine }); return net.online; }   // statisch: nur Netz fürs Nachladen von Kursdaten/Audio
  try {
    const r = await apiFetch('/api/ping', { cache: 'no-store', signal: AbortSignal.timeout?.(8000) });
    const ok = !r.headers.get('X-Offline') && r.status < 502;
    if (ok) markOk(); else setReason(t('Server antwortet mit HTTP {status}', { status: r.status }));
    setNet({ online: ok });
  } catch (e) {
    setReason(e.name === 'TimeoutError' ? t('keine Antwort in 8 s') : t('Server nicht erreichbar ({msg})', { msg: e.message }));
    setNet({ online: false });
  }
  if (net.online && net.pending) flush();
  return net.online;
}
addEventListener('online', ping);
addEventListener('offline', () => setNet({ online: false }));
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && ping());
// offline/Puffer: alle 20 s; online jede Minute (Heimnetz verlassen merkt sonst erst der nächste Schreibversuch)
let tick = 0;
setInterval(() => { if (!net.online || net.pending || ++tick % 3 === 0) ping(); }, 20e3);

// ---------- Kopfzeile: Status-Symbol, Klick → #/offline ----------
function renderBadge() {
  const slot = document.getElementById('net-slot');
  if (!slot) return;
  const off = !net.online, txt = off ? t('📴 offline') : !net.auth ? t('🔒 Anmeldung') : '📶';
  slot.replaceChildren(h('a', { href: '#/offline', class: 'net-badge' + (off ? ' off' : ''),
    title: off ? t('Keine Verbindung zum Server – Lernstand wird lokal gepuffert') : t('Online – Offline-Nutzung einrichten') },
    txt, net.pending ? h('span', { class: 'net-pending', title: t('ungesendete Einträge') }, ` ⏳${net.pending}`) : null));
}

// ---------- Service Worker + Hinweis „Neue Version – neu laden“ ----------
export let swReg = null;
function showUpdate(reg) {
  if (document.getElementById('update-bar')) return;
  document.body.append(h('div', { id: 'update-bar' }, t('Neue Version verfügbar. '),
    h('button', { class: 'btn primary', onclick: () => {
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
      (reg.waiting ?? reg.installing)?.postMessage('SKIP_WAITING');
      setTimeout(() => !reloaded && location.reload(), 3000);
    } }, t('Neu laden')),
    h('button', { class: 'btn', onclick: e => e.target.parentNode.remove() }, t('Später'))));
}
async function registerSw() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    const watch = w => w?.addEventListener('statechange', () => w.state === 'installed' && navigator.serviceWorker.controller && showUpdate(swReg));
    if (swReg.waiting && navigator.serviceWorker.controller) showUpdate(swReg);
    watch(swReg.installing);
    swReg.addEventListener('updatefound', () => watch(swReg.installing));
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && net.online && swReg.update().catch(() => {}));
    setInterval(() => net.online && swReg.update().catch(() => {}), 30 * MIN);
    const sw = navigator.serviceWorker.controller ?? swReg.active;
    if (sw) {
      const ch = new MessageChannel();
      ch.port1.onmessage = e => setNet({ version: e.data });
      sw.postMessage({ type: 'VERSION' }, [ch.port2]);
    }
  } catch (e) { console.warn('Service Worker nicht registriert:', e); }
}

export function initOffline() {
  renderBadge();
  registerSw();
  countPending().then(() => ping());
}
