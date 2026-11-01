// #/offline in der statischen PWA (P7 B): kein Server, kein Puffer – alles liegt auf diesem Gerät. Speicherbelegung,
// Audio je gewähltem Kurs laden/entfernen (Cache audio, Liste courses/<id>/audio-list.json), Hinweis auf den Export.
import { h, $app, toast, url } from '../util.js';
import { setLesson } from '../opts.js';
import { cached, audioUrl, mb, autoOn, setAuto } from '../prefetch.js';
import { catalog, selectedIds, currentId, persist, persisted } from '../courses.js';
import { t, tx } from '../i18n.js';

const audioList = c => fetch(url(`courses/${c.id}/audio-list.json?v=${c.version}`)).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)));

export async function viewOfflineStatic() {
  setLesson(null);
  const storeBox = h('div', { class: 'card' }), audioBox = h('div', {});
  $app.replaceChildren(h('h1', {}, t('Offline & unterwegs')),
    h('p', { class: 'muted small' }, t('Diese App braucht keinen Server: Lernstand, Einstellungen und geladene Lerndaten liegen auf diesem Gerät. Sie funktioniert auch ohne Internet – nur Audio, das noch nicht geladen ist, fehlt dann.')),
    storeBox, h('h2', {}, t('Audio der gewählten Sprachen')), audioBox,
    h('div', { class: 'card' }, h('h2', { style: 'margin-top:0' }, t('Lernstand sichern')),
      h('p', { class: 'small' }, t('Der Lernstand liegt nur in diesem Browser. Wird der Browser-Speicher gelöscht, ist er weg – deshalb ab und zu exportieren (auch zum Übertragen auf ein anderes Gerät).')),
      h('button', { class: 'btn', onclick: () => { location.hash = '#/courses'; } }, t('Zu „Sprachen & Lernstand“'))),
    h('p', { class: 'small muted' }, t('App-Version:') + ' ', h('span', { id: 'sw-version' }, navigator.serviceWorker?.controller ? '…' : t('kein Service Worker aktiv'))));
  showVersion();
  storagePanel(storeBox);
  if (!('caches' in window)) return audioBox.replaceChildren(h('p', { class: 'muted' }, t('Nicht verfügbar (nur über HTTPS bzw. localhost).')));
  const cat = await catalog().catch(() => null);
  const mine = selectedIds().map(id => cat?.courses.find(c => c.id === id)).filter(Boolean);
  audioBox.replaceChildren(...mine.map(c => { const box = h('div', { class: 'card' }); coursePanel(box, c, () => storagePanel(storeBox)); return box; }),
    h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: autoOn(), onchange: e => setAuto(e.target.checked) }),
      ' ' + t('Audio der aktuellen und nächsten Lektionen automatisch nachladen (nicht über Mobilfunk/Datensparen)')));
}

function showVersion() {
  const c = navigator.serviceWorker?.controller;
  if (!c) return;
  const ch = new MessageChannel();
  ch.port1.onmessage = e => { const el = document.getElementById('sw-version'); if (el) el.textContent = e.data; };
  c.postMessage({ type: 'VERSION' }, [ch.port2]);
}

// ein Kurs: wie viel Audio auf dem Gerät ist, alles laden bzw. alles entfernen
async function coursePanel(box, c, changed) {
  const title = h('h3', { style: 'margin-top:0' }, c.lang.native, ' ', h('span', { class: 'muted' }, tx(c.lang.name)), c.id === currentId() ? h('span', { class: 'small muted' }, ' · ' + t('aktuell')) : '');
  let list;
  try { list = await audioList(c); } catch { return box.replaceChildren(title, h('p', { class: 'muted' }, t('Liste nicht abrufbar – einmal mit Internet öffnen.'))); }
  const have = new Set((await cached(list)).map(a => a.f)), missing = list.filter(a => !have.has(a.f));
  const total = list.reduce((s, a) => s + a.size, 0), miss = missing.reduce((s, a) => s + a.size, 0);
  const bar = h('div', { class: 'bar' }, h('i', { style: `width:${100 * have.size / (list.length || 1)}%` }));
  const load = h('button', { class: 'btn primary', disabled: !missing.length || !navigator.onLine },
    !missing.length ? t('Alles geladen ✓') : !navigator.onLine ? t('Laden braucht Internet') : t('Alles laden ({size})', { size: mb(miss) }));
  const drop = h('button', { class: 'btn', disabled: !have.size }, t('Audio entfernen'));
  load.onclick = async () => {
    load.disabled = drop.disabled = true;
    const cache = await caches.open('audio'), queue = [...missing];
    let done = 0, failed = 0;
    const worker = async () => {
      for (let a; (a = queue.shift());) {
        const u = audioUrl(a.f);
        try { const r = await fetch(u); if (r.ok) await cache.put(u, r); else failed++; } catch { failed++; }
        done++;
        load.textContent = t('Lade … {done}/{total}', { done, total: missing.length });
        bar.firstChild.style.width = `${100 * (have.size + done) / list.length}%`;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    toast(failed ? t('{n} Dateien fehlgeschlagen – später erneut versuchen', { n: failed }) : t('Audio für {name} geladen ✓', { name: tx(c.lang.name) }));
    coursePanel(box, c, changed); changed();
  };
  drop.onclick = async () => {
    if (!confirm(t('Geladenes Audio für {name} entfernen? Der Lernstand bleibt; Audio wird beim Abspielen bzw. später neu geladen.', { name: tx(c.lang.name) }))) return;
    const cache = await caches.open('audio');
    for (const a of list) if (have.has(a.f)) await cache.delete(audioUrl(a.f));
    toast(t('Audio entfernt'));
    coursePanel(box, c, changed); changed();
  };
  box.replaceChildren(title,
    h('p', {}, t('{n} von {m} Audios auf dem Gerät ({a} von {b}).', { n: have.size, m: list.length, a: mb(total - miss), b: mb(total) })), bar,
    h('div', { class: 'row', style: 'margin-top:10px' }, load, drop));
}

async function storagePanel(box) {
  const s = navigator.storage;
  const est = await s?.estimate?.().catch(() => null), p = await persisted();
  box.replaceChildren(h('h2', { style: 'margin-top:0' }, t('Speicher')),
    est ? h('p', {}, t('Belegt: {a} von {b}.', { a: mb(est.usage ?? 0), b: mb(est.quota ?? 0) })) : h('p', { class: 'muted' }, t('Speicherbelegung unbekannt.')),
    p ? h('p', { class: 'small feedback ok' }, t('Dauerhafter Speicher aktiv – der Browser löscht die Daten nicht von selbst.'))
      : p === null ? h('p', { class: 'small muted' }, t('Dieser Browser kennt keinen dauerhaften Speicher – Lernstand regelmäßig exportieren.'))
        : h('div', {}, h('p', { class: 'small muted' }, t('Browser (v. a. iOS) können Daten nach längerer Nichtnutzung löschen – auch den Lernstand.')),
          h('button', { class: 'btn', onclick: async () => { toast(await persist() ? t('Dauerhafter Speicher aktiv ✓') : t('Vom Browser abgelehnt (wird oft erst nach Installation erlaubt)')); storagePanel(box); } }, t('Dauerhaften Speicher anfordern'))));
}
