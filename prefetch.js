// „Für unterwegs laden“ (#/offline): Lerndaten + Audio der aktuellen und der nächsten 2 Lektionen vorab in den Cache
// des Service Workers – unterwegs ist der Server (nur Heimnetz) nicht erreichbar. Frühere Lektionen gehören dazu, weil
// Wiederholen, Hören, Blitzlesen und Minimalpaare alles bis zur aktuellen Lektion mischen; dazu fällige Karten (3 Tage).
// Automatisch im Hintergrund, sobald der Server erreichbar ist und das Gerät nicht über Mobilfunk/Datensparen läuft.
import { api, toast, url, apiFetch } from './util.js';
import { D, P, lessonIdx } from './data.js';
import { langMod } from './langmods.js';
import { net, onNet } from './offline.js';
import { t, LOCALE } from './i18n.js';

const AHEAD = 2, DUE_DAYS = 3, AUTO_EVERY = 6 * 36e5;
// GET-Antworten, die Ansichten offline brauchen (sw.js speichert sie beim Abruf, Netz zuerst)
const API = ['/api/data', '/api/progress', '/api/me', '/api/today', '/api/weak', '/api/letters', '/api/grammar', '/api/sentences', '/api/reading',
  '/api/ratings', '/api/stats', '/api/week?offset=0', '/api/week?offset=1', '/api/push', '/api/notes', '/api/audio/list', '/api/licenses'];

const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } };
export const lastRun = () => store('prefetch.last');
export const autoOn = () => store('prefetch.auto') !== false;
export const setAuto = on => store('prefetch.auto', !!on);
export const audioUrl = f => url('/audio/') + f.split('/').map(encodeURIComponent).join('/');   // sv/…: Sprach-Unterordner

// Was gehört dazu? → { current, lessons: [ids], due, files: [{ f, size }], bytes }
export async function plan() {
  const [today, reading, list] = await Promise.all([
    api('/api/today').catch(() => ({})), api('/api/reading').catch(() => null), api('/api/audio/list').catch(() => null)]);
  const current = today.current ?? D.lessons[0]?.id;
  const max = Math.min(lessonIdx(current) + AHEAD, D.lessons.length - 1);
  const lessons = D.lessons.slice(Math.max(0, lessonIdx(current)), max + 1).map(l => l.id);
  const upTo = id => { const i = lessonIdx(id); return i >= 0 && i <= max; };
  const files = new Set();
  const add = f => f && files.add(f);
  D.alphabet.filter(l => upTo(l.lesson)).forEach(l => add(l.audio));
  D.vocab.filter(v => upTo(v.lesson)).forEach(v => add(v.audio));
  D.pairs?.words.forEach(w => add(w.audio));
  for (const d of [...reading?.dialogs ?? [], ...reading?.texts ?? []]) if (upTo(d.lesson)) d.lines.forEach(l => add(l.audio));
  reading?.sentences?.filter(s => upTo(s.lesson)).forEach(s => add(s.audio));
  D.listen?.filter(s => upTo(s.lesson)).forEach(s => add(s.audio));   // Satz-Hörkarten s:<id> (R8)
  const nm = langMod('numbers');
  if (nm && lessonIdx(current) >= lessonIdx(nm.from20)) Object.values(D.numAudio ?? {}).forEach(add);   // Zahlentrainer (sv/en, wie extras.js)
  // fällige Karten (auch aus Lektionen, die oben schon fehlen könnten): l:<Buchstabe>, v:<id>:<Richtung>, s:<Satz-id>
  const soon = Date.now() + DUE_DAYS * 864e5;
  const dueKeys = Object.keys(P).filter(k => !k.startsWith('err:') && P[k].due <= soon);
  for (const k of dueKeys) {
    const [kind, id] = k.split(':');
    if (kind === 'l') add(D.alphabet.find(l => l.char === id)?.audio);
    else if (kind === 'v') add(D.vocab.find(v => v.id === id)?.audio);
    else if (kind === 's') add((D.listen?.find(s => s.id === id) ?? reading?.sentences?.find(s => s.id === id))?.audio);
  }
  const size = new Map((Array.isArray(list) ? list : []).map(a => [a.f, a.size]));
  const all = [...files].map(f => ({ f, size: size.get(f) ?? 0 }));
  return { current, lessons, due: dueKeys.length, files: all, bytes: all.reduce((s, a) => s + a.size, 0), listed: Array.isArray(list) };
}

// Welche Dateien liegen schon im Audio-Cache (sw.js → AUDIO_CACHE, Schlüssel = Pfad)?
export async function cached(files) {
  if (!('caches' in window)) return [];
  const have = new Set((await (await caches.open('audio')).keys()).map(r => new URL(r.url).pathname));
  return files.filter(a => have.has(new URL(audioUrl(a.f), location.href).pathname));
}

let running = null;
// Laden: API-Antworten auffrischen, fehlende Audios holen (4 parallel). onProgress({ done, total, bytes, of })
export function run(onProgress = () => {}, { quiet = false } = {}) {
  running ??= (async () => {
    try {
      const p = await plan();
      await Promise.all(API.map(u => apiFetch(u).catch(() => null)));
      const have = new Set((await cached(p.files)).map(a => a.f));
      const missing = p.files.filter(a => !have.has(a.f)), of = missing.reduce((s, a) => s + a.size, 0);
      const cache = await caches.open('audio');
      let done = 0, bytes = 0, failed = 0;
      onProgress({ done, total: missing.length, bytes, of });
      const queue = [...missing];
      const worker = async () => {
        for (let a; (a = queue.shift());) {
          const u = audioUrl(a.f);
          try { const r = await fetch(u); if (r.ok && !r.headers.get('X-Offline')) await cache.put(u, r); else failed++; } catch { failed++; }
          done++; bytes += a.size;
          onProgress({ done, total: missing.length, bytes, of });
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      const res = { t: Date.now(), current: p.current, lessons: p.lessons, files: p.files.length, loaded: missing.length - failed, failed, bytes: of, total: p.bytes };
      store('prefetch.last', res);
      if (!quiet || failed) toast(failed ? t('Für unterwegs: {n} Dateien fehlgeschlagen – später erneut versuchen', { n: failed }) : t('Für unterwegs geladen ✓ ({size})', { size: mb(of) }));
      // Browser (v. a. iOS) räumen Caches sonst nach einer Weile ohne Nutzung ab
      navigator.storage?.persist?.().catch(() => {});
      return res;
    } finally { running = null; }
  })();
  return running;
}
export const isRunning = () => !!running;

export const mb = n => (n / 1048576).toLocaleString(LOCALE === 'de' ? 'de-DE' : LOCALE, { maximumFractionDigits: 1 }) + ' MB';

// Automatisch: Server erreichbar (= Heimnetz, solange es kein VPN gibt), kein Mobilfunk/Datensparen (Network Information
// API nur Android/Chrome; iOS meldet nichts → gilt als WLAN), höchstens alle 6 h oder bei neuer aktueller Lektion.
export function autoPrefetch() {
  if (!autoOn() || !net.online || !('caches' in window) || running) return;
  const c = navigator.connection;
  if (c && (c.saveData || c.type === 'cellular')) return;
  const last = lastRun();
  const later = () => (window.requestIdleCallback ?? setTimeout)(async () => {
    if (!net.online || running) return;
    if (last && Date.now() - last.t < AUTO_EVERY && last.current === (await api('/api/today').catch(() => ({}))).current) return;
    run(undefined, { quiet: true }).catch(() => {});
  });
  setTimeout(later, 8000);   // erst nach dem Start der Seite, nicht gegen das erste Laden konkurrieren
}
// zurück im Heimnetz (offline → online): gleich nachladen
let wasOnline = net.online;
onNet(n => { if (n.online && !wasOnline) autoPrefetch(); wasOnline = n.online; });
