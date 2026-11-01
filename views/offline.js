// #/offline: Für unterwegs laden, Verbindungsstatus mit Grund, ungesendeter Puffer, alle Audios offline laden, Speicher
import { h, $app, api, toast, STATIC } from '../util.js';
import { setLesson } from '../opts.js';
import { net, onNet, flush, ping, lastOk, queueInfo } from '../offline.js';
import { plan, cached, run, isRunning, lastRun, autoOn, setAuto, mb, audioUrl } from '../prefetch.js';
import { t, LOCALE } from '../i18n.js';

const when = ts => ts ? new Date(ts).toLocaleString(LOCALE === 'de' ? 'de-DE' : LOCALE, { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
let unsub = null;

export function viewOffline() {
  setLesson(null);
  unsub?.();
  if (STATIC) return import('./offline-static.js').then(m => m.viewOfflineStatic());   // ohne Server: alles auf dem Gerät
  const travelBox = h('div', { class: 'card' }, h('h2', { style: 'margin-top:0' }, t('🧳 Für unterwegs')), h('p', { class: 'muted' }, t('Lade …')));
  const status = h('div', { class: 'card' });
  const audioBox = h('div', { class: 'card' }, h('h2', { style: 'margin-top:0' }, t('Alle Audios')), h('p', { class: 'muted' }, t('Lade …')));
  const storeBox = h('div', { class: 'card' });
  $app.replaceChildren(h('h1', {}, t('Offline & unterwegs')),
    h('p', { class: 'muted small' }, t('Der Server ist nur im Heimnetz erreichbar. Unterwegs gehen Heute, Karteikarten, Quiz, Hören, Blitzlesen, Schreiben und Sprechen (ohne Ausspracheprüfung) mit dem, was hier vorab geladen ist. Fortschritt, Protokoll und Aufnahmen bleiben auf dem Gerät und gehen beim nächsten Kontakt zum Server raus.')),
    ...net.online ? [travelBox, status] : [status, travelBox], audioBox, storeBox);   // offline zuerst Grund + Puffer

  const renderStatus = async () => {
    if (!status.isConnected) return unsub?.();
    const q = await queueInfo().catch(() => []);
    const c = navigator.connection, ok = lastOk();
    status.replaceChildren(...[
      h('div', { class: 'row' }, h('b', {}, net.online ? t('📶 Server erreichbar') : t('📴 Keine Verbindung zum Server')),
        !net.auth ? h('span', { class: 'feedback bad' }, t('Anmeldung nötig – Puffer wird danach gesendet')) : null),
      !net.online ? h('div', { class: 'small' },
        h('div', {}, t('Grund:') + ' ', net.reason?.why ?? (navigator.onLine ? t('Server antwortet nicht') : t('Gerät ist offline (Flugmodus/kein Netz)'))),
        h('div', { class: 'muted' }, t('Server {host} · Gerät {state}', { host: location.host, state: navigator.onLine ? t('hat Netz') : t('ohne Netz') }), c?.type ? ` (${c.type})` : '',
          ' · ' + t('zuletzt erreicht:') + ' ', when(ok)),
        navigator.onLine ? h('div', { class: 'muted' }, t('Netz da, Server nicht: anderes WLAN oder Mobilfunk ohne VPN – im Heimnetz-WLAN geht es wieder.')) : null) : null,
      q.length ? h('div', {}, h('p', { style: 'margin-bottom:4px' }, t('Noch nicht beim Server:')),
        h('ul', { class: 'small', style: 'margin-top:0' }, q.map(g => h('li', {}, `${g.what}: ${g.n}`,
          g.bytes > 50e3 ? ` (${mb(g.bytes)})` : '', ' · ' + t('seit {when}', { when: when(g.oldest) })))))
        : h('p', {}, t('Puffer leer – alles beim Server.')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', disabled: !net.pending, onclick: async () => { await ping(); await flush(); renderStatus(); } }, t('Jetzt senden')),
        h('button', { class: 'btn', onclick: async () => { toast(await ping() ? t('Server erreichbar ✓') : t('Server nicht erreichbar')); renderStatus(); } }, t('Verbindung prüfen'))),
      h('p', { class: 'small muted' }, t('App-Version:') + ' ', net.version ?? (navigator.serviceWorker?.controller ? '…' : t('kein Service Worker aktiv')))].filter(Boolean));
  };
  renderStatus();
  let wasOnline = net.online;
  unsub = onNet(n => { renderStatus(); if (n.online !== wasOnline) { wasOnline = n.online; travelPanel(travelBox); } });

  travelPanel(travelBox);
  audioPanel(audioBox);
  storagePanel(storeBox);
}

// Für unterwegs: was zur aktuellen + den nächsten 2 Lektionen gehört, wie viel davon schon auf dem Gerät ist, Knopf + Automatik
async function travelPanel(box) {
  const title = h('h2', { style: 'margin-top:0' }, t('🧳 Für unterwegs'));
  if (!('caches' in window)) return box.replaceChildren(title, h('p', { class: 'muted' }, t('Nicht verfügbar (nur über HTTPS bzw. localhost).')));
  if (isRunning()) return;    // Fortschritt zeichnet der laufende Knopf selbst
  const p = await plan();
  const have = await cached(p.files), haveBytes = have.reduce((s, a) => s + a.size, 0);
  const missing = p.files.length - have.length, missBytes = p.bytes - haveBytes;
  const last = lastRun();
  const bar = h('div', { class: 'bar' }, h('i', { style: `width:${100 * have.length / (p.files.length || 1)}%` }));
  const info = h('p', {}, t('{n} von {m} Audios auf dem Gerät', { n: have.length, m: p.files.length }), p.listed ? ' ' + t('({a} von {b})', { a: mb(haveBytes), b: mb(p.bytes) }) : '', '.');
  const btn = h('button', { class: 'btn primary', disabled: !net.online },
    !net.online ? t('Laden geht nur im Heimnetz') : missing ? t('Für unterwegs laden ({what})', { what: p.listed ? mb(missBytes) : t('{n} Dateien', { n: missing }) }) : t('Aktualisieren ✓'));
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      await run(({ done, total, bytes, of }) => {
        btn.textContent = total ? t('Lade … {done}/{total} · {a} von {b}', { done, total, a: mb(bytes), b: mb(of) }) : t('Daten aktualisiert …');
        bar.firstChild.style.width = `${100 * (have.length + done) / (p.files.length || 1)}%`;
      });
    } catch (e) { toast(t('Laden fehlgeschlagen:') + ' ' + e.message); }
    travelPanel(box);
  };
  const auto = h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: autoOn(), onchange: e => setAuto(e.target.checked) }),
    ' ' + t('automatisch im Hintergrund laden, wenn der Server erreichbar ist (nicht über Mobilfunk/Datensparen)'));
  box.replaceChildren(...[title,
    h('p', { class: 'small' }, t('Lektion {lessons} und alles davor (Wiederholen, Hören, Blitzlesen), dazu {n} Karten, die in den nächsten 3 Tagen fällig werden. Lerndaten, Grammatik, Sätze und Texte kommen mit.', { lessons: p.lessons.join(', '), n: p.due })),
    info, bar,
    !net.online && missing ? h('p', { class: 'small feedback bad' }, t('{n} Audios fehlen – sie spielen unterwegs nicht (Browser-Stimme, falls vorhanden).', { n: missing })) : null,
    h('div', { class: 'row', style: 'margin-top:10px' }, btn), auto,
    h('p', { class: 'small muted' }, t('Zuletzt geladen:') + ' ', last ? t('{when} (bis {lesson}{failed})', { when: when(last.t), lesson: last.lessons?.at(-1) ?? '?', failed: last.failed ? ', ' + t('{n} fehlgeschlagen', { n: last.failed }) : '' }) : t('noch nie'))].filter(Boolean));
}

async function audioPanel(box) {
  const title = h('h2', { style: 'margin-top:0' }, t('Alle Audios'));
  if (!('caches' in window)) return box.replaceChildren(title, h('p', { class: 'muted' }, t('Nicht verfügbar (nur über HTTPS bzw. localhost).')));
  let list;
  try { list = await api('/api/audio/list'); } catch { list = null; }
  if (!Array.isArray(list)) return box.replaceChildren(title, h('p', { class: 'muted' }, t('Liste nicht abrufbar – nur online möglich.')));
  const cache = await caches.open('audio');
  const have = new Set((await cached(list)).map(a => a.f));
  const missing = list.filter(a => !have.has(a.f));
  const total = list.reduce((s, a) => s + a.size, 0), miss = missing.reduce((s, a) => s + a.size, 0);
  const bar = h('div', { class: 'bar' }, h('i', { style: `width:${100 * (list.length - missing.length) / (list.length || 1)}%` }));
  const info = h('p', {}, t('{n} von {m} Dateien offline (gesamt {size}).', { n: list.length - missing.length, m: list.length, size: mb(total) }));
  const btn = h('button', { class: 'btn', disabled: !missing.length || !net.online }, missing.length ? t('Alle Audios offline laden ({size})', { size: mb(miss) }) : t('Alle Audios sind offline ✓'));
  btn.onclick = async () => {
    btn.disabled = true;
    let done = 0, failed = 0;
    const queue = [...missing];
    const worker = async () => {
      for (let a; (a = queue.shift());) {
        const url = audioUrl(a.f);
        try { const r = await fetch(url); if (r.ok) await cache.put(url, r); else failed++; } catch { failed++; }
        done++;
        btn.textContent = t('Lade … {done}/{total}', { done, total: missing.length });
        bar.firstChild.style.width = `${100 * (list.length - missing.length + done) / list.length}%`;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    toast(failed ? t('{n} Dateien fehlgeschlagen – später erneut versuchen', { n: failed }) : t('Alle Audios offline ✓'));
    audioPanel(box);
  };
  box.replaceChildren(title, info, bar, h('div', { class: 'row', style: 'margin-top:10px' }, btn),
    h('p', { class: 'small muted' }, t('Alle Lektionen auf einmal – meist reicht „Für unterwegs“. Sonst wird jede Aufnahme beim ersten Abspielen gespeichert.')));
}

async function storagePanel(box) {
  const s = navigator.storage;
  if (!s?.estimate) return box.remove();
  const { usage = 0, quota = 0 } = await s.estimate();
  const persisted = await s.persisted?.();
  box.replaceChildren(h('h2', { style: 'margin-top:0' }, t('Speicher')),
    h('p', {}, t('Belegt: {a} von {b}.', { a: mb(usage), b: mb(quota) })),
    persisted ? h('p', { class: 'small feedback ok' }, t('Dauerhafter Speicher aktiv – der Browser löscht die Offline-Daten nicht von selbst.'))
      : h('div', {}, h('p', { class: 'small muted' }, t('Browser (v. a. iOS) können Offline-Daten nach längerer Nichtnutzung löschen. Der Lernstand liegt trotzdem auf dem Server, sobald der Puffer gesendet ist.')),
        s.persist ? h('button', { class: 'btn', onclick: async () => { toast(await s.persist() ? t('Dauerhafter Speicher aktiv ✓') : t('Vom Browser abgelehnt (wird oft erst nach Installation erlaubt)')); storagePanel(box); } }, t('Dauerhaften Speicher anfordern')) : null));
}
