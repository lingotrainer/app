// In-Browser-API der statischen PWA (P7 B2): beantwortet dieselben /api-Routen wie app/server.mjs, ohne Server.
// util.js lädt dieses Modul, wenn <html data-mode="static"> (scripts/pages.mjs). Lese-Routen kommen aus den vorberechneten
// Dateien des aktuellen Kurses (courses/<id>/*.json, Cache im Service Worker), der Lernstand liegt in IndexedDB je Kurs
// im gleichen Format wie auf dem Server (srs = srs.json, log = Zeilen von log.jsonl), Auswertungen rechnet core/logstats.js.
// Was einen Server braucht (ASR, Push, Coach, Prüfseite, Aufnahmen teilen, Benutzer), meldet caps = false.
import { url } from './util.js';
import { t } from './i18n.js';
import { todayInfo, weakSounds, soundUnits, weekStats, dayMinutes, letterMastery } from './core/logstats.js';
import { mergeSrs } from './core/srsmerge.js';
import { catalog, courseOf, currentId, selectedIds, setCurrent } from './courses.js';

export const CAPS = { asr: false, push: false, coach: false, check: false, record: false, users: false };

// ---------- IndexedDB: srs (Schlüssel = Kurs-ID) und log (fortlaufend, Index course) ----------
let dbP = null;
function db() {
  dbP ??= new Promise((ok, fail) => {
    const r = indexedDB.open('georgisch-local', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('srs');
      r.result.createObjectStore('log', { autoIncrement: true }).createIndex('course', 'course');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
  return dbP;
}
async function tx(stores, mode, fn) {
  const d = await db();
  return new Promise((ok, fail) => {
    const x = d.transaction(stores, mode), req = fn(...[stores].flat().map(s => x.objectStore(s)));
    x.oncomplete = () => ok(req?.result);
    x.onerror = () => fail(x.error);
  });
}
export const getSrs = course => tx('srs', 'readonly', s => s.get(course)).then(x => x ?? {});
const putSrs = (course, srs) => tx('srs', 'readwrite', s => s.put(srs, course));
// nach Zeit sortiert (importierte ältere Einträge landen hinten in IndexedDB)
export const getLog = course => tx('log', 'readonly', s => s.index('course').getAll(course))
  .then(rows => rows.map(r => r.e).sort((a, b) => (a.ts ?? '') < (b.ts ?? '') ? -1 : (a.ts ?? '') > (b.ts ?? '') ? 1 : 0));
const addLog = (course, entries) => tx('log', 'readwrite', s => { for (const e of entries) s.add({ course, e }); });
export async function clearProgress(course) {
  await tx(['srs', 'log'], 'readwrite', (s, l) => {
    s.delete(course);
    const c = l.index('course').openKeyCursor(IDBKeyRange.only(course));
    c.onsuccess = () => { if (c.result) { l.delete(c.result.primaryKey); c.result.continue(); } };
  });
}

// ---------- Kursdateien (einmal je Seitenaufruf; offline aus dem Cache des Service Workers) ----------
const files = new Map();
class HttpError extends Error { constructor(r) { super('HTTP ' + r.status); this.response = r; } }
async function file(course, name) {
  const key = course.id + '/' + name;
  if (!files.has(key)) files.set(key, fetch(url(`courses/${course.id}/${name}.json?v=${course.version}`)).then(r => {
    if (!r.ok) throw new HttpError(r);
    return r.json();
  }).catch(e => { files.delete(key); throw e; }));
  return files.get(key);
}
// alte Fassungen (anderes ?v=) dieses Kurses aus dem Cache räumen
async function pruneOld(course) {
  if (!('caches' in window)) return;
  const c = await caches.open('courses');
  for (const r of await c.keys()) {
    const u = new URL(r.url);
    if (u.pathname.includes(`/courses/${course.id}/`) && u.searchParams.get('v') !== course.version) await c.delete(r);
  }
}

const json = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'Content-Type': 'application/json' } });
const NONE = () => json({ error: t('Ohne Server nicht verfügbar') }, 404);
const FORBIDDEN = () => json({ error: t('Ohne Server nicht verfügbar') }, 403);
const parse = b => { try { return typeof b === 'string' && b ? JSON.parse(b) : {}; } catch { return {}; } };

async function current() {
  const id = currentId(), c = id && await courseOf(id);
  if (!c) throw new HttpError(json({ error: t('Kein Kurs gewählt') }, 409));
  return c;
}

let pruned = false;
async function route(path, method, q, body) {
  if (path === '/api/ping') return { ok: true };
  if (path === '/api/users') return [];
  if (path === '/api/logout' || path === '/api/login') return { ok: true };
  const c = await current(), KA = c.tgt === 'ka';
  if (!pruned) { pruned = true; pruneOld(c).catch(() => {}); }
  if (path === '/api/me') {
    const cat = await catalog(), mine = selectedIds().map(id => cat.courses.find(x => x.id === id)).filter(Boolean);
    return { id: 'local', name: t('Ich'), role: 'learner', auth: false, static: true, caps: CAPS, lang: c.tgt, course: c.id,
      // Kopfzeile/Titel: Kurstitel (ka-de: „გერმანულის ტრენერი“) statt der deutschen Marke aus lang.json
      langs: mine.map(x => ({ ...x.lang, brand: x.title ?? x.lang.brand })), learners: [], coaches: [], shareRecordings: false };
  }
  if (path === '/api/lang' && method === 'POST') {
    const want = parse(body).lang, to = selectedIds().find(id => id.split('-')[1] === want);
    if (!to) return json({ error: t('Sprache nicht gewählt') }, 400);
    setCurrent(to);
    return { ok: true, lang: want };
  }
  if (path === '/api/data') {
    const d = await file(c, 'data');
    return { ...d, caps: CAPS, lang: { ...d.lang, asr: false } };
  }
  if (path === '/api/reading') return file(c, 'reading');
  if (path === '/api/grammar') return file(c, 'grammar');
  if (path === '/api/sentences') return file(c, 'sentences');
  if (path === '/api/audio/list') return file(c, 'audio-list');
  if (path === '/api/licenses') return file(c, 'licenses');

  // ---- Lernstand ----
  if (path === '/api/progress' && method === 'GET') return getSrs(c.id);
  if (path === '/api/progress' && method === 'PUT') {
    const { merged, kept } = mergeSrs(await getSrs(c.id), parse(body));
    await putSrs(c.id, merged);
    return { ok: true, kept };
  }
  if (path === '/api/log' && method === 'POST') { await addLog(c.id, [{ ts: new Date().toISOString(), ...parse(body) }]); return { ok: true }; }
  if (path === '/api/log' && method === 'GET') { const since = q.get('since') ?? ''; return (await getLog(c.id)).filter(e => !since || e.ts > since); }

  // ---- Auswertungen (wie server.mjs, Rechnung in core/logstats.js) ----
  const needs = { '/api/today': 1, '/api/weak': 1, '/api/letters': 1, '/api/week': 1, '/api/stats': 1 };
  if (needs[path]) {
    const [d, log, srs] = await Promise.all([file(c, 'data'), getLog(c.id), getSrs(c.id)]);
    if (path === '/api/today') return todayInfo(d.lessons, log, srs);
    if (path === '/api/weak') return KA ? weakSounds(d.vocab, d.alphabet, log, 6, Date.now(), [])
      : weakSounds([], [], log, 6, Date.now(), [], soundUnits(d.vocab, d.lang));
    if (path === '/api/letters') return KA ? letterMastery({ alphabet: d.alphabet, vocab: d.vocab, lessons: d.lessons, log, srs, ratings: [] }) : { current: null, letters: [] };
    if (path === '/api/week') return { ...weekStats({ lessons: d.lessons, vocab: d.vocab, alphabet: KA ? d.alphabet : [], log, srs,
      offset: Math.max(0, parseInt(q.get('offset')) || 0) }), chat: null, user: 'local', coaches: [] };   // Chat-Lektion = Server-Funktion
    if (path === '/api/stats') return { log, srs, current: todayInfo(d.lessons, log).current, minutes: dayMinutes({ log, srs }) };
  }

  // ---- ohne Server: leer bzw. nicht verfügbar (UI blendet aus, caps) ----
  if (path === '/api/asr') return { ready: false, starting: false, error: t('Ohne Server nicht verfügbar'), disabled: true };
  if (path === '/api/asr/start' || path === '/api/score') return json({ error: t('Ohne Server nicht verfügbar') }, 400);
  if (path === '/api/recording' && method === 'POST') return { file: null };   // Aufnahme bleibt im Browser (Tab Sprechen)
  if (path === '/api/ratings' && method === 'GET') return {};
  if (path === '/api/notes' && method === 'GET') return [];
  if (path === '/api/audio/new') return { lesson: null, items: [] };
  if (/^\/api\/(check|record)/.test(path)) return FORBIDDEN();
  return NONE();   // push, coach/tasks, summary, share, …
}

// fetch-artige Schnittstelle für util.js → apiFetch(p, { method, body })
export async function handle(p, o = {}) {
  const u = new URL(p, 'http://local'), method = (o.method ?? 'GET').toUpperCase();
  try {
    const r = await route(u.pathname, method, u.searchParams, o.body);
    return r instanceof Response ? r : json(r);
  } catch (e) {
    if (e.response) return e.response;     // Kursdatei fehlt (offline, nicht im Cache → X-Offline vom Service Worker)
    console.warn('backend-local', p, e);
    return json({ error: String(e.message ?? e) }, 500);
  }
}

// ---------- Lernstand sichern (⚙ → #/courses): Dateien wie auf dem Server je Kurs ----------
// { app, format: 1, exported, ui, courses: { 'de-ka': { lang: 'ka', 'srs.json': {…}, 'log.jsonl': '{…}\n{…}\n' } } }
// = Inhalt von progress/users/<id>/<lang>/srs.json und log.jsonl (Server-Import später: npm run server:import-progress)
const toJsonl = log => log.map(e => JSON.stringify(e)).join('\n') + (log.length ? '\n' : '');
const fromJsonl = s => typeof s !== 'string' ? [] : s.split('\n').flatMap(l => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
export async function exportAll() {
  const cat = await catalog(), out = { app: 'georgisch-trainer', format: 1, exported: new Date().toISOString(), ui: document.documentElement.lang, courses: {} };
  for (const c of cat.courses) {
    const [srs, log] = await Promise.all([getSrs(c.id), getLog(c.id)]);
    if (Object.keys(srs).length || log.length) out.courses[c.id] = { lang: c.tgt, 'srs.json': srs, 'log.jsonl': toJsonl(log) };
  }
  return out;
}
// Zusammenführen statt Ersetzen: Karten wie PUT /api/progress (jüngeres last gewinnt), Log ohne doppelte Zeilen
export async function importAll(x) {
  if (x?.app !== 'georgisch-trainer' || typeof x.courses !== 'object') throw new Error(t('Keine Lernstand-Datei'));
  const cat = await catalog(), done = [];
  for (const [id, v] of Object.entries(x.courses)) {
    if (!cat.courses.some(c => c.id === id)) continue;
    const srs = v['srs.json'] ?? {};
    const { merged } = mergeSrs(await getSrs(id), srs);
    await putSrs(id, merged);
    const have = new Set((await getLog(id)).map(e => JSON.stringify(e)));
    const add = fromJsonl(v['log.jsonl']).filter(e => e && !have.has(JSON.stringify(e))).sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''));
    await addLog(id, add);
    done.push({ id, cards: Object.keys(srs).length, log: add.length });
  }
  return done;
}
