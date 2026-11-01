// Gewählter Benutzer in der Navigation (Name + Wechseln); Aufnahme- und Prüfseite nur für Rolle editor (GET /api/me),
// in der Navigation nur mit Lernenden (Coach), sonst im ⚙-Menü.
// Ohne Benutzerwahl (AUTH=off, lokale Entwicklung) erscheint kein Wechseln-Link.
// Kurs (Server, P7 C5): Auswahl in ⚙ bei mehreren Kursen (me.courseList, Titel aus den Datentexten); Wechsel → POST /api/course,
// Seite neu laden. Oberflächensprache = Ausgangssprache des Kurses (Cookie geo_ui, i18n.js). Statische PWA: Sprachwahl über
// me.langs + POST /api/lang (backend-local.js).
import { h, api, url, apiFetch, STATIC } from './util.js';
import { stageOf } from './data.js';
import { t, tx, LOCALE, UI_FORCED } from './i18n.js';

export const me = await api('/api/me').catch(() => null);
try {    // für den Offline-Puffer (offline.js); Sprache anderswo umgeschaltet (z. B. Klick auf Erinnerung, sw.js) → Tagesplan verwerfen
  if (me?.id) localStorage.setItem('geo_user', me.id);
  if (me?.lang) { localStorage.setItem('geo_lang', me.lang); }   // Zielsprache (Browser-Stimme, audio.js)
  // Puffer-Schlüssel des Kurses (offline.js → X-Geo-Lang): von Deutsch aus die Zielsprache wie vor C5, sonst die Kurs-ID
  if (me?.course && !STATIC) localStorage.setItem('geo_course', me.course.startsWith('de-') ? me.lang : me.course);
} catch {}
// Oberflächensprache passt nicht zum Kurs (erster Aufruf, Kurs anderswo gewechselt): der Server hat geo_ui eben gesetzt → einmal neu laden
if (!STATIC && !UI_FORCED && me?.ui && me.ui !== LOCALE && document.cookie.includes('geo_ui=' + me.ui)) location.reload();

const slot = document.getElementById('user-slot');
if (me?.auth && slot) slot.replaceChildren(h('span', { class: 'muted', title: t('Angemeldet als {id}', { id: me.id }) }, me.name), ' ',
  h('a', { href: url('/login'), onclick: async e => { e.preventDefault(); await apiFetch('/api/logout', { method: 'POST' }); location.replace(url('/login')); } },
    me.authMode === 'password' ? t('Abmelden') : t('Wechseln')));
if (me?.auth) document.getElementById('prefs-name')?.append(' ' + me.name);
// Konto (P7 D2): Passwort ändern (nur Anmeldung mit Passwort), Benutzerverwaltung für Admins (admin.js)
{
  const links = document.querySelector('.prefs-links');
  if (me?.authMode === 'password') links?.append(h('a', { href: '#/password' }, t('🔑 Passwort ändern')));
  if (me?.admin) links?.append(h('a', { href: '#/admin' }, t('👥 Benutzer verwalten')));
}
// Einstellungsmenü schließen bei Klick daneben oder Seitenwechsel
const prefs = document.querySelector('details.prefs');
document.addEventListener('click', e => { if (prefs?.open && !prefs.contains(e.target)) prefs.open = false; });
addEventListener('hashchange', () => { if (prefs) prefs.open = false; markNav(); });
// aktuelle Seite in der Navigation hervorheben
function markNav() {
  const r = '#/' + (location.hash.split('/')[1] ?? '');
  document.querySelectorAll('header nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === r));
}
markNav();
// Aufnehmen/Prüfen: in der Navigation nur für Coaches (Benutzer mit Lernenden), sonst für editor im ⚙-Menü (B5)
if (me && me.role !== 'editor') for (const id of ['nav-record', 'nav-check']) document.getElementById(id)?.remove();
else if (me && !me.learners?.length && (me.lang ?? 'ka') === 'ka') {
  const links = document.querySelector('.prefs-links'), rec = document.getElementById('nav-record'), chk = document.getElementById('nav-check');
  if (rec && chk) links?.append(h('span', { class: 'small muted' }, t('Für Muttersprachler:')), rec, chk);
}
// Aufnahmen für Coach freigeben (B4): nur wer Coaches hat; Standard an (POST /api/share, users.json shareRecordings)
if (me?.coaches?.length) {
  const box = h('input', { type: 'checkbox', checked: me.shareRecordings, onchange: async e => {
    const r = await api('/api/share', { method: 'POST', body: JSON.stringify({ recordings: e.target.checked }) }).catch(() => null);
    if (r?.ok) me.shareRecordings = r.shareRecordings; else e.target.checked = me.shareRecordings;
  } });
  slot?.before(h('label', { title: t('{names} darf deine Aufnahmen aus dem Tab Sprechen anhören und bewerten', { names: me.coaches.join(', ') }) }, box, ' ' + t('Aufnahmen für Coach freigeben')));
}
// Lesen erst ab A1 (in A0 gibt es noch keine Texte mit bekannten Buchstaben); bis zur Antwort verborgen, damit nichts springt
const navRead = document.getElementById('nav-read');
api('/api/today').then(d => stageOf(d.current) !== 'A0').catch(() => true).then(show => { if (navRead) navRead.hidden = !show; });

// Kopfzeile: Kurse von Deutsch aus mit der Marke der Sprache (lang.json brand), andere mit dem Kurstitel (ka-de: „გერმანულის ტრენერი“)
const cur = me?.courseList?.find(c => c.id === me.course), lang = me?.langs?.find(l => l.code === me.lang) ?? cur;
if (lang && (me.lang !== 'ka' || (cur && cur.src !== 'de'))) {
  const brand = cur && cur.src !== 'de' ? tx(cur.title) : tx(lang.brand) || tx(lang.name) + '-Trainer';
  document.documentElement.lang = LOCALE;
  document.title = brand;
  document.querySelector('header .brand')?.replaceChildren(h('span', {}, lang.native), ' ', h('span', { class: 'brand-txt' }, brand));
  // bisher nur Georgisch: Lautschrift-Legende, Aufnahme-Seite, Translit-Schalter (Lesen und Prüfseite gibt es für jede Sprache)
  if (me.lang !== 'ka') {
    for (const sel of ['#nav-ipa', '#nav-record']) document.querySelector(sel)?.remove();
    document.getElementById('opt-translit')?.closest('label')?.style.setProperty('display', 'none');
  }
}
// Kurswahl (Server): Kurstitel aus den Datentexten in der Oberflächensprache („Georgisch-Trainer“, „გერმანულის ტრენერი“)
if (!STATIC && me?.courseList?.length > 1) {
  const sel = h('select', { title: t('Kurs'), onchange: async e => {
    dispatchEvent(new Event('geo-lang'));   // timer.js: ungesendete Lernzeit noch dem bisherigen Kurs gutschreiben
    const r = await api('/api/course', { method: 'POST', body: JSON.stringify({ course: e.target.value }) }).catch(() => null);
    if (r?.ok) { try { localStorage.setItem('geo_lang', r.lang); localStorage.setItem('geo_course', r.course.startsWith('de-') ? r.lang : r.course); } catch {} location.hash = '#/'; location.reload(); }
  } }, me.courseList.map(c => h('option', { value: c.id, selected: c.id === me.course }, tx(c.title))));
  (slot ?? document.querySelector('nav'))?.prepend(sel, ' ');
} else if (STATIC && me?.langs?.length > 1) {
  const sel = h('select', { title: t('Lernsprache'), onchange: async e => {
    dispatchEvent(new Event('geo-lang'));   // timer.js: ungesendete Lernzeit noch der bisherigen Sprache gutschreiben
    const r = await api('/api/lang', { method: 'POST', body: JSON.stringify({ lang: e.target.value }) }).catch(() => null);
    if (r?.ok) { try { localStorage.setItem('geo_lang', r.lang); } catch {} location.hash = '#/'; location.reload(); }
  } }, me.langs.map(l => h('option', { value: l.code, selected: l.code === me.lang }, tx(l.name))));
  (slot ?? document.querySelector('nav'))?.prepend(sel, ' ');
}
