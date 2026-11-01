// Kurse der statischen PWA (P7 B3): Kurs = Paar Ausgangssprache → Zielsprache, Liste in courses.json (scripts/pages.mjs).
// Gewählt (localStorage pages.courses) sind Kurs-IDs aller Ausgangssprachen; es zählen die der aktuellen Oberflächensprache
// (LOCALE = localStorage ui.lang). Aktueller Kurs: pages.course. Kursdaten und Audio liegen nur für gewählte Kurse im Cache.
import { url, h } from './util.js';
import { t, tx, LOCALE } from './i18n.js';

const SEL = 'pages.courses', CUR = 'pages.course';
const get = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let catP = null;
export const catalog = () => catP ??= fetch(url('courses.json')).then(r => r.ok ? r.json() : Promise.reject(new Error('courses.json ' + r.status)));
export const courseOf = async id => (await catalog()).courses.find(c => c.id === id) ?? null;

const allSelected = () => (Array.isArray(get(SEL)) ? get(SEL) : []);
export const selectedIds = () => allSelected().filter(id => id.startsWith(LOCALE + '-'));
export function setSelected(ids) {
  put(SEL, [...allSelected().filter(id => !id.startsWith(LOCALE + '-')), ...ids]);
  if (!ids.includes(currentId())) setCurrent(ids[0] ?? null);
}
export const currentId = () => { const s = selectedIds(), c = get(CUR); return s.includes(c) ? c : s[0] ?? null; };
export function setCurrent(id) {
  put(CUR, id);
  try { if (id) localStorage.setItem('geo_lang', id.split('-')[1]); } catch {}   // offline.js, Tagesplan (wie account.js)
}

// Kurs abgewählt: Kursdaten (Cache courses) und Audio der Zielsprache (Cache audio, falls kein anderer gewählter Kurs sie
// braucht) löschen; der Lernstand in IndexedDB bleibt
export async function dropCache(id) {
  if (!('caches' in window)) return;
  const tgt = id.split('-')[1], still = allSelected().some(c => c !== id && c.split('-')[1] === tgt);
  const base = new URL(url('./'), location.href).pathname;
  const drop = async (name, prefix) => {
    const c = await caches.open(name);
    for (const r of await c.keys()) if (new URL(r.url).pathname.startsWith(base + prefix)) await c.delete(r);
  };
  await drop('courses', `courses/${id}/`);
  if (!still) await drop('audio', `audio/${tgt}/`);
}

// Installieren: Chrome/Edge/Android liefern beforeinstallprompt (gemerkt, damit ⚙ es später anbieten kann), iOS nur
// über Teilen → „Zum Home-Bildschirm“
let promptEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptEvt = e; dispatchEvent(new Event('geo-installable')); });
addEventListener('appinstalled', () => { promptEvt = null; });
export const canPrompt = () => !!promptEvt;
export const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export async function promptInstall() {
  if (!promptEvt) return false;
  promptEvt.prompt();
  const { outcome } = await promptEvt.userChoice.catch(() => ({}));
  promptEvt = null;
  return outcome === 'accepted';
}
// Speicher dauerhaft (iOS/Safari löscht sonst nach Wochen ohne Nutzung): true | false | null (nicht unterstützt)
export const persist = () => navigator.storage?.persist ? navigator.storage.persist().catch(() => false) : Promise.resolve(null);
export const persisted = () => navigator.storage?.persisted ? navigator.storage.persisted().catch(() => false) : Promise.resolve(null);

// ---------- Bausteine für die Sprachwahl (pages-start.js) und #/courses (views/courses.js) ----------
const mb = n => (n / 1048576).toLocaleString(LOCALE, { maximumFractionDigits: 0 }) + ' MB';

// Ausgangssprache wechseln = Oberflächensprache: localStorage ui.lang, neu laden (i18n.js lädt das Wörterbuch beim Start)
export function setSource(src) {
  try { localStorage.setItem('ui.lang', src); } catch {}
  location.reload();
}
export const sourcePicker = cat => h('select', { onchange: e => setSource(e.target.value) },
  Object.entries(cat.sources).filter(([s]) => cat.courses.some(c => c.src === s))
    .map(([s, x]) => h('option', { value: s, selected: s === LOCALE }, x.native)));

// Kurs-Auswahl (Kontrollkästchen) für die aktuelle Ausgangssprache; onChange(ids)
export function courseChecks(cat, ids, onChange) {
  const chosen = new Set(ids);
  return h('div', { class: 'course-list' }, cat.courses.filter(c => c.src === LOCALE).map(c => h('label', { class: 'card row', style: 'cursor:pointer' },
    h('input', { type: 'checkbox', value: c.id, checked: chosen.has(c.id), onchange: e => { e.target.checked ? chosen.add(c.id) : chosen.delete(c.id); onChange([...chosen]); } }),
    h('span', { style: 'font-size:1.3em' }, c.lang.native), ' ', h('b', {}, tx(c.lang.name)),
    h('span', { class: 'muted small' }, ' · ' + t('{n} Lektionen', { n: c.lessons }) + ' · ' + t('{mb} Audio', { mb: mb(c.bytes) })))));
}

// Installieren: Knopf (Chrome/Edge/Android), Anleitung (iOS) oder nichts (schon installiert)
export function installHint() {
  if (standalone()) return h('p', { class: 'muted' }, t('Als App installiert ✓'));
  const box = h('div', {});
  const render = () => box.replaceChildren(
    canPrompt() ? h('button', { class: 'btn primary', onclick: async () => { await promptInstall(); render(); } }, t('📲 App installieren'))
      : h('p', { class: 'muted' }, isIOS ? t('iPhone/iPad: in Safari auf Teilen tippen, dann „Zum Home-Bildschirm“.')
        : t('Im Browsermenü „App installieren“ bzw. „Zum Startbildschirm hinzufügen“ wählen.')),
    h('p', { class: 'small muted' }, t('Die App funktioniert danach auch offline; geladen werden nur die gewählten Sprachen.')));
  addEventListener('geo-installable', render);
  render();
  return box;
}
